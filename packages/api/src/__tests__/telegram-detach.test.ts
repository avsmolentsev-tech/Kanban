/**
 * Регресс на «бот глохнет во время транскрибации».
 *
 * 02.09.2026: запись на 7011 с (24 сегмента) заблокировала цикл опроса telegraf
 * на десятки минут. Присланные в это время файлы висели непрочитанными
 * (`pending_update_count: 2`), хотя процесс был жив и /health отвечал за 5 мс.
 * Причина — telegraf ждёт завершения обработчиков пачки перед следующим
 * getUpdates, а `handlerTimeout: Infinity` снимает единственный предохранитель.
 */
import { isLongRunningUpdate, createDetachMiddleware } from '../utils/telegram-detach';

describe('isLongRunningUpdate', () => {
  test.each([
    ['голосовое', { voice: { file_id: 'x' } }],
    ['аудиофайл', { audio: { file_id: 'x' } }],
    ['документ', { document: { file_id: 'x' } }],
    ['видео', { video: { file_id: 'x' } }],
    ['кружок', { video_note: { file_id: 'x' } }],
  ])('%s обрабатывается в фоне', (_name, msg) => {
    expect(isLongRunningUpdate(msg)).toBe(true);
  });

  test('команда /transcribe со ссылкой — в фоне', () => {
    expect(isLongRunningUpdate({ text: '/transcribe https://drive.google.com/file/d/x/view' })).toBe(true);
  });

  test('/transcribe с упоминанием бота — тоже в фоне', () => {
    expect(isLongRunningUpdate({ text: '/transcribe@MyBestKanban_bot https://x/y.mp3' })).toBe(true);
  });

  test('голый /transcribe (подсказка формата) — тоже в фоне, обработчик один', () => {
    expect(isLongRunningUpdate({ text: '/transcribe' })).toBe(true);
  });

  test.each([
    ['обычный текст', { text: 'привет' }],
    ['другая команда', { text: '/start' }],
    ['слово transcribe в тексте', { text: 'сделай transcribe этой встречи' }],
    ['команда, начинающаяся похоже', { text: '/transcribeall' }],
    ['контакт', { contact: { phone_number: '+7' } }],
    ['фото', { photo: [{ file_id: 'x' }] }],
  ])('%s остаётся синхронным', (_name, msg) => {
    expect(isLongRunningUpdate(msg)).toBe(false);
  });

  test('пустое сообщение не роняет проверку', () => {
    expect(isLongRunningUpdate(undefined)).toBe(false);
    expect(isLongRunningUpdate(null)).toBe(false);
    expect(isLongRunningUpdate({})).toBe(false);
  });
});

describe('createDetachMiddleware', () => {
  /** Промис, который мы разрешаем вручную — имитирует долгую расшифровку. */
  function deferred() {
    let resolve!: () => void, reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  test('долгий апдейт НЕ задерживает цикл опроса', async () => {
    const slow = deferred();
    const mw = createDetachMiddleware(() => {});
    let handlerDone = false;
    const next = async () => { await slow.promise; handlerDone = true; };

    // middleware обязана вернуть управление, пока обработчик ещё работает
    await mw({ message: { voice: { file_id: 'x' } } }, next);
    expect(handlerDone).toBe(false);

    slow.resolve();
    await slow.promise;
    await Promise.resolve();
    expect(handlerDone).toBe(true);
  });

  test('обычный текст обрабатывается синхронно — управление возвращается только после обработчика', async () => {
    const mw = createDetachMiddleware(() => {});
    let handlerDone = false;
    const next = async () => { await Promise.resolve(); handlerDone = true; };

    await mw({ message: { text: 'привет' } }, next);
    expect(handlerDone).toBe(true);
  });

  test('падение фонового обработчика не всплывает наружу и попадает в onError', async () => {
    const seen: unknown[] = [];
    const mw = createDetachMiddleware((e) => seen.push(e));
    const boom = new Error('расшифровка упала');

    // если бы промис остался необработанным, Node уронил бы процесс
    await expect(mw({ message: { audio: {} } }, async () => { throw boom; })).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual([boom]);
  });

  test('ошибка внутри onError не ломает middleware', async () => {
    const mw = createDetachMiddleware(() => { throw new Error('и обработчик ошибок упал'); });
    await expect(mw({ message: { audio: {} } }, async () => { throw new Error('x'); })).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
  });

  test('ошибка синхронного апдейта пробрасывается как раньше', async () => {
    const mw = createDetachMiddleware(() => {});
    await expect(mw({ message: { text: 'привет' } }, async () => { throw new Error('упал'); }))
      .rejects.toThrow('упал');
  });
});

/**
 * Проверка не логики, а совместимости: middleware должна вести себя так же
 * внутри настоящей цепочки telegraf, а не только с самодельной заглушкой next.
 */
describe('в реальной цепочке telegraf', () => {
  const { Composer, Context } = require('telegraf');

  const BOT_INFO = { id: 1, is_bot: true, first_name: 'bot', username: 'MyBestKanban_bot' };
  const CHAT = { id: 10, type: 'private' as const };
  const FROM = { id: 20, is_bot: false, first_name: 'Александр' };

  /** Настоящий telegraf-контекст: композер проверяет `instanceof Context`. */
  const makeCtx = (message: Record<string, unknown>, updateId: number) =>
    new Context(
      { update_id: updateId, message: { message_id: updateId, date: 0, chat: CHAT, from: FROM, ...message } },
      {} as never,
      BOT_INFO,
    );

  test('голосовое отпускает цепочку до завершения обработчика, текст — нет', async () => {
    let releaseVoice!: () => void;
    const voiceWork = new Promise<void>((res) => { releaseVoice = res; });
    let voiceDone = false;
    let textDone = false;

    const composer = new Composer();
    composer.use(createDetachMiddleware(() => {}));
    composer.on('message', async (ctx: { message?: Record<string, unknown> }) => {
      if (ctx.message?.['voice']) { await voiceWork; voiceDone = true; }
      else { textDone = true; }
    });
    const handle = composer.middleware();

    // голосовое: управление должно вернуться, пока расшифровка ещё идёт
    await handle(makeCtx({ voice: { file_id: 'x', duration: 5 } }, 1), async () => {});
    expect(voiceDone).toBe(false);

    // текст: обработчик успевает отработать до возврата — порядок сохранён
    await handle(makeCtx({ text: 'привет' }, 2), async () => {});
    expect(textDone).toBe(true);

    releaseVoice();
    await voiceWork;
    await new Promise((r) => setImmediate(r));
    expect(voiceDone).toBe(true);
  });
});
