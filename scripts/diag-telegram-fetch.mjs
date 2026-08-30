#!/usr/bin/env node
/**
 * Диагностика "❌ Ошибка: fetch failed" в телеграм-боте.
 *
 * Ошибка приходит из packages/api/src/services/telegram.service.ts:57 —
 * нативный fetch по ссылке на файл Telegram. Обработчик печатает только
 * err.message, поэтому настоящая причина (err.cause) теряется.
 * Этот скрипт воспроизводит тот же запрос и печатает cause целиком.
 *
 * Запуск на проде:
 *   cd /var/www/kanban-app/packages/api
 *   node --env-file=.env ../../scripts/diag-telegram-fetch.mjs
 *
 * Токен в вывод не попадает — везде маскируется.
 */

import dns from 'node:dns/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * node-fetch — транзитивная зависимость telegraf, а не прямая зависимость api,
 * поэтому pnpm не линкует её ни в корень, ни в packages/api/node_modules:
 * достать её можно только из каталога самого telegraf. Идём именно так —
 * заодно это гарантирует, что мы тестируем ровно тот node-fetch, которым
 * реально ходит бот. Без него шаг 3 пропускается, остальное работает.
 */
let nodeFetch = null;
for (const base of [process.cwd(), path.join(process.cwd(), 'packages/api')]) {
  try {
    const req = createRequire(path.join(base, 'noop.js'));
    const telegrafEntry = req.resolve('telegraf');
    nodeFetch = createRequire(telegrafEntry)('node-fetch');
    break;
  } catch {}
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const LOCAL_ROOT = process.env.TELEGRAM_LOCAL_API_ROOT;

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN не найден в окружении. Запусти с --env-file=.env из packages/api.');
  process.exit(1);
}

const mask = (s) => String(s).replaceAll(TOKEN, 'bot<TOKEN>');
const API_ROOT = LOCAL_ROOT || 'https://api.telegram.org';

/** Разворачивает цепочку err.cause — именно её проглатывает обработчик бота. */
function explain(err) {
  const chain = [];
  let e = err;
  while (e && chain.length < 6) {
    chain.push(`${e.name ?? 'Error'}: ${mask(e.message ?? e)}${e.code ? ` [code=${e.code}]` : ''}`);
    e = e.cause;
  }
  return chain.map((line, i) => `${'  '.repeat(i)}${i ? '└─ cause: ' : ''}${line}`).join('\n');
}

async function step(title, fn) {
  process.stdout.write(`\n▶ ${title}\n`);
  try {
    const out = await fn();
    console.log(`  ✅ ${out ?? 'ok'}`);
    return { ok: true, out };
  } catch (err) {
    console.log(`  ❌ ${explain(err)}`);
    return { ok: false, err };
  }
}

console.log('='.repeat(64));
console.log('Диагностика загрузки файлов Telegram');
console.log('='.repeat(64));
console.log(`node:                     ${process.version}`);
console.log(`TELEGRAM_LOCAL_API_ROOT:  ${LOCAL_ROOT ?? '(не задан → облачный api.telegram.org, лимит 20 МБ)'}`);
console.log(`используемый apiRoot:     ${API_ROOT}`);

// 1. DNS. Разводит "хост не резолвится" и "резолвится, но не коннектится".
//    Заодно показывает, есть ли AAAA — undici и node-fetch выбирают адрес по-разному.
if (!LOCAL_ROOT) {
  await step('DNS api.telegram.org', async () => {
    const addrs = await dns.lookup('api.telegram.org', { all: true });
    return addrs.map((a) => `${a.address} (IPv${a.family})`).join(', ');
  });
}

// 2. Bot API нативным fetch. Тот же клиент (undici), что и в упавшей строке :57,
//    но на эндпоинт, который у telegraf заведомо работает.
//    Упало здесь → проблема в связке undici↔Telegram, а не в файловом эндпоинте.
// ❌ на этом шаге обязано означать ровно сетевой сбой, поэтому ok=false
// (протухший токен) не роняем в исключение, а показываем как есть — иначе
// инструкция по чтению внизу начнёт врать.
await step('нативный fetch → getMe (undici, как в :57)', async () => {
  const res = await fetch(`${API_ROOT}/bot${TOKEN}/getMe`);
  const body = await res.json();
  return body.ok
    ? `HTTP ${res.status}, транспорт жив, бот @${body.result.username}`
    : `HTTP ${res.status}, транспорт жив, но Bot API отверг запрос: ${mask(JSON.stringify(body))}`;
});

// 3. Тот же запрос через node-fetch — клиент, которым ходит telegraf.
//    Работает здесь, но не в шаге 2 → виноват именно undici (таймауты/IPv6).
if (nodeFetch) {
  await step('node-fetch → getMe (клиент telegraf)', async () => {
    const res = await nodeFetch(`${API_ROOT}/bot${TOKEN}/getMe`);
    const body = await res.json();
    return `HTTP ${res.status}, ok=${body.ok}`;
  });
} else {
  console.log('\n▶ node-fetch → getMe (клиент telegraf)\n  ⏭  пропущен: node-fetch не найден.' +
    '\n     Запусти скрипт из /var/www/kanban-app/packages/api — тогда шаг отработает.');
}

// 4. Файловый эндпоинт. Именно он отдаёт тело файла в :57 и живёт на отдельном
//    пути (/file/bot<token>/...). Отсутствие файла — это 404, то есть коннект
//    состоялся; нам важен сам факт соединения, а не 200.
await step('нативный fetch → файловый эндпоинт', async () => {
  const res = await fetch(`${API_ROOT}/file/bot${TOKEN}/probe-nonexistent`);
  return `HTTP ${res.status} — соединение установлено (404 здесь ожидаем и означает, что транспорт жив)`;
});

// 5. Только для локального Bot API: он часто слушает 127.0.0.1, и тогда
//    падение выглядит как ECONNREFUSED из шагов выше.
if (LOCAL_ROOT) {
  await step('локальный Bot API отвечает', async () => {
    const res = await fetch(`${LOCAL_ROOT}/bot${TOKEN}/getMe`);
    return `HTTP ${res.status}`;
  });
}

console.log(`
${'='.repeat(64)}
Как читать результат:
  шаг 2 ❌, шаг 3 ✅  → виноват undici (IPv6 или connect-таймаут 10 с).
                        Лечится ProxyAgent/Agent с явными таймаутами
                        либо переводом :57 на тот же клиент, что у telegraf.
  шаг 2 ❌, шаг 3 ❌  → сеть/TLS до Telegram с этого хоста. Смотри cause:
                        ENOTFOUND — DNS, ETIMEDOUT/ECONNREFUSED — блокировка.
  шаги 2-3 ✅, шаг 4 ❌ → недоступен именно файловый эндпоинт.
  всё ✅              → сбой был разовый; тогда чинить надо ретраем и
                        сохранением err.cause, чтобы в следующий раз
                        сообщение не было пустышкой.
${'='.repeat(64)}`);
