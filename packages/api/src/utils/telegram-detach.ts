/**
 * Отвязывание долгих обработчиков от цикла опроса Telegram.
 *
 * Цикл опроса telegraf 4.16 (core/network/polling.js) устроен так:
 *
 *   for await (const updates of this)
 *     await Promise.all(updates.map(handleUpdate));
 *
 * — следующая пачка апдейтов НЕ запрашивается, пока не завершились обработчики
 * текущей. Вместе с `handlerTimeout: Infinity` (он выставлен намеренно, иначе
 * длинная расшифровка обрывается по таймауту) это означает, что на всё время
 * транскрибации бот перестаёт получать сообщения.
 *
 * 02.09.2026 это поймали в чистом виде: запись на 7011 секунд (24 сегмента)
 * сделала бота глухим на десятки минут — присланные файлы висели в очереди
 * Telegram непрочитанными (`pending_update_count: 2`), при том что сам процесс
 * был жив и /health отвечал за 5 мс. Заблокирован был только telegraf.
 *
 * Лечение: апдейты, обработка которых заведомо долгая, пропускаем дальше по
 * цепочке, но НЕ ждём их завершения — цикл опроса сразу идёт за следующей пачкой.
 */

/** Типы вложений, обработка которых упирается в транскрибацию. */
const LONG_RUNNING_MEDIA = ['voice', 'audio', 'document', 'video', 'video_note'] as const;

/** Команды, выполняющиеся десятки минут. */
const LONG_RUNNING_COMMAND = /^\/transcribe(?:@\w+)?(?:\s|$)/;

/**
 * Стоит ли обрабатывать этот апдейт в фоне.
 *
 * Обычный текст и короткие команды намеренно остаются синхронными: они быстрые,
 * а порядок их выполнения важен (правки черновика, ответы на кнопки).
 */
export function isLongRunningUpdate(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  const msg = message as Record<string, unknown>;

  if (LONG_RUNNING_MEDIA.some((kind) => msg[kind] != null)) return true;

  const text = msg['text'];
  return typeof text === 'string' && LONG_RUNNING_COMMAND.test(text.trim());
}

type Next = () => Promise<unknown>;

/**
 * Middleware для telegraf. Регистрировать ДО остальных обработчиков — telegraf
 * составляет цепочку в порядке регистрации.
 *
 * Для долгих апдейтов возвращает управление немедленно, оставив работу
 * выполняться в фоне. Ошибка фоновой работы не должна всплывать необработанным
 * промисом и ронять процесс, поэтому её обязательно перехватываем.
 */
export function createDetachMiddleware(onError: (err: unknown) => void) {
  return function detachLongRunning(ctx: { message?: unknown }, next: Next): Promise<void> {
    if (!isLongRunningUpdate(ctx?.message)) {
      return next() as Promise<void>;
    }

    void Promise.resolve()
      .then(next)
      .catch((err) => {
        try { onError(err); } catch { /* обработчик ошибок сам падать не должен */ }
      });

    return Promise.resolve();
  };
}
