// Генерация токенов входа LiveKit. Токен — обычный JWT, подписанный
// секретом API. Секрет читается из /opt/clarity-meet/.env и не печатается.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/var/www/kanban-app/packages/api/');
const jwt = require('jsonwebtoken');

const env = fs.readFileSync('/opt/clarity-meet/.env', 'utf8');
const key = env.match(/^LIVEKIT_API_KEY=(.*)$/m)?.[1]?.trim();
const secret = env.match(/^LIVEKIT_API_SECRET=(.*)$/m)?.[1]?.trim();
if (!key || !secret) { console.error('ключи не найдены'); process.exit(1); }

const room = process.argv[2] || 'proverka';
const hours = 6;
const now = Math.floor(Date.now() / 1000);

for (const [identity, name] of [['ivan', 'Иван'], ['maria', 'Мария']]) {
  const token = jwt.sign({
    iss: key,
    sub: identity,
    nbf: now,
    exp: now + hours * 3600,
    name,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  }, secret, { algorithm: 'HS256' });
  console.log(`\n=== ${name} (${identity}) ===`);
  console.log(token);
}
console.log(`\nКомната: ${room}. Срок действия токенов: ${hours} часов.`);
