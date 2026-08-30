/**
 * Регресс на причину бага с «музыка, музыка»: whisper.cpp обязан вызываться
 * с `-mc 0`, иначе текст предыдущего окна идёт промптом в следующее и заглушка
 * подкрепляет сама себя до конца файла.
 */
jest.mock('child_process');
jest.mock('fs');

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { transcribeLocal, safeTmpName } from '../services/whisper-local.service';

const spawnMock = spawn as unknown as jest.Mock;

/** Заглушка дочернего процесса: сразу завершается с указанным кодом. */
function fakeChild(stdout = '', exitCode = 0): Record<string, unknown> {
  const child = {
    stdout: { on: (ev: string, cb: (d: Buffer) => void) => { if (ev === 'data' && stdout) cb(Buffer.from(stdout)); } },
    stderr: { on: (): void => {} },
    kill: (): void => {},
    on: (ev: string, cb: (arg?: unknown) => void) => {
      if (ev === 'close') setImmediate(() => cb(exitCode));
      return child;
    },
  };
  return child as unknown as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();

  spawnMock.mockImplementation((cmd: string) =>
    fakeChild(cmd === 'ffprobe' ? '120.5\n' : '')
  );

  (fs.writeFileSync as unknown as jest.Mock).mockImplementation(() => {});
  (fs.unlinkSync as unknown as jest.Mock).mockImplementation(() => {});
  (fs.mkdirSync as unknown as jest.Mock).mockImplementation(() => {});
  (fs.rmSync as unknown as jest.Mock).mockImplementation(() => {});
  (fs.mkdtempSync as unknown as jest.Mock).mockImplementation((p: string) => `${p}test`);
  (fs.existsSync as unknown as jest.Mock).mockReturnValue(true);
  (fs.readdirSync as unknown as jest.Mock).mockReturnValue([]);
  (fs.readFileSync as unknown as jest.Mock).mockReturnValue('Обсудили сроки. Договорились на пятницу.');
});

/** Переводит мок в режим часовой записи: ffprobe отдаёт 3600 с, нарезка даёт 6 кусков. */
function useHourLongAudio(chunkCount = 6): void {
  spawnMock.mockImplementation((cmd: string) =>
    fakeChild(cmd === 'ffprobe' ? '3600.0\n' : '')
  );
  // намеренно в перемешанном порядке — проверяем числовую сортировку
  const names = Array.from({ length: chunkCount }, (_, i) => `chunk-${String(i).padStart(5, '0')}.wav`);
  (fs.readdirSync as unknown as jest.Mock).mockReturnValue([...names].reverse());
}

function whisperCall(): string[] {
  const call = spawnMock.mock.calls.find(([cmd]) => String(cmd).includes('whisper-cli'));
  if (!call) throw new Error('whisper-cli не был вызван');
  return call[1] as string[];
}

test('whisper.cpp вызывается с -mc 0 — контекст между окнами не переносится', async () => {
  await transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3');

  const args = whisperCall();
  const i = args.indexOf('-mc');
  expect(i).toBeGreaterThan(-1);
  expect(args[i + 1]).toBe('0');
});

test('язык и текстовый вывод сохранены', async () => {
  await transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3');

  const args = whisperCall();
  expect(args).toContain('-otxt');
  expect(args[args.indexOf('-l') + 1]).toBe('ru');
});

test('результат прогоняется через чистку от галлюцинаций', async () => {
  (fs.readFileSync as unknown as jest.Mock).mockReturnValue(
    'Начали обсуждение.\n' + Array(40).fill('Музыка').join('\n')
  );

  const text = await transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3');

  expect(text).toBe('Начали обсуждение.');
  expect(text).not.toMatch(/Музыка/i);
});

test('пустой результат после чистки — ошибка, а не тихий пустой транскрипт', async () => {
  (fs.readFileSync as unknown as jest.Mock).mockReturnValue(Array(40).fill('Музыка').join('\n'));

  await expect(transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3')).rejects.toThrow(/речь не распознана/);
});

test('длительность определяется через ffprobe', async () => {
  await transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3');
  expect(spawnMock.mock.calls.some(([cmd]) => cmd === 'ffprobe')).toBe(true);
});

describe('path traversal через имя загруженного файла', () => {
  test.each([
    '../../../etc/cron.d/x',
    '..%2f..%2fetc',
    '/etc/passwd',
    '....//evil.sh',
    '...',
    '..',
    '',
  ])('safeTmpName(%p) не выводит за пределы рабочего каталога', (input) => {
    const dir = '/tmp/whisper-work';
    const joined = path.join(dir, `in-${safeTmpName(input)}`);
    expect(joined.startsWith(dir + '/')).toBe(true);
    expect(path.dirname(joined)).toBe(dir);
  });

  test('обычное имя переживает санитизацию', () => {
    expect(safeTmpName('meeting.mp3')).toBe('meeting.mp3');
    expect(safeTmpName('call-2026-08-09.m4a')).toBe('call-2026-08-09.m4a');
  });

  test('вредоносное имя не попадает в путь, переданный ffmpeg', async () => {
    await transcribeLocal(Buffer.from('fake audio'), '../../../etc/cron.d/pwned');

    const written = (fs.writeFileSync as unknown as jest.Mock).mock.calls[0]![0] as string;
    expect(written).not.toContain('..');
    expect(written).toContain('whisper-');
  });
});

describe('нарезка длинного аудио', () => {
  test('часовая запись режется на куски и склеивается по порядку', async () => {
    useHourLongAudio(6);
    let n = 0;
    (fs.readFileSync as unknown as jest.Mock).mockImplementation(() => `Кусок номер ${++n}.`);

    const text = await transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3');

    const whisperRuns = spawnMock.mock.calls.filter(([cmd]) => String(cmd).includes('whisper-cli'));
    expect(whisperRuns).toHaveLength(6);
    expect(text).toBe(
      ['Кусок номер 1.', 'Кусок номер 2.', 'Кусок номер 3.', 'Кусок номер 4.', 'Кусок номер 5.', 'Кусок номер 6.'].join('\n\n')
    );
  });

  test('куски подаются whisper в числовом порядке, а не лексикографическом', async () => {
    useHourLongAudio(12);
    const text = await transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3');
    expect(text).toBeTruthy();

    const fedFiles = spawnMock.mock.calls
      .filter(([cmd]) => String(cmd).includes('whisper-cli'))
      .map(([, args]) => (args as string[])[(args as string[]).indexOf('-f') + 1]!);

    const indices = fedFiles.map((f) => parseInt(f.match(/chunk-(\d+)\.wav$/)![1]!, 10));
    expect(indices).toEqual([...Array(12).keys()]);
  });

  test('сбой одного куска не съедает остальные — на его месте плейсхолдер', async () => {
    useHourLongAudio(6);
    let call = 0;
    spawnMock.mockImplementation((cmd: string) => {
      if (cmd === 'ffprobe') return fakeChild('3600.0\n');
      if (String(cmd).includes('whisper-cli') && ++call === 3) return fakeChild('', 1);
      return fakeChild('');
    });
    let n = 0;
    (fs.readFileSync as unknown as jest.Mock).mockImplementation(() => `Живой кусок ${++n}.`);

    const text = await transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3');

    expect(text).toContain('[фрагмент 20–30 мин не распознан]');
    expect(text.match(/Живой кусок \d+\./g)).toHaveLength(5);
  });

  test('кусок, вычищенный в ноль, отмечается — время записи не пропадает молча', async () => {
    useHourLongAudio(3);
    let n = 0;
    (fs.readFileSync as unknown as jest.Mock).mockImplementation(() =>
      ++n === 2 ? Array(40).fill('Музыка').join('\n') : 'Нормальная речь.'
    );

    const text = await transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3');

    expect(text).toContain('[фрагмент 10–20 мин: речь не распознана]');
    expect(text).not.toMatch(/Музыка/i);
  });

  test('если не распознан ни один кусок — ошибка, а не пустая строка', async () => {
    useHourLongAudio(3);
    (fs.readFileSync as unknown as jest.Mock).mockReturnValue(Array(40).fill('Музыка').join('\n'));

    await expect(transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3'))
      .rejects.toThrow(/ни один из 3 кусков не распознан/);
  });

  test('рабочий каталог удаляется целиком даже при полном провале', async () => {
    useHourLongAudio(3);
    (fs.readFileSync as unknown as jest.Mock).mockReturnValue(Array(40).fill('Музыка').join('\n'));

    await expect(transcribeLocal(Buffer.from('x'), 'a.mp3')).rejects.toThrow();

    const rm = (fs.rmSync as unknown as jest.Mock).mock.calls;
    expect(rm).toHaveLength(1);
    expect(rm[0]![1]).toMatchObject({ recursive: true, force: true });
  });
});

test('оборванная нарезка отмечает потерянный хвост записи', async () => {
  // ffmpeg успел записать 2 куска из 6 и упал
  spawnMock.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'ffprobe') return fakeChild('3600.0\n');
    if (cmd === 'ffmpeg' && args.includes('segment')) return fakeChild('', 1);
    return fakeChild('');
  });
  (fs.readdirSync as unknown as jest.Mock).mockReturnValue(['chunk-00001.wav', 'chunk-00000.wav']);
  (fs.readFileSync as unknown as jest.Mock).mockImplementation(() => 'Речь куска.');

  const text = await transcribeLocal(Buffer.from('fake audio'), 'meeting.mp3');

  expect(text).toContain('[фрагмент 20–60 мин не обработан: нарезка аудио оборвалась]');
});
