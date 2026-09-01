/**
 * Fix 3 (task-7 демо-готовности, security): routes/index.ts отдаёт Attachments/
 * публично без авторизации, полагаясь на то, что имя файла нельзя подобрать.
 * До этого фикса имя было `{id}-{Date.now()}{ext}` — id небольшое целое,
 * Date.now() энумерируем, так что имя подбиралось перебором (см. отчёт
 * задачи 7). Эти тесты фиксируют, что генераторы имён теперь используют
 * crypto-случайный токен: два вызова с одним и тем же id в один и тот же
 * (замоканный) момент времени обязаны дать разные имена.
 */
import {
  randomAttachmentToken,
  documentAttachmentFilename,
  personPhotoFilename,
  taskAttachmentFilename,
} from '../utils/upload-filter';

describe('randomAttachmentToken', () => {
  test('возвращает 32 hex-символа (16 байт, 128 бит)', () => {
    const token = randomAttachmentToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  test('два последовательных вызова дают разные токены', () => {
    const a = randomAttachmentToken();
    const b = randomAttachmentToken();
    expect(a).not.toBe(b);
  });
});

describe('генераторы имён файлов вложений — непредсказуемость не зависит от id/времени', () => {
  const FIXED_NOW = 1756640000000; // произвольная фиксированная метка времени

  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  test('documentAttachmentFilename: тот же docId и то же время → разные имена', () => {
    const a = documentAttachmentFilename(42, '.png');
    const b = documentAttachmentFilename(42, '.png');
    expect(a).not.toBe(b);
    // Старый предсказуемый префикс "42-1756640000000" всё ещё узнаваем для
    // читаемости, но сам по себе не образует полное имя файла.
    expect(a.startsWith('42-1756640000000-')).toBe(true);
    expect(a.endsWith('.png')).toBe(true);
    expect(a).not.toBe('42-1756640000000.png');
  });

  test('personPhotoFilename: тот же id и то же время → разные имена', () => {
    const a = personPhotoFilename(7, '.jpg');
    const b = personPhotoFilename(7, '.jpg');
    expect(a).not.toBe(b);
    expect(a.startsWith('person-7-1756640000000-')).toBe(true);
    expect(a).not.toBe('person-7-1756640000000.jpg');
  });

  test('taskAttachmentFilename: тот же taskId и то же время → разные имена', () => {
    const a = taskAttachmentFilename(99, '.pdf');
    const b = taskAttachmentFilename(99, '.pdf');
    expect(a).not.toBe(b);
    expect(a.startsWith('task-99-1756640000000-')).toBe(true);
    expect(a).not.toBe('task-99-1756640000000.pdf');
  });

  test('имя нельзя восстановить, зная только id и время (энтропия — 32 hex-символа)', () => {
    const filename = documentAttachmentFilename(1, '.png');
    const match = filename.match(/^1-1756640000000-([0-9a-f]{32})\.png$/);
    expect(match).not.toBeNull();
  });
});
