/**
 * Расшифровка длинной записи живёт минутами и раньше умирала вместе с процессом:
 * аудио было только в памяти, статус встречи навсегда оставался `transcribing`,
 * пользователь ждал результат, которого никто не считал. Здесь проверяется, что
 * задача переживает перезапуск, а если пережить не может — не пропадает молча.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const TEST_DIR = path.join(os.tmpdir(), 'pending-jobs-test');

jest.mock('../db/db');
jest.mock('../config', () => ({ config: { databasePath: path.join(require('os').tmpdir(), 'pending-jobs-test', 'db.sqlite') } }));

/**
 * Модуль держит промис инициализации в замыкании, поэтому его нужно грузить
 * заново на каждый тест. resetModules выдаёт и свежие моки БД — ссылки на них
 * берём после сброса, иначе настраивали бы уже выброшенные экземпляры.
 */
let executeMock: jest.Mock;
let queryAllMock: jest.Mock;
let queryOneMock: jest.Mock;

function load(): typeof import('../services/pending-jobs') {
  return require('../services/pending-jobs');
}

beforeEach(() => {
  jest.resetModules();
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  const db = require('../db/db');
  executeMock = db.execute as jest.Mock;
  queryAllMock = db.queryAll as jest.Mock;
  queryOneMock = db.queryOne as jest.Mock;
  executeMock.mockReset().mockResolvedValue(undefined);
  queryAllMock.mockReset().mockResolvedValue([]);
  queryOneMock.mockReset().mockResolvedValue({ id: 1 });
});

afterAll(() => { fs.rmSync(TEST_DIR, { recursive: true, force: true }); });

describe('registerJob', () => {
  test('кладёт аудио на диск и заводит строку', async () => {
    const { registerJob } = load();
    const id = await registerJob({ kind: 'meeting', buffer: Buffer.from('АУДИО'), filename: 'meeting.mp3', meetingId: 7 });

    expect(id).toBe(1);
    const written = fs.readdirSync(path.join(TEST_DIR, 'pending-jobs'));
    expect(written).toHaveLength(1);
    expect(fs.readFileSync(path.join(TEST_DIR, 'pending-jobs', written[0]!), 'utf-8')).toBe('АУДИО');

    const insert = queryOneMock.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO pending_jobs'));
    expect(insert).toBeTruthy();
    expect(insert![1][3]).toBe(7); // meeting_id
  });

  test('опасное имя файла не выводит запись за пределы каталога', async () => {
    const { registerJob } = load();
    await registerJob({ kind: 'meeting', buffer: Buffer.alloc(8), filename: '../../../etc/passwd' });

    const dir = path.join(TEST_DIR, 'pending-jobs');
    const written = fs.readdirSync(dir);
    expect(written).toHaveLength(1);
    expect(written[0]).not.toContain('/');
  });

  test('сбой регистрации не роняет расшифровку — она страховка, а не условие', async () => {
    queryOneMock.mockRejectedValue(new Error('база недоступна'));
    const { registerJob } = load();
    await expect(registerJob({ kind: 'meeting', buffer: Buffer.alloc(4), filename: 'a.mp3' })).resolves.toBeNull();
  });
});

describe('completeJob', () => {
  test('снимает строку и удаляет аудио', async () => {
    const { registerJob, completeJob } = load();
    await registerJob({ kind: 'meeting', buffer: Buffer.alloc(16), filename: 'a.mp3' });
    const dir = path.join(TEST_DIR, 'pending-jobs');
    const file = path.join(dir, fs.readdirSync(dir)[0]!);

    queryOneMock.mockResolvedValue({ audio_path: file });
    await completeJob(1);

    expect(fs.existsSync(file)).toBe(false);
    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM pending_jobs'))).toBe(true);
  });

  test('null означает «задачи не было» — молча выходим', async () => {
    const { completeJob } = load();
    await completeJob(null);
    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM pending_jobs'))).toBe(false);
  });
});

describe('resumePendingJobs', () => {
  const handlers = () => ({
    meeting: jest.fn().mockResolvedValue(undefined),
    telegramAudio: jest.fn().mockResolvedValue(undefined),
    giveUp: jest.fn().mockResolvedValue(undefined),
  });

  function jobRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    const dir = path.join(TEST_DIR, 'pending-jobs');
    fs.mkdirSync(dir, { recursive: true });
    const audio = path.join(dir, 'audio.bin');
    fs.writeFileSync(audio, 'ЗАПИСЬ');
    return { id: 5, kind: 'meeting', user_id: 2, tg_id: null, meeting_id: 42, filename: 'a.mp3', audio_path: audio, payload: null, attempts: 0, ...over };
  }

  test('возобновляет встречу и передаёт сохранённое аудио', async () => {
    queryAllMock.mockResolvedValue([jobRow()]);
    queryOneMock.mockResolvedValue({ attempts: 1 });
    const h = handlers();

    await load().resumePendingJobs(h);

    expect(h.meeting).toHaveBeenCalledTimes(1);
    expect(h.meeting.mock.calls[0]![1].toString()).toBe('ЗАПИСЬ');
    expect(h.giveUp).not.toHaveBeenCalled();
  });

  test('телеграмная задача уходит в свой обработчик', async () => {
    queryAllMock.mockResolvedValue([jobRow({ kind: 'telegram-audio', tg_id: '849367993', meeting_id: null })]);
    queryOneMock.mockResolvedValue({ attempts: 1 });
    const h = handlers();

    await load().resumePendingJobs(h);

    expect(h.telegramAudio).toHaveBeenCalledTimes(1);
    expect(h.meeting).not.toHaveBeenCalled();
  });

  test('пропавшее аудио — не молчание, а явный отказ', async () => {
    queryAllMock.mockResolvedValue([jobRow({ audio_path: '/tmp/нет-такого-файла.bin' })]);
    const h = handlers();

    await load().resumePendingJobs(h);

    expect(h.meeting).not.toHaveBeenCalled();
    expect(h.giveUp).toHaveBeenCalledTimes(1);
    expect(h.giveUp.mock.calls[0]![1]).toMatch(/аудио/);
  });

  test('после лимита попыток перестаём мучить и сообщаем', async () => {
    queryAllMock.mockResolvedValue([jobRow({ attempts: 2 })]);
    queryOneMock.mockResolvedValue({ attempts: 3 });
    const h = handlers();

    await load().resumePendingJobs(h);

    expect(h.meeting).not.toHaveBeenCalled();
    expect(h.giveUp).toHaveBeenCalledTimes(1);
  });

  test('падение обработчика оставляет задачу на следующий старт', async () => {
    queryAllMock.mockResolvedValue([jobRow()]);
    queryOneMock.mockResolvedValue({ attempts: 1 });
    const h = handlers();
    h.meeting.mockRejectedValue(new Error('сервис лежит'));

    await expect(load().resumePendingJobs(h)).resolves.toBeUndefined();

    expect(executeMock.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM pending_jobs'))).toBe(false);
  });

  test('одна упавшая задача не мешает следующим', async () => {
    queryAllMock.mockResolvedValue([jobRow({ id: 1 }), jobRow({ id: 2 })]);
    queryOneMock.mockResolvedValue({ attempts: 1 });
    const h = handlers();
    h.meeting.mockRejectedValueOnce(new Error('первая упала'));

    await load().resumePendingJobs(h);

    expect(h.meeting).toHaveBeenCalledTimes(2);
  });

  test('без задач ничего не делает и не падает', async () => {
    queryAllMock.mockResolvedValue([]);
    const h = handlers();
    await load().resumePendingJobs(h);
    expect(h.meeting).not.toHaveBeenCalled();
    expect(h.giveUp).not.toHaveBeenCalled();
  });

  test('недоступная база при старте не роняет API', async () => {
    queryAllMock.mockRejectedValue(new Error('база недоступна'));
    const h = handlers();
    await expect(load().resumePendingJobs(h)).resolves.toBeUndefined();
  });
});
