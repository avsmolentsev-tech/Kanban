# Clarity Space: готовность к демо корпоративному заказчику

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести Clarity Space до состояния, в котором крупный корпоративный заказчик может проверить сервис по своим чек-листам — здоровье, интегрируемость, управление доступом, обращение с персональными данными — и починить два реальных бага в пайплайне расшифровки.

**Architecture:** Все изменения — внутри существующего монолита `packages/api` (Express + Postgres). Никаких новых сервисов, контейнеров и языков. Три новых сервиса-модуля (`health`, `pii-redact`, `api-tokens`), один новый роут (`mcp`), правки в двух существующих сервисах Whisper. Паттерны заимствованы из рунбука Conference: настоящий health-check зависимостей, мягкая деградация через 501, версионированный API с OpenAPI, токены с хранением хеша, MCP внутри основного API, обрезка тишины перед STT, очередь тяжёлых задач в БД.

**Tech Stack:** TypeScript, Express, Postgres (`pg`), jest + ts-jest, ffmpeg, whisper.cpp, OpenAI-совместимый клиент (`openai` npm) с настраиваемым `baseURL`.

**Spec:** дизайн встроен в этот документ (раздел «Обоснование и границы»). Источник паттернов — рунбук «Conference · self-hosted ВКС на LiveKit», раздел про персданные — `attachments/AI-Battle-main/баттл-3/5-персональные-данные-и-152-ФЗ.md`.

---

## Обоснование и границы

### Что НЕ делаем и почему

**ВКС на этом сервере не разворачиваем.** Два независимых блокера:

1. **Кода нет.** У нас только рунбук развёртывания. Открытый в нём — LiveKit SFU и Egress; закрытое — Go-приложение «Conference», которое всё это связывает. Без него «развернуть» нечего, надо писать свой бэкенд.
2. **Сервер не тянет.** Проверено на 31.128.43.174 (31.08.2026): **4 vCPU, 15 GB RAM (доступно ~6 GB), 30 GB свободного диска**. Рунбук требует минимум 8 vCPU / 8 GB, при этом egress ест ~1 ядро на видеодорожку, а воркер сборки — 6 ядер. Одна записываемая встреча вдвоём насытит все 4 ядра и уронит отзывчивость Clarity Space, которая живёт на этой же машине рядом с `mm-challenge`. Плюс записи некуда складывать: S3 не подключён, свободных 30 GB хватит на считанные часы видео.

ВКС — это Фаза 2: отдельная машина от 8 vCPU + S3. К презентации не успевает и не нужен для неё.

### Ответ на вопрос про персданные: локальная очистка, Яндекс — как опция

Делаем **и то и другое, но в правильном порядке**.

Аудио у нас **уже не покидает сервер** — расшифровка идёт локальным whisper.cpp (`whisper-local.service.ts`). Наружу уходит только текст транскрипта, и то на этапе резюмирования. Значит формула Хлебинского («наружу — только обезличенное, соответствие — только у вас») реализуется у нас дешевле, чем у него: обезличиваем текст перед отправкой в LLM, таблицу соответствия держим в нашей БД, подстановку реальных имён обратно делает наш код.

Переезд на Яндекс целиком — не нужен, но **переключаемость провайдера нужна**: это прямой ответ на вопрос «а если мы потребуем, чтобы данные не покидали РФ». У нас уже половина этого есть — `services/claude.service.ts:24` создаёт клиент как `new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl })`, то есть `OPENAI_BASE_URL` уже управляет адресом. Задача 5 доводит это до конца и делает явным.

Итог для разговора с заказчиком: «аудио не покидает наш контур вообще; в модель уходит обезличенный текст; при необходимости модель переключается на российскую одной переменной окружения».

**Оговорка:** это инженерная мера, а не юридическое заключение. Формулировки для договора и уведомление в РКН — к юристу.

### Два бага, которые чиним попутно

1. **Очередь расшифровки теряет задачи при каждом деплое.** `whisper-queue.ts` держит задачи и аудио-буферы в памяти процесса (`queue.shift()`, строка 80). Деплой по CLAUDE.md — `pm2 delete` + `pm2 start`. Значит любая расшифровка в полёте молча умирает, а пользователь ждёт вечно.
2. **Тишина провоцирует галлюцинации Whisper.** Регресс-тест `__tests__/transcript-sanitize.test.ts` ловит петлю «Музыка» уже *после* распознавания. При этом `whisper-queue.ts:87` `boostAudio` **усиливает** тихое аудио, поднимая шум в паузах. Рунбук лечит причину: резать тишину до отправки в модель.

Язык распознавания задан явно (`'-l', 'ru'` в `whisper-local.service.ts:155`) — эта грабля у нас уже закрыта, не трогаем.

## Global Constraints

- Сервер прод: 4 vCPU / 15 GB / 30 GB свободно. Ничего, что требует больше — не добавляем.
- Тесты: `cd packages/api && npm test` (jest, `--runInBand`). Каждая задача заканчивается зелёными тестами.
- БД: Postgres через `import { query, queryAll, queryOne, execute } from '../db/db'`, плейсхолдеры `$1, $2`. Схема — `src/db/schema-pg.sql`.
- Сборка API: `cd packages/api && npx tsc`. Деплой: `pm2 delete kanban-api` + `pm2 start dist/index.js --name kanban-api` + `pm2 save`.
- Локальное дерево отстаёт от прода. **Перед первой задачей сверить рабочую копию с сервером** (Задача 0).
- Все пользовательские строки — на русском.
- Никаких новых тяжёлых зависимостей. `openai`, `pg`, `express` уже есть.
- Мягкая деградация: отсутствующий ключ/сервис не роняет процесс, соответствующий эндпоинт отвечает 501.

---

### Task 0: Синхронизация с продом

**Files:**
- Modify: рабочая копия целиком

**Interfaces:**
- Consumes: —
- Produces: рабочая копия, совпадающая с продом; все последующие задачи опираются на неё

- [ ] **Step 1: Снять актуальный код с сервера**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'cd /var/www/kanban-app && git log --oneline -5 && git status --short | head -20'
```

- [ ] **Step 2: Сравнить с локальным деревом**

```bash
cd /root/projects/Kanban && git log --oneline -5
```

Если прод впереди — подтянуть его состояние в рабочую копию (через общий remote, либо `rsync` каталогов `packages/api/src` и `apps/web/src`). Ожидаемо: локальный HEAD `3781f89`, на проде — новее.

- [ ] **Step 3: Убедиться, что тесты на актуальном коде зелёные**

Run: `cd packages/api && npm test`
Expected: PASS. Если что-то падает **до** наших изменений — зафиксировать список в этом файле и не чинить в рамках плана.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: синхронизация рабочей копии с продом перед доработками"
```

---

### Task 1: Настоящий /health с проверкой зависимостей

Сейчас `/health` (`src/index.ts:54`) отдаёт `{status:'ok'}` безусловно — он скажет «ок» при мёртвом Postgres.

**Files:**
- Create: `packages/api/src/services/health.service.ts`
- Create: `packages/api/src/__tests__/health.test.ts`
- Modify: `packages/api/src/index.ts:54-56`

**Interfaces:**
- Consumes: `query` из `../db/db`, `config` из `../config`
- Produces: `checkHealth(): Promise<HealthReport>`, где
  `type HealthCheck = { name: string; ok: boolean; detail?: string }` и
  `type HealthReport = { status: 'ok' | 'degraded' | 'down'; ts: string; checks: HealthCheck[] }`

- [ ] **Step 1: Написать падающий тест**

```typescript
// packages/api/src/__tests__/health.test.ts
import { checkHealth } from '../services/health.service';

jest.mock('../db/db', () => ({ query: jest.fn() }));
import { query } from '../db/db';

describe('checkHealth', () => {
  beforeEach(() => jest.clearAllMocks());

  test('живая база и доступный vault → status ok', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    const r = await checkHealth();
    const db = r.checks.find((c) => c.name === 'postgres');
    expect(db?.ok).toBe(true);
    expect(['ok', 'degraded']).toContain(r.status);
  });

  test('мёртвая база → status down, а не ok', async () => {
    (query as jest.Mock).mockRejectedValue(new Error('connection refused'));
    const r = await checkHealth();
    expect(r.status).toBe('down');
    const db = r.checks.find((c) => c.name === 'postgres');
    expect(db?.ok).toBe(false);
    expect(db?.detail).toContain('connection refused');
  });

  test('отчёт содержит проверки по всем зависимостям', async () => {
    (query as jest.Mock).mockResolvedValue({ rows: [{ ok: 1 }] });
    const names = (await checkHealth()).checks.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['postgres', 'vault', 'whisper', 'llm']));
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd packages/api && npx jest src/__tests__/health.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../services/health.service'`

- [ ] **Step 3: Реализовать минимально**

```typescript
// packages/api/src/services/health.service.ts
import * as fs from 'fs';
import { query } from '../db/db';
import { config } from '../config';
import { isLocalWhisperAvailable } from './whisper-queue';

export type HealthCheck = { name: string; ok: boolean; detail?: string };
export type HealthReport = { status: 'ok' | 'degraded' | 'down'; ts: string; checks: HealthCheck[] };

/** postgres — критичная зависимость; остальные деградируют мягко. */
const CRITICAL = new Set(['postgres']);

async function checkPostgres(): Promise<HealthCheck> {
  try {
    await query('SELECT 1');
    return { name: 'postgres', ok: true };
  } catch (e) {
    return { name: 'postgres', ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function checkVault(): HealthCheck {
  try {
    fs.accessSync(config.vaultPath, fs.constants.R_OK | fs.constants.W_OK);
    return { name: 'vault', ok: true };
  } catch (e) {
    return { name: 'vault', ok: false, detail: `нет доступа к ${config.vaultPath}` };
  }
}

function checkWhisper(): HealthCheck {
  const ok = isLocalWhisperAvailable();
  return ok
    ? { name: 'whisper', ok: true }
    : { name: 'whisper', ok: false, detail: 'локальный whisper недоступен, расшифровка уйдёт во внешний сервис' };
}

function checkLlm(): HealthCheck {
  const ok = Boolean(config.anthropicApiKey || config.openaiApiKey);
  return ok ? { name: 'llm', ok: true } : { name: 'llm', ok: false, detail: 'ключ LLM не задан, AI-функции отключены' };
}

export async function checkHealth(): Promise<HealthReport> {
  const checks: HealthCheck[] = [await checkPostgres(), checkVault(), checkWhisper(), checkLlm()];
  const failedCritical = checks.some((c) => !c.ok && CRITICAL.has(c.name));
  const failedAny = checks.some((c) => !c.ok);
  return {
    status: failedCritical ? 'down' : failedAny ? 'degraded' : 'ok',
    ts: new Date().toISOString(),
    checks,
  };
}
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `cd packages/api && npx jest src/__tests__/health.test.ts --runInBand`
Expected: PASS (3 теста)

- [ ] **Step 5: Подключить к эндпоинту**

Заменить `packages/api/src/index.ts:54-56` на:

```typescript
app.get('/health', async (_req, res) => {
  const report = await checkHealth();
  res.status(report.status === 'down' ? 503 : 200).json(report);
});
```

И добавить импорт в шапку файла: `import { checkHealth } from './services/health.service';`

- [ ] **Step 6: Прогнать весь набор тестов**

Run: `cd packages/api && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/health.service.ts packages/api/src/__tests__/health.test.ts packages/api/src/index.ts
git commit -m "feat(health): /health проверяет postgres, vault, whisper и LLM, отдаёт 503 при отказе критичной зависимости"
```

---

### Task 2: Обрезка тишины перед распознаванием

Лечим причину галлюцинаций «Музыка, Музыка» вместо симптома.

**Files:**
- Modify: `packages/api/src/services/whisper-local.service.ts` (конвертация в WAV, строка ~229)
- Create: `packages/api/src/__tests__/whisper-silence.test.ts`

**Interfaces:**
- Consumes: `runCommand` из того же файла
- Produces: экспортируемая `buildSilenceFilter(): string` — строка фильтра ffmpeg, переиспользуется в тестах

- [ ] **Step 1: Написать падающий тест**

```typescript
// packages/api/src/__tests__/whisper-silence.test.ts
import { buildSilenceFilter } from '../services/whisper-local.service';

describe('обрезка тишины перед whisper', () => {
  test('фильтр вырезает тишину с обоих концов и длинные паузы внутри', () => {
    const f = buildSilenceFilter();
    expect(f).toContain('silenceremove');
    expect(f).toContain('start_periods=1');
    expect(f).toContain('stop_periods=-1');
    expect(f).toMatch(/-40dB|-45dB|-50dB/);
  });

  test('фильтр не схлопывает короткие естественные паузы', () => {
    const f = buildSilenceFilter();
    const dur = f.match(/stop_duration=([\d.]+)/);
    expect(dur).not.toBeNull();
    expect(parseFloat(dur![1])).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd packages/api && npx jest src/__tests__/whisper-silence.test.ts --runInBand`
Expected: FAIL — `buildSilenceFilter is not a function`

- [ ] **Step 3: Реализовать**

Добавить в `packages/api/src/services/whisper-local.service.ts`:

```typescript
/**
 * Фильтр обрезки тишины для ffmpeg.
 * Whisper на длинной тишине выдумывает текст («Музыка», «Продолжение следует»),
 * поэтому паузы режутся ДО распознавания, а не чистятся после.
 * stop_duration=1.5 — короткие паузы в речи сохраняются, схлопываются только длинные.
 */
export function buildSilenceFilter(): string {
  return 'silenceremove=start_periods=1:start_duration=0.3:start_threshold=-45dB:' +
    'stop_periods=-1:stop_duration=1.5:stop_threshold=-45dB';
}
```

Затем в конвертации в WAV (строка ~229) добавить фильтр:

```typescript
// 1. Convert to WAV 16kHz mono (any format → wav via ffmpeg), обрезая тишину
await runCommand('ffmpeg', [
  '-i', inputPath, '-vn',
  '-af', buildSilenceFilter(),
  '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath, '-y',
], 300000);
```

- [ ] **Step 4: Запустить тесты и убедиться, что проходят**

Run: `cd packages/api && npx jest src/__tests__/whisper-silence.test.ts src/__tests__/whisper-local.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Убрать усиление тихого аудио**

В `packages/api/src/services/whisper-queue.ts` `boostAudio` (строка ~87) поднимает громкость всей дорожки, включая шум в паузах — это работает против обрезки тишины. Удалить вызов `boostAudio` из пути обработки, саму функцию оставить неиспользуемой не нужно — удалить целиком.

- [ ] **Step 6: Проверить на живом файле**

```bash
cd packages/api && node -e "
const { transcribeLocal } = require('./dist/services/whisper-local.service');
const fs = require('fs');
transcribeLocal(fs.readFileSync(process.argv[1]), 'test.m4a').then(t => {
  console.log('длина:', t.length);
  console.log('петля Музыка:', /(Музыка[\s.,]*){3,}/i.test(t) ? 'ЕСТЬ — плохо' : 'нет — хорошо');
});" /path/to/запись-с-паузами.m4a
```

Expected: «петля Музыка: нет». Взять реальный файл с длинными паузами.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/whisper-local.service.ts packages/api/src/services/whisper-queue.ts packages/api/src/__tests__/whisper-silence.test.ts
git commit -m "fix(whisper): резать тишину перед распознаванием вместо усиления тихого аудио"
```

---

### Task 3: Очередь расшифровки переживает перезапуск

Сейчас задачи и аудио живут в памяти процесса и умирают при `pm2 delete`.

**Files:**
- Modify: `packages/api/src/db/schema-pg.sql` (новая таблица)
- Create: `packages/api/src/services/transcription-jobs.ts`
- Create: `packages/api/src/__tests__/transcription-jobs.test.ts`
- Modify: `packages/api/src/services/whisper-queue.ts`

**Interfaces:**
- Consumes: `query`, `queryOne`, `queryAll`, `execute` из `../db/db`
- Produces:
  - `enqueueJob(input: { userId: number; filename: string; audioPath: string }): Promise<number>` — id задачи
  - `claimNextJob(): Promise<TranscriptionJob | null>` — атомарный захват одной задачи
  - `completeJob(id: number, text: string): Promise<void>`
  - `failJob(id: number, error: string): Promise<void>`
  - `resumeStuckJobs(): Promise<number>` — возвращает `running` задачи в `pending` при старте, отдаёт количество
  - `type TranscriptionJob = { id: number; user_id: number; filename: string; audio_path: string; status: string; attempts: number }`

- [ ] **Step 1: Добавить таблицу в схему**

В конец `packages/api/src/db/schema-pg.sql`:

```sql
CREATE TABLE IF NOT EXISTS transcription_jobs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  filename    TEXT NOT NULL,
  audio_path  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  attempts    INTEGER NOT NULL DEFAULT 0,
  result_text TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_status ON transcription_jobs (status, id);
```

- [ ] **Step 2: Написать падающий тест**

```typescript
// packages/api/src/__tests__/transcription-jobs.test.ts
import { enqueueJob, claimNextJob, completeJob, failJob, resumeStuckJobs } from '../services/transcription-jobs';

jest.mock('../db/db', () => ({
  query: jest.fn(), queryAll: jest.fn(), queryOne: jest.fn(), execute: jest.fn(),
}));
import { queryOne, execute } from '../db/db';

describe('очередь расшифровки в БД', () => {
  beforeEach(() => jest.clearAllMocks());

  test('задача ставится в очередь со статусом pending', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 42 });
    const id = await enqueueJob({ userId: 1, filename: 'a.m4a', audioPath: '/tmp/a.m4a' });
    expect(id).toBe(42);
    const [sql, params] = (queryOne as jest.Mock).mock.calls[0];
    expect(sql).toContain('INSERT INTO transcription_jobs');
    expect(params).toEqual([1, 'a.m4a', '/tmp/a.m4a']);
  });

  test('захват задачи атомарен — одним UPDATE с блокировкой строки', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 7, user_id: 1, filename: 'a', audio_path: '/tmp/a', status: 'running', attempts: 1 });
    const job = await claimNextJob();
    const [sql] = (queryOne as jest.Mock).mock.calls[0];
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('SKIP LOCKED');
    expect(job?.id).toBe(7);
  });

  test('пустая очередь возвращает null', async () => {
    (queryOne as jest.Mock).mockResolvedValue(null);
    expect(await claimNextJob()).toBeNull();
  });

  test('перезапуск возвращает зависшие running обратно в pending', async () => {
    (execute as jest.Mock).mockResolvedValue(3);
    const n = await resumeStuckJobs();
    expect(n).toBe(3);
    const [sql] = (execute as jest.Mock).mock.calls[0];
    expect(sql).toContain("SET status = 'pending'");
    expect(sql).toContain("WHERE status = 'running'");
  });

  test('успешная задача сохраняет текст и статус done', async () => {
    (execute as jest.Mock).mockResolvedValue(1);
    await completeJob(7, 'расшифровка');
    const [sql, params] = (execute as jest.Mock).mock.calls[0];
    expect(sql).toContain("status = 'done'");
    expect(params).toEqual(['расшифровка', 7]);
  });

  test('неуспешная задача сохраняет ошибку', async () => {
    (execute as jest.Mock).mockResolvedValue(1);
    await failJob(7, 'whisper упал');
    const [sql, params] = (execute as jest.Mock).mock.calls[0];
    expect(sql).toContain("status = 'failed'");
    expect(params).toEqual(['whisper упал', 7]);
  });
});
```

- [ ] **Step 3: Запустить тест и убедиться, что падает**

Run: `cd packages/api && npx jest src/__tests__/transcription-jobs.test.ts --runInBand`
Expected: FAIL — модуль не найден

- [ ] **Step 4: Реализовать**

```typescript
// packages/api/src/services/transcription-jobs.ts
import { queryOne, execute } from '../db/db';

export type TranscriptionJob = {
  id: number;
  user_id: number;
  filename: string;
  audio_path: string;
  status: string;
  attempts: number;
};

export async function enqueueJob(input: { userId: number; filename: string; audioPath: string }): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO transcription_jobs (user_id, filename, audio_path) VALUES ($1, $2, $3) RETURNING id`,
    [input.userId, input.filename, input.audioPath],
  );
  return row!.id;
}

/**
 * Атомарный захват: SKIP LOCKED позволяет нескольким воркерам тянуть
 * из общей очереди, не конфликтуя и не обрабатывая одну задачу дважды.
 */
export async function claimNextJob(): Promise<TranscriptionJob | null> {
  return await queryOne<TranscriptionJob>(
    `UPDATE transcription_jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM transcription_jobs WHERE status = 'pending'
       ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
     )
     RETURNING id, user_id, filename, audio_path, status, attempts`,
  );
}

export async function completeJob(id: number, text: string): Promise<void> {
  await execute(
    `UPDATE transcription_jobs SET status = 'done', result_text = $1, updated_at = now() WHERE id = $2`,
    [text, id],
  );
}

export async function failJob(id: number, error: string): Promise<void> {
  await execute(
    `UPDATE transcription_jobs SET status = 'failed', error = $1, updated_at = now() WHERE id = $2`,
    [error, id],
  );
}

/**
 * Деплой — это pm2 delete + pm2 start, поэтому задачи в статусе running
 * при старте процесса заведомо осиротевшие: возвращаем их в очередь.
 */
export async function resumeStuckJobs(): Promise<number> {
  return await execute(
    `UPDATE transcription_jobs SET status = 'pending', updated_at = now()
     WHERE status = 'running' AND attempts < 3`,
  );
}
```

- [ ] **Step 5: Запустить тест и убедиться, что проходит**

Run: `cd packages/api && npx jest src/__tests__/transcription-jobs.test.ts --runInBand`
Expected: PASS (6 тестов)

- [ ] **Step 6: Подключить к старту приложения**

В `packages/api/src/index.ts`, в функции `start()` после `seedDb()`:

```typescript
const resumed = await resumeStuckJobs();
if (resumed > 0) console.log(`[transcription] возвращено в очередь после перезапуска: ${resumed}`);
```

Импорт: `import { resumeStuckJobs } from './services/transcription-jobs';`

- [ ] **Step 7: Перевести whisper-queue на БД**

В `whisper-queue.ts` заменить хранение задач в памяти: аудио писать на диск во временный каталог и класть путь в `enqueueJob`, воркер тянуть через `claimNextJob`, результат сохранять `completeJob`/`failJob`. Буферы в памяти не держать. Существующий фолбэк на OpenAI при падении локального whisper (строки 67–75) сохранить как есть.

- [ ] **Step 8: Прогнать весь набор тестов**

Run: `cd packages/api && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/services/transcription-jobs.ts packages/api/src/__tests__/transcription-jobs.test.ts packages/api/src/db/schema-pg.sql packages/api/src/services/whisper-queue.ts packages/api/src/index.ts
git commit -m "fix(whisper): очередь расшифровки в Postgres — задачи переживают перезапуск процесса"
```

---

### Task 4: Обезличивание персональных данных перед отправкой в LLM

Формула: наружу — только обезличенное, таблица соответствия — только у нас, подстановка обратно — нашим кодом.

**Files:**
- Create: `packages/api/src/services/pii-redact.ts`
- Create: `packages/api/src/__tests__/pii-redact.test.ts`
- Modify: `packages/api/src/routes/meetings.ts` (место отправки транскрипта в LLM)

**Interfaces:**
- Consumes: —
- Produces:
  - `redactPii(text: string): { text: string; map: PiiMap }` где `type PiiMap = Record<string, string>` — ключ это подставленный токен, значение — исходная строка
  - `restorePii(text: string, map: PiiMap): string`

- [ ] **Step 1: Написать падающий тест**

```typescript
// packages/api/src/__tests__/pii-redact.test.ts
import { redactPii, restorePii } from '../services/pii-redact';

describe('обезличивание перед отправкой в модель', () => {
  test('телефон в любом формате заменяется на токен', () => {
    const r = redactPii('Позвони на +7 916 123-45-67 после шести');
    expect(r.text).not.toContain('916');
    expect(r.text).toMatch(/\[ТЕЛЕФОН_\d+\]/);
  });

  test('email заменяется на токен', () => {
    const r = redactPii('Пиши на ivan.petrov@example.com');
    expect(r.text).not.toContain('ivan.petrov@example.com');
    expect(r.text).toMatch(/\[EMAIL_\d+\]/);
  });

  test('одинаковые значения получают один и тот же токен', () => {
    const r = redactPii('Звонить на +79161234567. Ещё раз: +79161234567');
    const tokens = [...r.text.matchAll(/\[ТЕЛЕФОН_(\d+)\]/g)].map((m) => m[1]);
    expect(new Set(tokens).size).toBe(1);
  });

  test('таблица соответствия позволяет восстановить исходный текст', () => {
    const original = 'Иван Петров, +7 916 123-45-67, ivan@example.com';
    const r = redactPii(original);
    expect(restorePii(r.text, r.map)).toBe(original);
  });

  test('обычная речь без ПД не меняется', () => {
    const original = 'Обсудили бюджет на третий квартал и сроки релиза.';
    expect(redactPii(original).text).toBe(original);
  });

  test('ФИО из двух слов с заглавных заменяется на Участника', () => {
    const r = redactPii('Иван Петров сказал, что успеет');
    expect(r.text).not.toContain('Иван Петров');
    expect(r.text).toMatch(/\[УЧАСТНИК_\d+\]/);
  });

  test('начало предложения не принимается за ФИО', () => {
    const original = 'Сроки Горят потому что подрядчик молчит';
    expect(redactPii(original).text).toBe(original);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd packages/api && npx jest src/__tests__/pii-redact.test.ts --runInBand`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализовать**

```typescript
// packages/api/src/services/pii-redact.ts

export type PiiMap = Record<string, string>;

const PHONE = /(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Два слова с заглавной подряд — кандидат в ФИО. Начало предложения отсекаем ниже. */
const FULLNAME = /(?<![.!?]\s)(?<!^)\b([А-ЯЁ][а-яё]{2,})\s+([А-ЯЁ][а-яё]{2,})\b/gm;

/**
 * Заменяет персональные данные на стабильные токены.
 * В модель уходит только результат; map остаётся на нашей стороне
 * и в логи/промпты не попадает никогда.
 */
export function redactPii(text: string): { text: string; map: PiiMap } {
  const map: PiiMap = {};
  const seen = new Map<string, string>();
  let counters: Record<string, number> = { ТЕЛЕФОН: 0, EMAIL: 0, УЧАСТНИК: 0 };

  const replace = (input: string, re: RegExp, kind: string): string =>
    input.replace(re, (match) => {
      const existing = seen.get(match);
      if (existing) return existing;
      counters[kind] = (counters[kind] ?? 0) + 1;
      const token = `[${kind}_${counters[kind]}]`;
      seen.set(match, token);
      map[token] = match;
      return token;
    });

  let out = text;
  out = replace(out, EMAIL, 'EMAIL');
  out = replace(out, PHONE, 'ТЕЛЕФОН');
  out = replace(out, FULLNAME, 'УЧАСТНИК');
  return { text: out, map };
}

/** Подстановка реальных значений обратно — уже у нас, без участия модели. */
export function restorePii(text: string, map: PiiMap): string {
  let out = text;
  for (const [token, original] of Object.entries(map)) {
    out = out.split(token).join(original);
  }
  return out;
}
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `cd packages/api && npx jest src/__tests__/pii-redact.test.ts --runInBand`
Expected: PASS (7 тестов). Если тест про «начало предложения» падает — поправить регулярку `FULLNAME`, а не тест: ложное срабатывание портит текст, но не создаёт утечки, поэтому допустимо ослабить именно это правило.

- [ ] **Step 5: Подключить в путь резюмирования встречи**

В `packages/api/src/routes/meetings.ts` перед отправкой транскрипта в модель: `const { text, map } = redactPii(transcript);` — в модель уходит `text`; к полученному резюме применяется `restorePii(summary, map)` перед сохранением. `map` в БД и логи не пишется.

- [ ] **Step 6: Проверить глазами, что уходит наружу**

Пункт 4 памятки 152-ФЗ требует посмотреть один запрос руками. Добавить временный `console.log` обезличенного промпта, прогнать одну реальную встречу, убедиться, что в нём нет ни имён, ни телефонов, ни почт, затем `console.log` убрать.

- [ ] **Step 7: Прогнать весь набор тестов и закоммитить**

```bash
cd packages/api && npm test
git add packages/api/src/services/pii-redact.ts packages/api/src/__tests__/pii-redact.test.ts packages/api/src/routes/meetings.ts
git commit -m "feat(pii): обезличивание транскрипта перед отправкой в LLM, таблица соответствия остаётся на сервере"
```

---

### Task 5: Переключаемый LLM-провайдер и мягкая деградация

Прямой ответ заказчику: «модель переключается на российскую одной переменной окружения».

**Files:**
- Modify: `packages/api/src/config/index.ts`
- Create: `packages/api/src/__tests__/llm-provider.test.ts`
- Modify: `packages/api/src/routes/ai.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `config`
- Produces: `isLlmConfigured(): boolean`, `llmProviderName(): string` — экспорт из `services/claude.service.ts`

- [ ] **Step 1: Написать падающий тест**

```typescript
// packages/api/src/__tests__/llm-provider.test.ts
describe('провайдер LLM', () => {
  const OLD = process.env;
  beforeEach(() => { jest.resetModules(); process.env = { ...OLD }; });
  afterAll(() => { process.env = OLD; });

  test('без ключей провайдер считается ненастроенным', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    const { isLlmConfigured } = require('../services/claude.service');
    expect(isLlmConfigured()).toBe(false);
  });

  test('с базовым URL Яндекса имя провайдера отражает это', () => {
    process.env['OPENAI_API_KEY'] = 'k';
    process.env['OPENAI_BASE_URL'] = 'https://llm.api.cloud.yandex.net/v1';
    const { llmProviderName } = require('../services/claude.service');
    expect(llmProviderName()).toContain('yandex');
  });

  test('без базового URL провайдер по умолчанию', () => {
    process.env['OPENAI_API_KEY'] = 'k';
    delete process.env['OPENAI_BASE_URL'];
    const { llmProviderName } = require('../services/claude.service');
    expect(llmProviderName()).toBe('default');
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd packages/api && npx jest src/__tests__/llm-provider.test.ts --runInBand`
Expected: FAIL — функции не экспортированы

- [ ] **Step 3: Реализовать**

Добавить в `packages/api/src/services/claude.service.ts`:

```typescript
/** Ключ не задан — AI-функции отключаются мягко, сервис продолжает работать. */
export function isLlmConfigured(): boolean {
  return Boolean(config.anthropicApiKey || config.openaiApiKey);
}

/** Имя провайдера для /health и кабинета: показывает, куда реально уходят запросы. */
export function llmProviderName(): string {
  const url = config.openaiBaseUrl;
  if (!url) return 'default';
  try {
    return new URL(url).hostname.split('.').slice(-3, -2)[0] ?? new URL(url).hostname;
  } catch {
    return 'custom';
  }
}
```

- [ ] **Step 4: Запустить тест и убедиться, что проходит**

Run: `cd packages/api && npx jest src/__tests__/llm-provider.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Добавить деградацию 501 в AI-роут**

В начало обработчиков `packages/api/src/routes/ai.ts`:

```typescript
if (!isLlmConfigured()) {
  return res.status(501).json({ success: false, error: 'AI-функции не настроены: не задан ключ модели' });
}
```

- [ ] **Step 6: Задокументировать переменные**

В `.env.example` добавить с комментарием:

```
# LLM. Пусто — AI-функции выключены, API отвечает 501, сервис работает.
# Для размещения обработки в РФ достаточно сменить эти две переменные:
#   OPENAI_BASE_URL=https://llm.api.cloud.yandex.net/v1
OPENAI_BASE_URL=
```

- [ ] **Step 7: Прогнать тесты и закоммитить**

```bash
cd packages/api && npm test
git add packages/api/src/services/claude.service.ts packages/api/src/routes/ai.ts packages/api/src/__tests__/llm-provider.test.ts .env.example
git commit -m "feat(llm): переключаемый провайдер через OPENAI_BASE_URL и мягкая деградация 501 без ключа"
```

---

### Task 6: API-токены с хранением хеша и отзывом

Корпоративный чек-бокс: служебный доступ, срок жизни, отзыв.

**Files:**
- Modify: `packages/api/src/db/schema-pg.sql`
- Create: `packages/api/src/services/api-tokens.ts`
- Create: `packages/api/src/__tests__/api-tokens.test.ts`
- Create: `packages/api/src/routes/api-tokens.ts`
- Modify: `packages/api/src/middleware/auth.ts` (принимать `Bearer cs_...`)
- Modify: `packages/api/src/routes/index.ts` (зарегистрировать роут)

**Interfaces:**
- Consumes: `query`, `queryOne`, `queryAll`, `execute` из `../db/db`
- Produces:
  - `issueToken(userId: number, name: string, ttlDays: number | null): Promise<{ token: string; id: number }>` — `token` возвращается один раз
  - `verifyToken(raw: string): Promise<{ userId: number; tokenId: number } | null>`
  - `revokeToken(userId: number, tokenId: number): Promise<boolean>`
  - `listTokens(userId: number): Promise<Array<{ id: number; name: string; created_at: string; expires_at: string | null; revoked_at: string | null }>>`

- [ ] **Step 1: Добавить таблицу в схему**

```sql
CREATE TABLE IF NOT EXISTS api_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens (token_hash);
```

- [ ] **Step 2: Написать падающий тест**

```typescript
// packages/api/src/__tests__/api-tokens.test.ts
import { issueToken, verifyToken, revokeToken } from '../services/api-tokens';
import * as crypto from 'crypto';

jest.mock('../db/db', () => ({ queryOne: jest.fn(), queryAll: jest.fn(), execute: jest.fn() }));
import { queryOne, execute } from '../db/db';

describe('API-токены', () => {
  beforeEach(() => jest.clearAllMocks());

  test('в базу пишется только хеш, не сам токен', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 1 });
    const { token } = await issueToken(5, 'CI', null);
    const [, params] = (queryOne as jest.Mock).mock.calls[0];
    expect(params).not.toContain(token);
    expect(params[2]).toBe(crypto.createHash('sha256').update(token).digest('hex'));
  });

  test('токен имеет узнаваемый префикс и достаточную длину', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 1 });
    const { token } = await issueToken(5, 'CI', null);
    expect(token.startsWith('cs_')).toBe(true);
    expect(token.length).toBeGreaterThanOrEqual(35);
  });

  test('валидный токен опознаётся по хешу', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: 9, user_id: 5 });
    (execute as jest.Mock).mockResolvedValue(1);
    const r = await verifyToken('cs_abc');
    expect(r).toEqual({ userId: 5, tokenId: 9 });
    const [sql] = (queryOne as jest.Mock).mock.calls[0];
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at IS NULL OR expires_at > now()');
  });

  test('неизвестный токен отклоняется', async () => {
    (queryOne as jest.Mock).mockResolvedValue(null);
    expect(await verifyToken('cs_нет')).toBeNull();
  });

  test('отзыв проставляет revoked_at только своему токену', async () => {
    (execute as jest.Mock).mockResolvedValue(1);
    expect(await revokeToken(5, 9)).toBe(true);
    const [sql, params] = (execute as jest.Mock).mock.calls[0];
    expect(sql).toContain('SET revoked_at = now()');
    expect(params).toEqual([9, 5]);
  });
});
```

- [ ] **Step 3: Запустить тест и убедиться, что падает**

Run: `cd packages/api && npx jest src/__tests__/api-tokens.test.ts --runInBand`
Expected: FAIL — модуль не найден

- [ ] **Step 4: Реализовать**

```typescript
// packages/api/src/services/api-tokens.ts
import * as crypto from 'crypto';
import { queryOne, queryAll, execute } from '../db/db';

const PREFIX = 'cs_';

function hash(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Токен показывается пользователю один раз; в базе живёт только SHA-256. */
export async function issueToken(userId: number, name: string, ttlDays: number | null): Promise<{ token: string; id: number }> {
  const token = PREFIX + crypto.randomBytes(24).toString('base64url');
  const row = await queryOne<{ id: number }>(
    `INSERT INTO api_tokens (user_id, name, token_hash, expires_at)
     VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4 || ' days')::interval END)
     RETURNING id`,
    [userId, name, hash(token), ttlDays],
  );
  return { token, id: row!.id };
}

export async function verifyToken(raw: string): Promise<{ userId: number; tokenId: number } | null> {
  const row = await queryOne<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM api_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [hash(raw)],
  );
  if (!row) return null;
  await execute(`UPDATE api_tokens SET last_used_at = now() WHERE id = $1`, [row.id]);
  return { userId: row.user_id, tokenId: row.id };
}

export async function revokeToken(userId: number, tokenId: number): Promise<boolean> {
  const n = await execute(
    `UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId],
  );
  return n > 0;
}

export async function listTokens(userId: number) {
  return await queryAll(
    `SELECT id, name, created_at, expires_at, revoked_at, last_used_at
     FROM api_tokens WHERE user_id = $1 ORDER BY id DESC`,
    [userId],
  );
}
```

- [ ] **Step 5: Запустить тест и убедиться, что проходит**

Run: `cd packages/api && npx jest src/__tests__/api-tokens.test.ts --runInBand`
Expected: PASS (5 тестов)

- [ ] **Step 6: Роут и авторизация**

Создать `packages/api/src/routes/api-tokens.ts` с `POST /` (выпуск, возвращает `token` один раз), `GET /` (список без токенов), `DELETE /:id` (отзыв). Зарегистрировать в `routes/index.ts` как `/api-tokens`. В `middleware/auth.ts`: если заголовок `Authorization: Bearer cs_...` — проверять через `verifyToken` и класть `userId` в запрос, иначе прежняя логика JWT.

- [ ] **Step 7: Прогнать тесты и закоммитить**

```bash
cd packages/api && npm test
git add packages/api/src/services/api-tokens.ts packages/api/src/__tests__/api-tokens.test.ts packages/api/src/routes/api-tokens.ts packages/api/src/routes/index.ts packages/api/src/middleware/auth.ts packages/api/src/db/schema-pg.sql
git commit -m "feat(auth): API-токены с хранением SHA-256, сроком жизни и отзывом"
```

---

### Task 7: OpenAPI 3.1 и Swagger UI

У нас 24 эндпоинта и ноль спецификации — первый вопрос интегратора со стороны заказчика.

**Files:**
- Create: `packages/api/src/openapi/openapi.yaml`
- Create: `packages/api/src/routes/docs.ts`
- Create: `packages/api/src/__tests__/openapi.test.ts`
- Modify: `packages/api/src/routes/index.ts`
- Modify: `packages/api/build.mjs` (копировать yaml в `dist/`)

**Interfaces:**
- Consumes: —
- Produces: `GET /v1/openapi.yaml` (текст спеки), `GET /v1/docs` (Swagger UI)

- [ ] **Step 1: Написать падающий тест**

```typescript
// packages/api/src/__tests__/openapi.test.ts
import * as fs from 'fs';
import * as path from 'path';

const SPEC = path.resolve(__dirname, '../openapi/openapi.yaml');

describe('спецификация OpenAPI', () => {
  test('файл существует и объявляет версию 3.1', () => {
    const text = fs.readFileSync(SPEC, 'utf8');
    expect(text).toMatch(/^openapi:\s*3\.1/m);
  });

  test('описаны ключевые эндпоинты', () => {
    const text = fs.readFileSync(SPEC, 'utf8');
    for (const p of ['/health', '/v1/tasks', '/v1/projects', '/v1/meetings', '/v1/api-tokens']) {
      expect(text).toContain(`${p}:`);
    }
  });

  test('объявлена авторизация по bearer-токену', () => {
    const text = fs.readFileSync(SPEC, 'utf8');
    expect(text).toContain('bearerAuth');
    expect(text).toContain('scheme: bearer');
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd packages/api && npx jest src/__tests__/openapi.test.ts --runInBand`
Expected: FAIL — файла нет

- [ ] **Step 3: Написать спецификацию**

Создать `packages/api/src/openapi/openapi.yaml`, начав с каркаса и описав в первом заходе `/health`, `/v1/tasks`, `/v1/projects`, `/v1/meetings`, `/v1/api-tokens`:

```yaml
openapi: 3.1.0
info:
  title: Clarity Space API
  version: 1.0.0
  description: |
    Персональная система управления задачами, проектами и встречами.
    Авторизация — Bearer-токен, выпускается в кабинете и отзывается там же.
servers:
  - url: https://clarity-space.ru
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
security:
  - bearerAuth: []
paths:
  /health:
    get:
      summary: Состояние сервиса и его зависимостей
      security: []
      responses:
        '200': { description: сервис здоров или деградирован }
        '503': { description: отказала критичная зависимость }
```

Остальные пути дописать по фактическим обработчикам в `src/routes/`. Не выдумывать поля — сверяться с кодом.

- [ ] **Step 4: Отдать спеку и UI**

`packages/api/src/routes/docs.ts`: `GET /openapi.yaml` читает файл и отдаёт как `text/yaml`; `GET /docs` отдаёт HTML со Swagger UI с CDN, указывающий на `/v1/openapi.yaml`. Зарегистрировать в `routes/index.ts`.

- [ ] **Step 5: Запустить тесты и убедиться, что проходят**

Run: `cd packages/api && npm test`
Expected: PASS

- [ ] **Step 6: Проверить, что yaml попадает в сборку**

```bash
cd packages/api && npx tsc && ls dist/openapi/openapi.yaml
```

Expected: файл на месте. Если нет — добавить копирование в `build.mjs`.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/openapi packages/api/src/routes/docs.ts packages/api/src/routes/index.ts packages/api/src/__tests__/openapi.test.ts packages/api/build.mjs
git commit -m "feat(docs): OpenAPI 3.1 и Swagger UI на /v1/docs"
```

---

### Task 8: MCP-эндпоинт внутри API

Демо-козырь: сервисом можно управлять прямо из Claude Code тем же токеном. Отдельный процесс не нужен.

**Files:**
- Create: `packages/api/src/routes/mcp.ts`
- Create: `packages/api/src/__tests__/mcp.test.ts`
- Modify: `packages/api/src/routes/index.ts`

**Interfaces:**
- Consumes: `verifyToken` из `../services/api-tokens`, обработчики задач и проектов
- Produces: `POST /mcp` — JSON-RPC 2.0: методы `initialize`, `tools/list`, `tools/call`

- [ ] **Step 1: Написать падающий тест**

```typescript
// packages/api/src/__tests__/mcp.test.ts
import { handleMcp } from '../routes/mcp';

describe('MCP-эндпоинт', () => {
  test('tools/list возвращает инструменты со схемами', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 5);
    expect(r.result.tools.length).toBeGreaterThan(0);
    for (const t of r.result.tools) {
      expect(typeof t.name).toBe('string');
      expect(t.inputSchema).toBeDefined();
    }
  });

  test('неизвестный метод возвращает ошибку JSON-RPC, а не бросает', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 2, method: 'нет-такого' }, 5);
    expect(r.error.code).toBe(-32601);
  });

  test('initialize сообщает протокол и имя сервера', async () => {
    const r = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'initialize' }, 5);
    expect(r.result.serverInfo.name).toBe('clarity-space');
    expect(r.result.protocolVersion).toBeDefined();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что падает**

Run: `cd packages/api && npx jest src/__tests__/mcp.test.ts --runInBand`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализовать**

Создать `packages/api/src/routes/mcp.ts` с экспортом `handleMcp(body, userId)`. Набор инструментов первой версии — пять штук, чтобы демо было живым: `list_tasks`, `create_task`, `complete_task`, `list_projects`, `search_vault`. Каждый — обёртка над уже существующей логикой соответствующего роута, с `inputSchema` в JSON Schema. Авторизация — `Authorization: Bearer cs_...` через `verifyToken`; без валидного токена `POST /mcp` отвечает 401.

- [ ] **Step 4: Запустить тесты и убедиться, что проходят**

Run: `cd packages/api && npm test`
Expected: PASS

- [ ] **Step 5: Проверить вживую из Claude Code**

Добавить в конфиг MCP и убедиться, что инструменты видны:

```json
{
  "mcpServers": {
    "clarity-space": {
      "type": "http",
      "url": "https://clarity-space.ru/mcp",
      "headers": { "Authorization": "Bearer cs_..." }
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/mcp.ts packages/api/src/__tests__/mcp.test.ts packages/api/src/routes/index.ts
git commit -m "feat(mcp): MCP-эндпоинт внутри API — управление сервисом из Claude Code по API-токену"
```

---

### Task 9: Smoke-тест после деплоя

Воспроизводимая проверка вместо «вроде поднялось».

**Files:**
- Create: `scripts/smoke.sh`

**Interfaces:**
- Consumes: работающий сервис
- Produces: скрипт с ненулевым кодом возврата при провале любой проверки

- [ ] **Step 1: Написать скрипт**

```bash
#!/usr/bin/env bash
# Проверка после деплоя. BASE=https://clarity-space.ru ./scripts/smoke.sh
set -euo pipefail
BASE="${BASE:-https://clarity-space.ru}"
fail=0

check() {
  local name="$1" expected="$2" url="$3"
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$url" || echo 000)
  if [ "$code" = "$expected" ]; then
    printf '  ok   %-28s %s\n' "$name" "$code"
  else
    printf '  ПРОВАЛ %-26s ожидали %s, получили %s\n' "$name" "$expected" "$code"
    fail=1
  fi
}

echo "Проверка $BASE"
check "health"        200 "$BASE/health"
check "openapi"       200 "$BASE/v1/openapi.yaml"
check "swagger ui"    200 "$BASE/v1/docs"
check "SPA"           200 "$BASE/"
check "mcp без токена" 401 "$BASE/mcp"

echo "Статус зависимостей:"
curl -sS "$BASE/health" | python3 -c "
import json,sys
r=json.load(sys.stdin)
print('  общий статус:', r['status'])
for c in r['checks']:
    print('  ', 'ok  ' if c['ok'] else 'СБОЙ', c['name'], c.get('detail',''))
"

[ "$fail" = 0 ] && echo 'Всё зелёное.' || { echo 'Есть провалы.'; exit 1; }
```

- [ ] **Step 2: Сделать исполняемым и прогнать локально**

```bash
chmod +x scripts/smoke.sh && BASE=http://localhost:3001 ./scripts/smoke.sh
```

Expected: все проверки зелёные при запущенном локальном API.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.sh
git commit -m "chore: smoke-тест для проверки сервиса после деплоя"
```

---

### Task 10: Актуализация CLAUDE.md

В документации указан SQLite, а код (`src/index.ts:59`, `initPg`) работает с Postgres. По этой документации нельзя рассказывать заказчику.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Проверить фактическое состояние БД на проде**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'grep -E "DATABASE_URL|DATABASE_PATH" /var/www/kanban-app/packages/api/.env | sed "s/=.*/=<скрыто>/"'
```

- [ ] **Step 2: Поправить раздел «Стек»**

Заменить `SQLite (better-sqlite3)` на фактическое состояние. Отметить, что `db.sqlite.ts` остаётся для локальной разработки и тестов, если это так.

- [ ] **Step 3: Дописать новые эндпоинты**

В раздел «API Routes» добавить `/v1/api-tokens`, `/v1/docs`, `/v1/openapi.yaml`, `/mcp`, обновить описание `/health`.

- [ ] **Step 4: Проставить TEST_COMMAND**

В `.claude/hooks/config.env` прописать `TEST_COMMAND="cd packages/api && npm test"` — сейчас пусто, из-за чего stop-gate не проверяет тесты.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .claude/hooks/config.env
git commit -m "docs: привести CLAUDE.md в соответствие с кодом, задать TEST_COMMAND"
```

---

## Развёртывание

После всех задач:

```bash
cd packages/api && npx tsc
cd ../../apps/web && npx vite build
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  "cd /var/www/kanban-app && git pull && cd packages/api && npx tsc && \
   pm2 delete kanban-api && pm2 start dist/index.js --name kanban-api && pm2 save"
BASE=https://clarity-space.ru ./scripts/smoke.sh
```

Схема Postgres накатывается на старте (`runSchema()` в `start()`), новые таблицы появятся автоматически.

## Фаза 2 — ВКС, после презентации

Не входит в этот план. Условия входа: отдельная машина от 8 vCPU / 8 GB, подключённое S3-совместимое хранилище, решение по коду (писать свой бэкенд поверх открытых LiveKit SFU и Egress — это недели, а не дни). Из рунбука к тому моменту пригодятся: один мультиплексированный UDP-порт вместо диапазона, `use_external_ip: true`, вебхук только на внутренний адрес, Websocket Support на прокси сигналинга, ffmpeg в рантайм-образе, запись отдельными дорожками с офлайн-сборкой вместо живого composite.

## Порядок и приоритет

Если времени до презентации меньше, чем задач: 0 → 1 → 4 → 5 → 7 → 8 → 9. Задачи 2, 3, 6, 10 — важные, но их отсутствие заказчик на демо не увидит.
