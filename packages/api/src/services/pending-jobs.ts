/**
 * Живучесть фоновых расшифровок.
 *
 * Расшифровка длинной записи идёт минутами и живёт только в памяти процесса.
 * Любой перезапуск — деплой, падение, ребут — обрывал её без следа: аудио было
 * только в оперативке, статус встречи навсегда оставался `transcribing`, а
 * пользователь ждал результат, которого уже никто не считал.
 *
 * Здесь задача переживает перезапуск: аудио кладётся на диск, в базе появляется
 * строка, и при старте API незавершённые задачи либо возобновляются, либо честно
 * помечаются провалившимися — но никогда не растворяются молча.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execute, queryAll, queryOne } from '../db/db';
import { config } from '../config';

export type JobKind = 'meeting' | 'telegram-audio';

export interface PendingJob {
  id: number;
  kind: JobKind;
  user_id: number | null;
  tg_id: string | null;
  meeting_id: number | null;
  filename: string;
  audio_path: string;
  payload: string | null;
  attempts: number;
}

/** Куда складываем аудио незавершённых задач. Рядом с базой, не в /tmp. */
function jobsDir(): string {
  return path.join(path.dirname(config.databasePath), 'pending-jobs');
}

let ready: Promise<void> | null = null;

/** Таблица создаётся здесь, а не в schema.sql: тот файл в SQLite-диалекте. */
export function initPendingJobs(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await execute(`
        CREATE TABLE IF NOT EXISTS pending_jobs (
          id          SERIAL PRIMARY KEY,
          kind        TEXT    NOT NULL,
          user_id     INTEGER,
          tg_id       TEXT,
          meeting_id  INTEGER,
          filename    TEXT    NOT NULL DEFAULT 'audio',
          audio_path  TEXT    NOT NULL,
          payload     TEXT,
          attempts    INTEGER NOT NULL DEFAULT 0,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      try { fs.mkdirSync(jobsDir(), { recursive: true }); } catch {}
    })();
  }
  return ready;
}

/**
 * Кладёт аудио на диск и регистрирует задачу. Вызывать ДО начала обработки —
 * иначе перезапуск в первые же секунды снова всё потеряет.
 */
export async function registerJob(params: {
  kind: JobKind;
  buffer: Buffer;
  filename: string;
  userId?: number | null;
  tgId?: string | null;
  meetingId?: number | null;
  payload?: unknown;
}): Promise<number | null> {
  try {
    await initPendingJobs();
    const safe = params.filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'audio';
    const audioPath = path.join(jobsDir(), `${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`);
    fs.writeFileSync(audioPath, params.buffer);

    const row = await queryOne<{ id: number }>(
      `INSERT INTO pending_jobs (kind, user_id, tg_id, meeting_id, filename, audio_path, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        params.kind,
        params.userId ?? null,
        params.tgId ?? null,
        params.meetingId ?? null,
        params.filename,
        audioPath,
        params.payload ? JSON.stringify(params.payload) : null,
      ]
    );
    return row?.id ?? null;
  } catch (err) {
    // Регистрация — страховка, а не условие работы: если она отвалилась,
    // задача всё равно должна выполниться, просто без защиты от перезапуска.
    console.warn('[jobs] не удалось зарегистрировать задачу:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Задача доведена до конца — снимаем строку и удаляем аудио. */
export async function completeJob(jobId: number | null): Promise<void> {
  if (jobId == null) return;
  try {
    const row = await queryOne<{ audio_path: string }>('SELECT audio_path FROM pending_jobs WHERE id = $1', [jobId]);
    if (row?.audio_path) { try { fs.unlinkSync(row.audio_path); } catch {} }
    await execute('DELETE FROM pending_jobs WHERE id = $1', [jobId]);
  } catch (err) {
    console.warn('[jobs] не удалось закрыть задачу:', err instanceof Error ? err.message : err);
  }
}

export async function listPendingJobs(): Promise<PendingJob[]> {
  await initPendingJobs();
  return queryAll<PendingJob>('SELECT * FROM pending_jobs ORDER BY id ASC');
}

/** Сколько раз задачу уже пытались доделать после перезапусков. */
async function bumpAttempts(jobId: number): Promise<number> {
  const row = await queryOne<{ attempts: number }>(
    'UPDATE pending_jobs SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
    [jobId]
  );
  return row?.attempts ?? 99;
}

/** Больше двух попыток — что-то не так с самим файлом, дальше не мучаем. */
const MAX_ATTEMPTS = 2;

export interface ResumeHandlers {
  meeting: (job: PendingJob, buffer: Buffer) => Promise<void>;
  telegramAudio: (job: PendingJob, buffer: Buffer) => Promise<void>;
  /** Сообщить пользователю, что задача не переживёт восстановление. */
  giveUp: (job: PendingJob, reason: string) => Promise<void>;
}

/**
 * Вызывается один раз при старте API. Работает последовательно: восстановление
 * не должно съесть весь процессор у свежезапущенного сервера.
 */
export async function resumePendingJobs(handlers: ResumeHandlers): Promise<void> {
  let jobs: PendingJob[];
  try {
    jobs = await listPendingJobs();
  } catch (err) {
    console.warn('[jobs] не удалось прочитать незавершённые задачи:', err instanceof Error ? err.message : err);
    return;
  }
  if (jobs.length === 0) return;

  console.log(`[jobs] незавершённых задач после перезапуска: ${jobs.length}`);

  for (const job of jobs) {
    const label = `#${job.id} (${job.kind})`;
    try {
      if (!fs.existsSync(job.audio_path)) {
        console.warn(`[jobs] ${label}: аудио потеряно, задача закрыта`);
        await handlers.giveUp(job, 'исходное аудио не сохранилось');
        await completeJob(job.id);
        continue;
      }

      const attempts = await bumpAttempts(job.id);
      if (attempts > MAX_ATTEMPTS) {
        console.warn(`[jobs] ${label}: попыток ${attempts}, сдаёмся`);
        await handlers.giveUp(job, `не удалось обработать за ${MAX_ATTEMPTS} попытки`);
        await completeJob(job.id);
        continue;
      }

      console.log(`[jobs] ${label}: возобновляю (попытка ${attempts})`);
      const buffer = fs.readFileSync(job.audio_path);
      if (job.kind === 'meeting') await handlers.meeting(job, buffer);
      else await handlers.telegramAudio(job, buffer);
      console.log(`[jobs] ${label}: восстановлена`);
    } catch (err) {
      console.error(`[jobs] ${label}: восстановление не удалось:`, err instanceof Error ? err.message : err);
      // строку не удаляем — следующий старт попробует ещё раз, до MAX_ATTEMPTS
    }
  }
}
