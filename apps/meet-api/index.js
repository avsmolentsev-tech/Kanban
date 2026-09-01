/**
 * Clarity Meet — сервис выдачи токенов входа.
 *
 * Зачем он вообще нужен: токен LiveKit подписывается секретом API, а секрет
 * нельзя отдавать в браузер — с ним можно зайти в любую комнату и выпустить
 * себе любые права. Поэтому подпись живёт здесь, на сервере.
 *
 * Сервис намеренно крошечный: одна ручка выдачи токена и одна проверки
 * здоровья. Комнаты, зал ожидания и роли — этап 2, здесь их нет.
 */
const express = require('express');
const jwt = require('jsonwebtoken');

/**
 * Читаем .env рядом с сервисом сами, без dotenv.
 * PM2 этой версии не понимает --env-file, а тащить зависимость ради
 * пятнадцати строк разбора не стоит. Существующие переменные окружения
 * имеют приоритет — так их можно переопределить при запуске.
 */
(function загрузитьEnv() {
  const fs = require('node:fs');
  const path = require('node:path');
  const файл = path.join(__dirname, '.env');
  if (!fs.existsSync(файл)) return;
  for (const строка of fs.readFileSync(файл, 'utf8').split('\n')) {
    const обрезанная = строка.trim();
    if (!обрезанная || обрезанная.startsWith('#')) continue;
    const позиция = обрезанная.indexOf('=');
    if (позиция < 1) continue;
    const ключ = обрезанная.slice(0, позиция).trim();
    if (process.env[ключ] !== undefined) continue;
    process.env[ключ] = обрезанная.slice(позиция + 1).trim();
  }
})();

const PORT = Number(process.env.PORT || 7890);
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const ROOM_PASSWORD = process.env.MEET_PASSWORD;
const TOKEN_HOURS = Number(process.env.MEET_TOKEN_HOURS || 6);

if (!API_KEY || !API_SECRET) {
  console.error('[meet-api] не заданы LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  process.exit(1);
}
if (!ROOM_PASSWORD) {
  console.error('[meet-api] не задан MEET_PASSWORD — сервис отказывается стартовать без пароля');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '8kb' }));

const комнаты = require('./rooms');

/**
 * Сравнение пароля постоянным временем: наивное `===` на длинных строках
 * завершается раньше при первом несовпадении, что теоретически позволяет
 * подбирать пароль по времени ответа.
 */
function passwordMatches(given) {
  const a = Buffer.from(String(given ?? ''), 'utf8');
  const b = Buffer.from(ROOM_PASSWORD, 'utf8');
  if (a.length !== b.length) return false;
  return require('node:crypto').timingSafeEqual(a, b);
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

/**
 * Создать комнату. Название — любое, хоть по-русски: оно нигде не попадает
 * ни в URL, ни в имена файлов. Для этого есть идентификатор.
 */
app.post('/api/rooms', (req, res) => {
  const { title, password } = req.body ?? {};

  if (!passwordMatches(password)) {
    res.status(401).json({ error: 'Неверный пароль' });
    return;
  }
  const название = typeof title === 'string' ? title.trim().slice(0, 120) : '';
  if (!название) {
    res.status(400).json({ error: 'Укажите название встречи' });
    return;
  }

  const комната = комнаты.создать(название);
  console.log(`[meet-api] создана комната ${комната.id}: ${название}`);
  res.status(201).json(комната);
});

/**
 * Узнать название комнаты по ссылке. Пароль здесь не нужен: название —
 * не секрет, а показать человеку, куда он попал, надо до ввода пароля.
 */
app.get('/api/rooms/:id', (req, res) => {
  const комната = комнаты.найти(req.params.id);
  if (!комната) {
    res.status(404).json({ error: 'Встреча не найдена. Проверьте ссылку.' });
    return;
  }
  res.json(комната);
});

app.post('/api/token', (req, res) => {
  const { name, roomId, password } = req.body ?? {};

  if (!passwordMatches(password)) {
    res.status(401).json({ error: 'Неверный пароль' });
    return;
  }
  const комната = комнаты.найти(roomId);
  if (!комната) {
    res.status(404).json({ error: 'Встреча не найдена. Проверьте ссылку.' });
    return;
  }
  const room = комната.id;
  const displayName = typeof name === 'string' ? name.trim().slice(0, 60) : '';
  if (!displayName) {
    res.status(400).json({ error: 'Укажите имя' });
    return;
  }

  // Идентификатор участника обязан быть уникальным в комнате: при совпадении
  // LiveKit выкидывает предыдущего участника с тем же identity.
  const identity = `${displayName}-${require('node:crypto').randomBytes(4).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);

  const token = jwt.sign(
    {
      iss: API_KEY,
      sub: identity,
      nbf: now,
      exp: now + TOKEN_HOURS * 3600,
      name: displayName,
      video: {
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    },
    API_SECRET,
    { algorithm: 'HS256' },
  );

  console.log(`[meet-api] выдан токен: комната ${room}, участник ${displayName}`);
  res.json({ token, title: комната.title });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[meet-api] слушает 127.0.0.1:${PORT}, токены живут ${TOKEN_HOURS} ч`);
});
