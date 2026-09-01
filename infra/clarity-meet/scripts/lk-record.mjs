// Запустить запись аудиодорожек всех участников комнаты.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/var/www/kanban-app/packages/api/');
const jwt = require('jsonwebtoken');

const env = fs.readFileSync('/opt/clarity-meet/.env', 'utf8');
const key = env.match(/^LIVEKIT_API_KEY=(.*)$/m)?.[1]?.trim();
const secret = env.match(/^LIVEKIT_API_SECRET=(.*)$/m)?.[1]?.trim();
const комната = process.argv[2];
if (!комната) { console.error('нужно имя комнаты'); process.exit(1); }

function токен(grants) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: key, sub: 'recorder', nbf: now, exp: now + 900, video: grants },
    secret, { algorithm: 'HS256' });
}

async function вызвать(сервис, метод, тело, grants) {
  const r = await fetch(`http://127.0.0.1:7880/twirp/livekit.${сервис}/${метод}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${токен(grants)}` },
    body: JSON.stringify(тело ?? {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${метод}: HTTP ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

const { participants = [] } = await вызвать(
  'RoomService', 'ListParticipants', { room: комната },
  { roomAdmin: true, room: комната },
);

if (participants.length === 0) { console.log('В комнате никого нет.'); process.exit(0); }

for (const у of participants) {
  const аудио = (у.tracks ?? []).find((t) => t.type === 'AUDIO');
  if (!аудио) { console.log(`• ${у.name}: аудиодорожки нет, пропускаю`); continue; }

  const безопасноеИмя = String(у.identity).replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
  const файл = `/out/${комната}-${безопасноеИмя}.ogg`;

  const ответ = await вызвать('Egress', 'StartTrackEgress', {
    room_name: комната,
    track_id: аудио.sid,
    file: { filepath: файл },
  }, { roomRecord: true });

  console.log(`• ${у.name}`);
  console.log(`  дорожка ${аудио.sid} → ${файл}`);
  console.log(`  egress ${ответ.egress_id ?? ответ.egressId}, статус ${ответ.status}`);
}
