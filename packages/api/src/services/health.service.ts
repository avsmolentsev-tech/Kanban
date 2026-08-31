import * as fs from 'fs';
import { query } from '../db/db';
import { config } from '../config';
import { isLocalWhisperAvailable } from './whisper-local.service';

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
