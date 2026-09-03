import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';
import { checkAiLimit } from '../middleware/plan';
import { ClaudeService, isAdvisorClientConfigured } from '../services/claude.service';
import { config } from '../config';

export const advisorsRouter = Router();
const claude = new ClaudeService();

// Мягкая деградация: ключ advisor-клиента (ADVISOR_OPENAI_API_KEY, с фолбэком на
// OPENAI_API_KEY) не задан — все эндпоинты Advisory Board идут через
// ClaudeService.advisorClient, поэтому именно эта проверка (см.
// isAdvisorClientConfigured) и определяет готовность. Без этого гварда советники
// падали бы 500 с сырым сообщением OpenAI SDK вместо понятного русского 501.
advisorsRouter.use((_req: Request, res: Response, next) => {
  if (!isAdvisorClientConfigured()) {
    res.status(501).json({ success: false, error: 'Совет директоров не настроен: не задан ключ модели' });
    return;
  }
  next();
});

interface AdvisorRow {
  id: number; slug: string; name: string; domain: string;
  avatar_url: string | null; persona_prompt: string; voice_style: string; depth: string;
}

/** Advisors visible to a user: global seed personas + their own custom ones. */
async function loadAdvisors(userId: number | null, ids?: number[]): Promise<AdvisorRow[]> {
  if (ids && ids.length > 0) {
    return queryAll<AdvisorRow>(
      'SELECT * FROM advisors WHERE id = ANY($1) AND enabled = 1 AND (user_id IS NULL OR user_id = $2)',
      [ids, userId]
    );
  }
  return queryAll<AdvisorRow>(
    'SELECT * FROM advisors WHERE enabled = 1 AND (user_id IS NULL OR user_id = $1) ORDER BY (depth = $2) DESC, name',
    [userId, 'deep']
  );
}

/** Build the situation context a persona reviews, from a meeting the user owns. */
async function buildContext(userId: number | null, meetingId?: number): Promise<string> {
  if (!meetingId) return '';
  const m = await queryOne<{ title: string; date: string; summary_raw: string }>(
    'SELECT title, date, summary_raw FROM meetings WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2',
    [meetingId, userId]
  );
  if (!m) return '';
  return `Встреча: "${m.title}" (${m.date})\n\n${(m.summary_raw || '').slice(0, 18000)}`;
}

async function logAiUsage(userId: number | null): Promise<void> {
  try {
    await execute("INSERT INTO usage_logs (type, model, detail) VALUES ($1, $2, $3)",
      ['ai_chat', config.advisorModel, `user:${userId}`]);
  } catch { /* non-fatal */ }
}

// GET /advisors — list personas available to the user (no persona_prompt leaked)
advisorsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const rows = await loadAdvisors(userId);
  res.json(ok(rows.map(r => ({ id: r.id, slug: r.slug, name: r.name, domain: r.domain, avatar_url: r.avatar_url, depth: r.depth }))));
});

const AnalyzeSchema = z.object({
  advisor_ids: z.array(z.number().int()).min(1).max(10),
  meeting_id: z.number().int().optional(),
  context: z.string().optional(),
});

// POST /advisors/analyze — one-tap разбор by the selected personas (parallel)
advisorsRouter.post('/analyze', async (req: AuthRequest, res: Response) => {
  const parsed = AnalyzeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const userId = getUserId(req);
  try {
    const limit = await checkAiLimit(req);
    if (!limit.allowed) { res.status(429).json(fail(`Лимит AI-сообщений: ${limit.used}/${limit.limit} в день. Перейдите на Pro Max для безлимита.`)); return; }

    const advisors = await loadAdvisors(userId, parsed.data.advisor_ids);
    if (advisors.length === 0) { res.status(404).json(fail('Советники не найдены')); return; }
    const context = parsed.data.context || await buildContext(userId, parsed.data.meeting_id);
    if (!context.trim()) { res.status(400).json(fail('Нет ситуации для разбора (передайте meeting_id или context)')); return; }

    const results = await Promise.all(advisors.map(async (a) => {
      try {
        const r = await claude.advisorAnalyze(a.persona_prompt, context);
        await logAiUsage(userId);
        return { advisor_id: a.id, name: a.name, domain: a.domain, avatar_url: a.avatar_url, ...r };
      } catch (err) {
        return { advisor_id: a.id, name: a.name, error: err instanceof Error ? err.message : 'ошибка' };
      }
    }));
    res.json(ok({ analyses: results }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Advisor error'));
  }
});

const ChatSchema = z.object({
  advisor_id: z.number().int(),
  message: z.string().min(1),
  session_id: z.number().int().optional(),
  meeting_id: z.number().int().optional(),
});

// POST /advisors/chat — live dialogue with one persona (creates/continues a session)
advisorsRouter.post('/chat', async (req: AuthRequest, res: Response) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const userId = getUserId(req);
  try {
    const limit = await checkAiLimit(req);
    if (!limit.allowed) { res.status(429).json(fail(`Лимит AI-сообщений: ${limit.used}/${limit.limit} в день. Перейдите на Pro Max для безлимита.`)); return; }

    const [advisor] = await loadAdvisors(userId, [parsed.data.advisor_id]);
    if (!advisor) { res.status(404).json(fail('Советник не найден')); return; }

    // Resolve or create the session (owned by the user)
    let sessionId = parsed.data.session_id ?? null;
    if (sessionId) {
      const owned = await queryOne('SELECT id FROM advisor_sessions WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2', [sessionId, userId]);
      if (!owned) { res.status(404).json(fail('Сессия не найдена')); return; }
    } else {
      const s = await queryOne<{ id: number }>(
        'INSERT INTO advisor_sessions (user_id, meeting_id, advisor_ids) VALUES ($1, $2, $3) RETURNING id',
        [userId, parsed.data.meeting_id ?? null, JSON.stringify([parsed.data.advisor_id])]
      );
      sessionId = s!.id;
    }

    const context = await buildContext(userId, parsed.data.meeting_id);

    // Prior history for this session
    const prior = await queryAll<{ sender: string; content: string }>(
      'SELECT sender, content FROM advisor_messages WHERE session_id = $1 ORDER BY id ASC',
      [sessionId]
    );
    const history = prior.map(m => ({ role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content }));

    // Store the user's message, get the persona's reply, store it
    await execute('INSERT INTO advisor_messages (session_id, sender, content) VALUES ($1, $2, $3)', [sessionId, 'user', parsed.data.message]);
    const reply = await claude.advisorReply(advisor.persona_prompt, context, [...history, { role: 'user', content: parsed.data.message }]);
    await logAiUsage(userId);
    await execute('INSERT INTO advisor_messages (session_id, sender, advisor_id, content) VALUES ($1, $2, $3, $4)', [sessionId, 'advisor', advisor.id, reply]);

    res.json(ok({ session_id: sessionId, advisor_id: advisor.id, name: advisor.name, reply }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Advisor chat error'));
  }
});

const SynthSchema = z.object({
  analyses: z.array(z.object({
    name: z.string(),
    opinion: z.string().optional(),
    risks: z.array(z.string()).optional(),
    would_do: z.string().optional(),
  })).min(2).max(15),
});

// POST /advisors/synthesize — chairman combines several разборы into a verdict
advisorsRouter.post('/synthesize', async (req: AuthRequest, res: Response) => {
  const parsed = SynthSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const userId = getUserId(req);
  try {
    const limit = await checkAiLimit(req);
    if (!limit.allowed) { res.status(429).json(fail(`Лимит AI-сообщений: ${limit.used}/${limit.limit} в день. Перейдите на Pro Max для безлимита.`)); return; }
    const result = await claude.advisorSynthesize(parsed.data.analyses);
    await logAiUsage(userId);
    res.json(ok(result));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Synthesize error'));
  }
});

const CouncilChatSchema = z.object({
  advisor_ids: z.array(z.number().int()).min(1).max(8),
  message: z.string().min(1),
  meeting_id: z.number().int().optional(),
  context: z.string().optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional().default([]),
});

// POST /advisors/council-chat — ask the whole council; each persona replies, chairman merges
advisorsRouter.post('/council-chat', async (req: AuthRequest, res: Response) => {
  const parsed = CouncilChatSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  const userId = getUserId(req);
  try {
    const limit = await checkAiLimit(req);
    if (!limit.allowed) { res.status(429).json(fail(`Лимит AI-сообщений: ${limit.used}/${limit.limit} в день. Перейдите на Pro Max для безлимита.`)); return; }
    const advisors = await loadAdvisors(userId, parsed.data.advisor_ids);
    if (advisors.length === 0) { res.status(404).json(fail('Советники не найдены')); return; }
    const context = parsed.data.context || await buildContext(userId, parsed.data.meeting_id);
    const history = parsed.data.history as Array<{ role: 'user' | 'assistant'; content: string }>;

    // Each persona answers the question (in character, with context + council history), in parallel
    const replies = (await Promise.all(advisors.map(async (a) => {
      try {
        const reply = await claude.advisorReply(a.persona_prompt, context, [...history, { role: 'user', content: parsed.data.message }]);
        await logAiUsage(userId);
        return { name: a.name, reply };
      } catch { return null; }
    }))).filter(Boolean) as Array<{ name: string; reply: string }>;

    if (replies.length === 0) { res.status(502).json(fail('Совет не ответил')); return; }

    // Chairman merges into one collective answer
    const answer = await claude.advisorCouncilReply(parsed.data.message, replies);
    await logAiUsage(userId);
    res.json(ok({ answer, per_persona: replies }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Council chat error'));
  }
});

// GET /advisors/sessions/:id — full transcript of a session
advisorsRouter.get('/sessions/:id', async (req: AuthRequest, res: Response) => {
  const userId = getUserId(req);
  const id = Number(req.params['id']);
  const owned = await queryOne('SELECT id, meeting_id FROM advisor_sessions WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2', [id, userId]);
  if (!owned) { res.status(404).json(fail('Сессия не найдена')); return; }
  const messages = await queryAll('SELECT sender, advisor_id, content, created_at FROM advisor_messages WHERE session_id = $1 ORDER BY id ASC', [id]);
  res.json(ok({ session: owned, messages }));
});
