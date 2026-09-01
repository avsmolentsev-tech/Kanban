// Остановить все активные записи и показать результат.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/var/www/kanban-app/packages/api/');
const jwt = require('jsonwebtoken');

const env = fs.readFileSync('/opt/clarity-meet/.env', 'utf8');
const key = env.match(/^LIVEKIT_API_KEY=(.*)$/m)?.[1]?.trim();
const secret = env.match(/^LIVEKIT_API_SECRET=(.*)$/m)?.[1]?.trim();

function токен() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: key, sub: 'recorder', nbf: now, exp: now + 600, video: { roomRecord: true } },
    secret, { algorithm: 'HS256' });
}

async function вызвать(метод, тело) {
  const r = await fetch(`http://127.0.0.1:7880/twirp/livekit.Egress/${метод}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${токен()}` },
    body: JSON.stringify(тело ?? {}),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${метод}: HTTP ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

const { items = [] } = await вызвать('ListEgress', { active: true });
if (items.length === 0) { console.log('Активных записей нет.'); process.exit(0); }

for (const е of items) {
  const id = е.egress_id ?? е.egressId;
  console.log(`Останавливаю ${id} (комната ${е.room_name ?? е.roomName})`);
  const ответ = await вызвать('StopEgress', { egress_id: id });
  console.log(`  статус: ${ответ.status}`);
  const файл = ответ.file ?? (ответ.file_results ?? ответ.fileResults ?? [])[0];
  if (файл) {
    console.log(`  файл: ${файл.filename}`);
    console.log(`  размер: ${файл.size} байт, длительность: ${Number(файл.duration ?? 0) / 1e9} с`);
  }
}
