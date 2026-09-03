import * as fs from 'fs';
import { query } from '../db/db';
import { config } from '../config';
import { isLocalWhisperAvailable, isTranscribeServiceAvailable } from './whisper-local.service';
import { isAiClientConfigured, llmProviderName } from './claude.service';

export type HealthCheck = { name: string; ok: boolean; detail?: string };
export type HealthReport = { status: 'ok' | 'degraded' | 'down'; ts: string; checks: HealthCheck[] };

/** postgres — критичная зависимость; остальные деградируют мягко. */
const CRITICAL = new Set(['postgres']);

// /health не требует авторизации (см. authMiddleware) — в HTTP-ответ никогда не
// должны попадать хосты, порты, имена пользователей/БД или пути на диске.
// Подробности уходят только в серверный лог.

async function checkPostgres(): Promise<HealthCheck> {
  try {
    await query('SELECT 1');
    return { name: 'postgres', ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[health] postgres недоступен:', msg);
    return { name: 'postgres', ok: false, detail: 'база данных недоступна' };
  }
}

function checkVault(): HealthCheck {
  try {
    fs.accessSync(config.vaultPath, fs.constants.R_OK | fs.constants.W_OK);
    return { name: 'vault', ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[health] vault недоступен (${config.vaultPath}):`, msg);
    return { name: 'vault', ok: false, detail: 'vault недоступен' };
  }
}

/**
 * Расшифровка работает через два независимых бэкенда — локальный whisper.cpp
 * и микросервис faster-whisper. Деградация до `ok:false` только если недоступны
 * оба: на проде вполне нормальна конфигурация без бинаря whisper.cpp, где всю
 * работу тянет микросервис.
 */
async function checkWhisper(): Promise<HealthCheck> {
  const localOk = isLocalWhisperAvailable();
  const serviceOk = await isTranscribeServiceAvailable();

  if (localOk && serviceOk) return { name: 'whisper', ok: true };
  if (serviceOk) return { name: 'whisper', ok: true, detail: 'работает через сервис транскрипции, локальный whisper недоступен' };
  if (localOk) return { name: 'whisper', ok: true, detail: 'работает через локальный whisper, сервис транскрипции недоступен' };
  return { name: 'whisper', ok: false, detail: 'расшифровка недоступна: ни локальный whisper, ни сервис транскрипции' };
}

/**
 * detail при ok:true — только короткая метка провайдера (например "yandex" или
 * "default"), НЕ полный URL и не хост целиком: /health не защищён авторизацией,
 * и заказчику должно быть видно, что провайдер сменился одной переменной окружения,
 * без раскрытия внутренней топологии.
 *
 * Проверяем isAiClientConfigured() (а не общий "хоть какой-то ключ задан") — эта
 * проверка отражает состояние клиента, которым реально пользуется aiRouter
 * (/chat, /daily-brief и т.д.). Иначе оператор, задавший только ANTHROPIC_API_KEY
 * или только ADVISOR_OPENAI_API_KEY, увидел бы здесь ok:true при полностью
 * нерабочем основном AI-пути.
 */
function checkLlm(): HealthCheck {
  if (!isAiClientConfigured()) {
    return { name: 'llm', ok: false, detail: 'ключ LLM не задан, AI-функции отключены' };
  }
  return { name: 'llm', ok: true, detail: `провайдер: ${llmProviderName()}` };
}

/**
 * Отражает состояние флага 152-ФЗ (TRANSCRIPTION_ALLOW_CLOUD_FALLBACK) наружу.
 * Это не критичная зависимость и не ошибка — просто факт текущей политики,
 * поэтому всегда `ok: true`. В detail — только сам факт разрешён/запрещён,
 * без путей, адресов и ключей: эндпоинт не защищён авторизацией.
 */
function checkTranscriptionPolicy(): HealthCheck {
  const detail = config.transcriptionAllowCloudFallback
    ? 'облачный фолбэк расшифровки разрешён'
    : 'облачный фолбэк расшифровки запрещён';
  return { name: 'transcription-policy', ok: true, detail };
}

export async function checkHealth(): Promise<HealthReport> {
  const checks: HealthCheck[] = [await checkPostgres(), checkVault(), await checkWhisper(), checkLlm(), checkTranscriptionPolicy()];
  const failedCritical = checks.some((c) => !c.ok && CRITICAL.has(c.name));
  const failedAny = checks.some((c) => !c.ok);
  return {
    status: failedCritical ? 'down' : failedAny ? 'degraded' : 'ok',
    ts: new Date().toISOString(),
    checks,
  };
}
