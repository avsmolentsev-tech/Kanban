/**
 * Хранилище комнат.
 *
 * Название комнаты и её идентификатор — разные вещи. Название пишет человек
 * на любом языке («Планёрка с юристами»), идентификатор генерируем мы: он
 * попадает в имя комнаты LiveKit, в ссылку и в пути к файлам записи, поэтому
 * обязан быть безопасным для URL и файловой системы.
 *
 * Хранение — JSON-файл на диске. Для прототипа этого достаточно, а переезд
 * в Postgres будет заменой трёх функций ниже.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ФАЙЛ = process.env.MEET_ROOMS_FILE || path.join(__dirname, 'rooms.json');

/** Без похожих символов: 0/O, 1/l/I — их путают, когда диктуют ссылку голосом. */
const АЛФАВИТ = 'abcdefghjkmnpqrstuvwxyz23456789';

function прочитать() {
  try {
    return JSON.parse(fs.readFileSync(ФАЙЛ, 'utf8'));
  } catch {
    return {};
  }
}

function записать(данные) {
  const временный = `${ФАЙЛ}.tmp`;
  fs.writeFileSync(временный, JSON.stringify(данные, null, 2), { mode: 0o600 });
  // Переименование атомарно: файл никогда не окажется наполовину записанным,
  // даже если процесс умрёт в этот момент.
  fs.renameSync(временный, ФАЙЛ);
}

function новыйId() {
  const байты = crypto.randomBytes(9);
  let id = '';
  for (const б of байты) id += АЛФАВИТ[б % АЛФАВИТ.length];
  // Группы по три через дефис: xxx-xxx-xxx. Так ссылку можно продиктовать.
  return `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6, 9)}`;
}

const ID_RE = /^[a-z2-9]{3}-[a-z2-9]{3}-[a-z2-9]{3}$/;

/** Создать комнату с произвольным названием. Возвращает {id, title}. */
function создать(title) {
  const данные = прочитать();
  let id = новыйId();
  while (данные[id]) id = новыйId();
  данные[id] = { title, createdAt: new Date().toISOString() };
  записать(данные);
  return { id, title };
}

/** Найти комнату по идентификатору. Возвращает {id, title} или null. */
function найти(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const запись = прочитать()[id];
  return запись ? { id, title: запись.title } : null;
}

module.exports = { создать, найти, ID_RE };
