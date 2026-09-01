/**
 * Хранилище комнат.
 *
 * Название комнаты и её идентификатор — разные вещи. Название пишет человек
 * на любом языке («Планёрка с юристами»), идентификатор генерируем мы: он
 * попадает в имя комнаты LiveKit, в ссылку и в пути к файлам записи, поэтому
 * обязан быть безопасным для URL и файловой системы.
 *
 * У каждой комнаты свой пароль — или его нет вовсе, и тогда пропуском служит
 * сама ссылка. Идентификатор из девяти символов алфавита в 31 знак даёт
 * порядка 2.6e13 вариантов, перебором такое не находится.
 *
 * Хранение — JSON-файл на диске. Для прототипа этого достаточно, а переезд
 * в Postgres будет заменой функций ниже.
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

/**
 * Пароль комнаты хранится хешем со своей солью. scrypt, а не голый sha256:
 * пароли встреч люди делают короткими и предсказуемыми, а scrypt намеренно
 * медленный и требует памяти, поэтому перебор украденного файла невыгоден.
 */
function захешировать(пароль) {
  const соль = crypto.randomBytes(16);
  const хеш = crypto.scryptSync(пароль, соль, 32);
  return `${соль.toString('hex')}:${хеш.toString('hex')}`;
}

function сверить(пароль, хранимое) {
  if (!хранимое) return true; // у комнаты нет пароля — пускаем по ссылке
  const [сольHex, хешHex] = String(хранимое).split(':');
  if (!сольHex || !хешHex) return false;
  const ожидаемый = Buffer.from(хешHex, 'hex');
  const полученный = crypto.scryptSync(String(пароль ?? ''), Buffer.from(сольHex, 'hex'), 32);
  return ожидаемый.length === полученный.length && crypto.timingSafeEqual(ожидаемый, полученный);
}

/**
 * Создать комнату. Пароль необязателен: без него пропуском служит ссылка.
 * Возвращает {id, title, защищена}.
 */
function создать(title, пароль) {
  const данные = прочитать();
  let id = новыйId();
  while (данные[id]) id = новыйId();
  const есть = typeof пароль === 'string' && пароль.length > 0;
  данные[id] = {
    title,
    passwordHash: есть ? захешировать(пароль) : null,
    createdAt: new Date().toISOString(),
  };
  записать(данные);
  return { id, title, защищена: есть };
}

/**
 * Запомнить, какому человеку принадлежит идентификатор участника.
 *
 * Имя нельзя кодировать в имя файла записи: там вычищается всё, кроме
 * латиницы и цифр, поэтому «Иван Петров» превращался в подчёркивания, а при
 * разборе обратно — в безликого «Участника». Два русских имени схлопывались
 * в одно, и вся привязка реплик к людям рушилась.
 *
 * Теперь в имени файла только безопасный суффикс идентификатора, а живое имя
 * лежит здесь и достаётся по нему.
 */
function запомнитьУчастника(id, identity, имя) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return;
  const данные = прочитать();
  const запись = данные[id];
  if (!запись) return;
  запись.participants = запись.participants || {};
  запись.participants[identity] = имя;
  записать(данные);
}

/** Имя участника по идентификатору. Возвращает null, если не запоминали. */
function участник(id, identity) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const запись = прочитать()[id];
  return запись?.participants?.[identity] ?? null;
}

/** Все участники комнаты: идентификатор → имя. */
function участники(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return {};
  return прочитать()[id]?.participants ?? {};
}

/** Запомнить, какая встреча в Clarity Space соответствует этой комнате. */
function запомнитьВстречуClarity(id, meetingId) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return;
  const данные = прочитать();
  if (!данные[id]) return;
  данные[id].clarityMeetingId = meetingId;
  записать(данные);
}

/** Идентификатор встречи в Clarity Space, если её уже отправляли. */
function встречаClarity(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  return прочитать()[id]?.clarityMeetingId ?? null;
}

/** Найти комнату. Возвращает {id, title, защищена} или null. Хеш наружу не отдаём. */
function найти(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const запись = прочитать()[id];
  if (!запись) return null;
  return { id, title: запись.title, защищена: Boolean(запись.passwordHash) };
}

/** Проверить пароль входа в комнату. Для комнаты без пароля всегда true. */
function пропустить(id, пароль) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return false;
  const запись = прочитать()[id];
  if (!запись) return false;
  return сверить(пароль, запись.passwordHash);
}

module.exports = {
  создать, найти, пропустить, ID_RE,
  запомнитьУчастника, участник, участники,
  запомнитьВстречуClarity, встречаClarity,
};
