// Активные комнаты LiveKit и участники в них.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/var/www/kanban-app/packages/api/');
const jwt = require('jsonwebtoken');

const env = fs.readFileSync('/opt/clarity-meet/.env', 'utf8');
const key = env.match(/^LIVEKIT_API_KEY=(.*)$/m)?.[1]?.trim();
const secret = env.match(/^LIVEKIT_API_SECRET=(.*)$/m)?.[1]?.trim();

function токен(grants) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: key, sub: 'admin', nbf: now, exp: now + 600, video: grants },
    secret, { algorithm: 'HS256' });
}

async function вызвать(метод, тело, grants) {
  const r = await fetch(`http://127.0.0.1:7880/twirp/livekit.RoomService/${метод}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${токен(grants)}` },
    body: JSON.stringify(тело ?? {}),
  });
  const t = await r.text();
  if (!r.ok) return { _ошибка: `HTTP ${r.status} ${t.slice(0, 120)}` };
  return JSON.parse(t);
}

let названия = {};
try { названия = JSON.parse(fs.readFileSync('/opt/clarity-meet/meet-api/rooms.json', 'utf8')); } catch {}

const { rooms = [], _ошибка } = await вызвать('ListRooms', {}, { roomList: true });
if (_ошибка) { console.log('Не удалось получить список комнат:', _ошибка); process.exit(1); }
if (rooms.length === 0) { console.log('Активных комнат нет.'); process.exit(0); }

for (const к of rooms) {
  const название = названия[к.name]?.title ?? '(без названия)';
  console.log(`\nКомната ${к.name} — «${название}», участников: ${к.numParticipants ?? 0}`);
  const ответ = await вызвать('ListParticipants', { room: к.name }, { roomAdmin: true, room: к.name });
  if (ответ._ошибка) { console.log('  участников получить не удалось:', ответ._ошибка); continue; }
  for (const у of ответ.participants ?? []) {
    const дорожки = (у.tracks ?? []).map((t) => `${t.type}${t.muted ? ' (выключена)' : ''}`).join(', ') || 'нет';
    console.log(`  • ${у.name || у.identity} — identity: ${у.identity}`);
    console.log(`    дорожки: ${дорожки}`);
  }
}
