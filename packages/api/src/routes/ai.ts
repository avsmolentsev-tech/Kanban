import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ClaudeService } from '../services/claude.service';
import { query, queryAll, queryOne, execute } from '../db/db';
import { ok, fail } from '@pis/shared';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';
import { moscowDateString, moscowDateTimeString } from '../utils/time';
import { generateBundle, findProjectByName } from '../services/bundle.service';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';
import { checkAiLimit } from '../middleware/plan';

export const aiRouter = Router();
const claude = new ClaudeService();
const obsidian = new ObsidianService(config.vaultPath);

async function executeVoiceAction(
  action: Record<string, unknown>,
  userId: number | null,
  req: AuthRequest,
): Promise<{ type: string; success: boolean; detail: string }> {
  const t = String(action['type']);
  switch (t) {
    case 'create_task': {
      let safeProjId = action['project_id'] ?? null;
      if (safeProjId) {
        const projCheck = await queryOne('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [safeProjId, userId]);
        if (!projCheck) safeProjId = null;
      }
      const inserted = await queryOne<{ id: number }>(
        'INSERT INTO tasks (project_id, title, description, status, priority, due_date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [safeProjId, action['title'], (action['description'] as string) ?? '', action['status'] ?? 'todo', action['priority'] ?? 3, action['due_date'] ?? null, userId],
      );
      const taskId = inserted!.id;
      let peopleIds = Array.isArray(action['person_ids']) ? action['person_ids'] as number[] : [];
      if (peopleIds.length === 0) {
        const selfRow = await queryOne<{ id: number }>("SELECT id FROM people WHERE LOWER(name) IN ('я','me','self') LIMIT 1", []);
        if (selfRow) peopleIds = [selfRow.id];
      }
      for (const pid of peopleIds) {
        await execute('INSERT INTO task_people (task_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [taskId, pid]);
      }
      return { type: t, success: true, detail: `Задача "${action['title']}" создана` };
    }
    case 'move_task':
      await execute('UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [action['status'], action['task_id'], userId]);
      return { type: t, success: true, detail: `Задача #${action['task_id']} → ${action['status']}` };
    case 'delete_task':
      await execute('UPDATE tasks SET archived = 1, updated_at = NOW() WHERE id = $1 AND user_id = $2', [action['task_id'], userId]);
      return { type: t, success: true, detail: `Задача #${action['task_id']} удалена` };
    case 'update_task': {
      const fields: string[] = []; const vals: unknown[] = [];
      for (const key of ['title', 'priority', 'urgency', 'due_date', 'start_date', 'project_id', 'description', 'status']) {
        if (action[key] !== undefined) { fields.push(`${key} = $${fields.length + 1}`); vals.push(action[key]); }
      }
      if (fields.length > 0) await execute(`UPDATE tasks SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${vals.length + 1} AND user_id = $${vals.length + 2}`, [...vals, action['task_id'], userId]);
      return { type: t, success: true, detail: `Задача #${action['task_id']} обновлена` };
    }
    case 'create_project':
      await execute('INSERT INTO projects (name, color, user_id) VALUES ($1, $2, $3)', [action['name'], action['color'] ?? '#6366f1', userId]);
      return { type: t, success: true, detail: `Проект "${action['name']}" создан` };
    case 'update_project': {
      const fields: string[] = []; const vals: unknown[] = [];
      for (const key of ['name', 'color', 'status']) {
        if (action[key] !== undefined) { fields.push(`${key} = $${fields.length + 1}`); vals.push(action[key]); }
      }
      if (fields.length > 0) await execute(`UPDATE projects SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${vals.length + 1} AND user_id = $${vals.length + 2}`, [...vals, action['project_id'], userId]);
      return { type: t, success: true, detail: `Проект #${action['project_id']} обновлён` };
    }
    case 'delete_project':
      await execute('UPDATE projects SET archived = 1, updated_at = NOW() WHERE id = $1 AND user_id = $2', [action['project_id'], userId]);
      return { type: t, success: true, detail: `Проект #${action['project_id']} удалён` };
    case 'create_idea': {
      const ideaInserted = await queryOne<{ id: number }>(
        'INSERT INTO ideas (title, body, category, project_id, status, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [action['title'], (action['body'] as string) ?? '', (action['category'] as string) ?? 'personal', action['project_id'] ?? null, 'backlog', userId],
      );
      void ideaInserted;
      const projName = action['project_id'] ? (await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [action['project_id'] as number]))?.name : null;
      return { type: t, success: true, detail: `Идея "${action['title']}"${projName ? ` → ${projName}` : ''} → Backlog` };
    }
    case 'create_goal':
      await execute(
        'INSERT INTO goals (title, description, type, project_id, target_value, unit, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [action['title'], (action['description'] as string) ?? '', 'goal', action['project_id'] ?? null, action['target_value'] ?? 100, (action['unit'] as string) ?? '%', userId],
      );
      return { type: t, success: true, detail: `🎯 Цель "${action['title']}"` };
    case 'update_goal': {
      const fields: string[] = []; const vals: unknown[] = [];
      if (action['current_value'] !== undefined) { fields.push(`current_value = $${fields.length + 1}`); vals.push(action['current_value']); }
      if (action['status'] !== undefined) { fields.push(`status = $${fields.length + 1}`); vals.push(action['status']); }
      if (fields.length > 0) await execute(`UPDATE goals SET ${fields.join(', ')} WHERE id = $${vals.length + 1} AND user_id = $${vals.length + 2}`, [...vals, action['goal_id'], userId]);
      return { type: t, success: true, detail: `🎯 Цель #${action['goal_id']} обновлена` };
    }
    case 'create_bundle': {
      const pname = (action['project_name'] as string) ?? 'все';
      const match = await findProjectByName(pname);
      if (match === null) return { type: t, success: false, detail: `Проект "${pname}" не найден` };
      const br = await generateBundle(match);
      return { type: t, success: true, detail: `📦 Bundle: ${br.vaultPath} (${br.sizeKb} KB)` };
    }
    case 'create_meeting': {
      const summaryRaw = (action['summary_raw'] as string) ?? '';
      let safeProjId = action['project_id'] ?? null;
      if (safeProjId) {
        const projCheck = await queryOne('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [safeProjId, userId]);
        if (!projCheck) safeProjId = null;
      }
      const mInserted = await queryOne<{ id: number }>(
        'INSERT INTO meetings (title, date, project_id, summary_raw, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [action['title'], action['date'], safeProjId, summaryRaw, userId],
      );
      const meetingId = mInserted!.id;
      if (Array.isArray(action['person_ids'])) {
        for (const pid of action['person_ids'] as number[]) {
          await execute('INSERT INTO meeting_people (meeting_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [meetingId, pid]);
        }
      }
      const meetingTasks = Array.isArray(action['tasks']) ? action['tasks'] as string[] : [];
      for (const taskTitle of meetingTasks) {
        if (!taskTitle || typeof taskTitle !== 'string') continue;
        const tInserted = await queryOne<{ id: number }>(
          'INSERT INTO tasks (project_id, title, description, status, priority, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [safeProjId, taskTitle, `Из встречи: ${action['title']} (${action['date']})`, 'backlog', 3, userId],
        );
        void tInserted;
        try { await execute('INSERT INTO agreements (meeting_id, description, status, person_id) VALUES ($1, $2, $3, $4)', [meetingId, taskTitle, 'pending', null]); } catch {}
      }
      return { type: t, success: true, detail: `Встреча "${action['title']}" на ${action['date']}${meetingTasks.length > 0 ? ` + ${meetingTasks.length} задач в backlog` : ''}` };
    }
    case 'update_meeting': {
      const fields: string[] = []; const vals: unknown[] = [];
      for (const key of ['title', 'date', 'project_id', 'summary_raw']) {
        if (action[key] !== undefined) { fields.push(`${key} = $${fields.length + 1}`); vals.push(action[key]); }
      }
      if (fields.length > 0) await execute(`UPDATE meetings SET ${fields.join(', ')} WHERE id = $${vals.length + 1} AND user_id = $${vals.length + 2}`, [...vals, action['meeting_id'], userId]);
      return { type: t, success: true, detail: `Встреча #${action['meeting_id']} обновлена` };
    }
    case 'delete_meeting':
      await execute('DELETE FROM meeting_people WHERE meeting_id IN (SELECT id FROM meetings WHERE id = $1 AND user_id = $2)', [action['meeting_id'], userId]);
      await execute('DELETE FROM meetings WHERE id = $1 AND user_id = $2', [action['meeting_id'], userId]);
      return { type: t, success: true, detail: `Встреча #${action['meeting_id']} удалена` };
    case 'create_person': {
      const pInserted = await queryOne<{ id: number }>(
        'INSERT INTO people (name, company, role, phone, email, telegram, notes, project_id, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
        [action['name'], action['company'] ?? '', action['role'] ?? '', action['phone'] ?? '', action['email'] ?? '', action['telegram'] ?? '', action['notes'] ?? '', action['project_id'] ?? null, userId],
      );
      const personId = pInserted!.id;
      if (action['project_id']) {
        try { await execute('INSERT INTO people_projects (person_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [personId, action['project_id']]); } catch {}
      }
      return { type: t, success: true, detail: `Контакт "${action['name']}" создан${action['company'] ? ` (${action['company']})` : ''}${action['project_id'] ? ' + привязан к проекту' : ''}` };
    }
    case 'update_person': {
      const pid = action['person_id'] as number;
      const fields: string[] = []; const vals: unknown[] = [];
      for (const f of ['name', 'company', 'role', 'phone', 'email', 'telegram', 'project_id']) {
        if (action[f] !== undefined) { fields.push(`${f} = $${fields.length + 1}`); vals.push(action[f]); }
      }
      if (fields.length > 0) {
        await execute(`UPDATE people SET ${fields.join(', ')} WHERE id = $${vals.length + 1} AND user_id = $${vals.length + 2}`, [...vals, pid, userId]);
        if (action['project_id']) {
          try { await execute('INSERT INTO people_projects (person_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [pid, action['project_id']]); } catch {}
        }
      }
      return { type: t, success: true, detail: `Контакт #${pid} обновлён` };
    }
    case 'delete_person': {
      const personOwnerCheck = await queryOne('SELECT id FROM people WHERE id = $1 AND user_id = $2', [action['person_id'], userId]);
      if (personOwnerCheck) {
        await execute('DELETE FROM task_people WHERE person_id = $1', [action['person_id']]);
        await execute('DELETE FROM meeting_people WHERE person_id = $1', [action['person_id']]);
        await execute('DELETE FROM people_projects WHERE person_id = $1', [action['person_id']]);
        await execute('DELETE FROM people WHERE id = $1 AND user_id = $2', [action['person_id'], userId]);
      }
      return { type: t, success: true, detail: `Контакт #${action['person_id']} удалён` };
    }
    case 'send_to_telegram': {
      const content = (action['content'] as string) ?? '';
      const filename = (action['filename'] as string) ?? 'file.md';
      const message = (action['message'] as string) ?? '';
      if (!content) return { type: t, success: false, detail: 'Нет содержимого для файла' };
      const fs = require('fs') as typeof import('fs');
      const tmpPath = `/tmp/pis-file-${Date.now()}-${filename}`;
      fs.writeFileSync(tmpPath, content, 'utf-8');
      const actionUserId = getUserId(req);
      if (actionUserId) {
        const userRow = await queryOne<{ tg_id: string | null }>('SELECT tg_id FROM users WHERE id = $1', [actionUserId]);
        if (userRow?.tg_id) {
          const { telegramService } = require('../services/telegram.service') as { telegramService: { sendFileToUser: (id: string, path: string, name: string, msg: string) => Promise<void> } };
          await telegramService.sendFileToUser(userRow.tg_id, tmpPath, filename, message || `📄 ${filename}`);
          try { fs.unlinkSync(tmpPath); } catch {}
          return { type: t, success: true, detail: `📤 Файл "${filename}" отправлен в Telegram` };
        }
      }
      try { fs.unlinkSync(tmpPath); } catch {}
      return { type: t, success: false, detail: 'Telegram не привязан к аккаунту' };
    }
    default:
      return { type: t, success: false, detail: 'Неизвестное действие' };
  }
}

const ChatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  context: z.string().optional(),
});

aiRouter.post('/chat', async (req: AuthRequest, res: Response) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  try {
    const limit = await checkAiLimit(req);
    if (!limit.allowed) {
      res.status(429).json(fail(`Лимит AI-сообщений: ${limit.used}/${limit.limit} в день. Перейдите на Pro Max для безлимита.`));
      return;
    }
    // Build vault context for AI (scoped to user)
    let vaultContext = '';
    try { vaultContext = obsidian.forUser(getUserId(req)).readAllForContext(); } catch {}

    const systemPrompt = [
      parsed.data.context ?? '',
      vaultContext ? `\n\nДанные из Obsidian Vault (проекты, задачи, встречи, идеи, люди):\n\n${vaultContext}` : '',
    ].filter(Boolean).join('\n');

    const reply = await claude.chat(parsed.data.messages, systemPrompt, 'gpt-4.1-mini', false, false, getUserId(req));
    res.json(ok({ reply }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/daily-brief', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const today = moscowDateString();
    const userParams: unknown[] = userId != null ? [userId] : [];
    const tasks = await queryAll(`SELECT title, status, priority, urgency, due_date FROM tasks WHERE archived = 0 AND status != 'done'${userId != null ? ' AND user_id = $1' : ''} ORDER BY priority DESC LIMIT 20`, userParams);
    const meetings = await queryAll(`SELECT title, date FROM meetings WHERE date >= $1${userId != null ? ' AND user_id = $2' : ''} ORDER BY date ASC LIMIT 10`, [today, ...userParams]);
    const brief = await claude.dailyBrief(JSON.stringify(tasks), JSON.stringify(meetings));
    res.json(ok({ brief }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/weekly-brief', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const today = moscowDateString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Build parameterized queries for weekly brief
    const completedTasks = userId != null
      ? await queryAll(`SELECT title, priority FROM tasks WHERE status = 'done' AND updated_at >= $1 AND user_id = $2 ORDER BY updated_at DESC`, [weekAgo, userId])
      : await queryAll(`SELECT title, priority FROM tasks WHERE status = 'done' AND updated_at >= $1 ORDER BY updated_at DESC`, [weekAgo]);
    const activeTasks = userId != null
      ? await queryAll(`SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND user_id = $1 ORDER BY priority DESC LIMIT 20`, [userId])
      : await queryAll(`SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') ORDER BY priority DESC LIMIT 20`, []);
    const weekMeetings = userId != null
      ? await queryAll(`SELECT title, date, summary_raw FROM meetings WHERE date >= $1 AND date <= $2 AND user_id = $3 ORDER BY date DESC`, [weekAgo, today, userId])
      : await queryAll(`SELECT title, date, summary_raw FROM meetings WHERE date >= $1 AND date <= $2 ORDER BY date DESC`, [weekAgo, today]);
    const upcomingMeetings = userId != null
      ? await queryAll(`SELECT title, date FROM meetings WHERE date > $1 AND user_id = $2 ORDER BY date ASC LIMIT 5`, [today, userId])
      : await queryAll(`SELECT title, date FROM meetings WHERE date > $1 ORDER BY date ASC LIMIT 5`, [today]);

    const prompt = `Создай еженедельный обзор на русском языке.

Выполнено за неделю (${weekAgo} — ${today}):
${JSON.stringify(completedTasks)}

Активные задачи:
${JSON.stringify(activeTasks)}

Встречи за неделю:
${JSON.stringify(weekMeetings)}

Предстоящие встречи:
${JSON.stringify(upcomingMeetings)}

Сделай структурированный обзор:
1. Главные достижения недели
2. Незавершённые дела и приоритеты
3. Предстоящие встречи
4. Рекомендации на следующую неделю
5. Общие наблюдения и тренды`;

    const brief = await claude.chat([{ role: 'user', content: prompt }], '', 'gpt-4.1-mini', false, false, userId);
    res.json(ok({ brief }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

// Voice command — parse natural language into action and execute
const VoiceCommandSchema = z.object({
  text: z.string().min(1),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional().default([]),
  meeting_id: z.number().int().optional(),
  last_contact: z.object({ id: z.number(), name: z.string() }).optional(),
});

aiRouter.post('/voice-command', async (req: AuthRequest, res: Response) => {
  const parsed = VoiceCommandSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }

  try {
    const limit = await checkAiLimit(req);
    if (!limit.allowed) {
      res.status(429).json(fail(`Лимит AI-сообщений: ${limit.used}/${limit.limit} в день. Перейдите на Pro Max для безлимита.`));
      return;
    }
    const userId = getUserId(req);
    const userFilterSuffix = (offset: number) => userId != null ? ` AND user_id = $${offset}` : '';
    const userParams: unknown[] = userId != null ? [userId] : [];

    // Check for claude/клод prefix → save as Claude note
    const claudeMatch = parsed.data.text.match(/^(клод|claude)[:\s,-]+([\s\S]+)$/i);
    if (claudeMatch) {
      const content = claudeMatch[2].trim();
      await execute('INSERT INTO claude_notes (content, source) VALUES ($1, $2)', [content, 'web']);
      const pendingRow = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM claude_notes WHERE processed = 0', []);
      const pending = pendingRow?.c ?? 0;
      res.json(ok({
        actions: [],
        results: [],
        response: `📝 Заметка сохранена для Claude Code\n📬 В очереди: ${pending}\n\nСкажи мне в Claude Code "обработай заметки"`,
      }));
      return;
    }
    const projects = userId != null
      ? await queryAll<{ id: number; name: string }>(`SELECT id, name FROM projects WHERE archived = 0 AND user_id = $1`, [userId])
      : await queryAll<{ id: number; name: string }>(`SELECT id, name FROM projects WHERE archived = 0`, []);
    const tasks = userId != null
      ? await queryAll<{ id: number; title: string; status: string; project_id: number | null; due_date: string | null }>(`SELECT id, title, status, project_id, due_date FROM tasks WHERE archived = 0 AND user_id = $1`, [userId])
      : await queryAll<{ id: number; title: string; status: string; project_id: number | null; due_date: string | null }>(`SELECT id, title, status, project_id, due_date FROM tasks WHERE archived = 0`, []);
    const people = userId != null
      ? await queryAll<{ id: number; name: string }>(`SELECT id, name FROM people WHERE user_id = $1`, [userId])
      : await queryAll<{ id: number; name: string }>(`SELECT id, name FROM people`, []);

    const today = moscowDateString();
    const overdueTasks = tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'someday');

    // Achievements data for motivation
    const doneToday = tasks.filter(t => t.status === 'done' && t.due_date === today).length;
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const doneRecentlyRow = userId != null
      ? await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND archived = 0 AND updated_at >= $1 AND user_id = $2`, [oneDayAgo, userId])
      : await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND archived = 0 AND updated_at >= $1`, [oneDayAgo]);
    const doneRecently = doneRecentlyRow ?? { c: 0 };
    const doneThisWeekRow = userId != null
      ? await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND archived = 0 AND updated_at >= $1 AND user_id = $2`, [sevenDaysAgo, userId])
      : await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND archived = 0 AND updated_at >= $1`, [sevenDaysAgo]);
    const doneThisWeek = doneThisWeekRow ?? { c: 0 };
    const totalDone = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const todayMeetingsRow = userId != null
      ? await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM meetings WHERE date = $1 AND user_id = $2`, [today, userId])
      : await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM meetings WHERE date = $1`, [today]);
    const todayMeetings = todayMeetingsRow ?? { c: 0 };
    const weekMeetingsRow = userId != null
      ? await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM meetings WHERE date >= $1 AND user_id = $2`, [sevenDaysAgo.split('T')[0], userId])
      : await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM meetings WHERE date >= $1`, [sevenDaysAgo.split('T')[0]]);
    const weekMeetings = weekMeetingsRow ?? { c: 0 };
    const habitStreaks = userId != null
      ? await queryAll<{ title: string; icon: string }>(`
          SELECT h.title, h.icon FROM habits h
          WHERE h.archived = 0 AND h.user_id = $1 AND h.id IN (
            SELECT habit_id FROM habit_logs WHERE date = $2 AND completed = 1
          )
        `, [userId, today])
      : await queryAll<{ title: string; icon: string }>(`
          SELECT h.title, h.icon FROM habits h
          WHERE h.archived = 0 AND h.id IN (
            SELECT habit_id FROM habit_logs WHERE date = $1 AND completed = 1
          )
        `, [today]);
    const streakCounts = userId != null
      ? await queryAll<{ id: number; title: string; icon: string; recent_count: number }>(`
          SELECT h.id, h.title, h.icon,
            (SELECT COUNT(*) FROM habit_logs hl WHERE hl.habit_id = h.id AND hl.completed = 1 AND hl.date >= $2) as recent_count
          FROM habits h WHERE h.archived = 0 AND h.user_id = $1 ORDER BY recent_count DESC LIMIT 5
        `, [userId, thirtyDaysAgo.split('T')[0]])
      : await queryAll<{ id: number; title: string; icon: string; recent_count: number }>(`
          SELECT h.id, h.title, h.icon,
            (SELECT COUNT(*) FROM habit_logs hl WHERE hl.habit_id = h.id AND hl.completed = 1 AND hl.date >= $1) as recent_count
          FROM habits h WHERE h.archived = 0 ORDER BY recent_count DESC LIMIT 5
        `, [thirtyDaysAgo.split('T')[0]]);

    // --- Smart meeting search ---
    const meetingKeywords = /встреч|обсужд|говорил|сказал|рассказ|прошл|последн|протокол|стенограмм|совещан|решили|договорил|итоги|выводы|план из|задачи из|о чём|о чем|кто сказал|что было|возражен|аргумент|консультац|лекци|обучен|созвон/i;
    const needsFullMeetings = meetingKeywords.test(parsed.data.text);
    const requestedMeetingId = parsed.data.meeting_id;

    // Detect time range from user's message
    const timeRangeMatch = parsed.data.text.match(/за\s+(последн(?:юю|ий|ие|ее)|этот|эту|прошл(?:ую|ый|ое))\s+(недел[юиь]|месяц|год|квартал|полгода|2\s*недел)/i)
      || parsed.data.text.match(/(последн(?:юю|ий|ие|ее))\s+(недел[юиь]|месяц|год|квартал)/i);
    let meetingDateFrom: string | null = null;
    if (timeRangeMatch) {
      const unit = timeRangeMatch[2].toLowerCase();
      const now = Date.now();
      if (unit.startsWith('недел')) meetingDateFrom = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      else if (unit === '2 недел' || unit === '2 недели') meetingDateFrom = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      else if (unit === 'месяц') meetingDateFrom = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      else if (unit === 'квартал') meetingDateFrom = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      else if (unit === 'полгода') meetingDateFrom = new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      else if (unit === 'год') meetingDateFrom = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    // Detect project filter from query
    const textLower = parsed.data.text.toLowerCase();
    const matchedProject = projects.find(p => textLower.includes(p.name.toLowerCase()));
    // Detect person filter from query
    const matchedPerson = people.find(p => textLower.includes(p.name.toLowerCase()));

    type MeetingFull = { id: number; title: string; date: string; project_id: number | null; summary_raw?: string; summary_structured?: string };

    /** Extract best content from a meeting for AI context */
    function getMeetingContext(m: MeetingFull, maxLen: number): string {
      // Prefer structured notes (compact & useful), fall back to raw
      if (m.summary_structured) {
        try {
          const s = JSON.parse(m.summary_structured) as { notes?: string; qa?: string; actions?: string };
          const parts: string[] = [];
          if (s.notes) parts.push(s.notes);
          if (s.actions) parts.push('## Задачи\n' + s.actions);
          if (parts.length > 0) return parts.join('\n\n').slice(0, maxLen);
        } catch {}
      }
      return (m.summary_raw || '').slice(0, maxLen);
    }

    let meetings: MeetingFull[];
    let fullMeetingContent = '';

    // If specific meeting_id passed (user is viewing a meeting), always include its full transcript
    if (requestedMeetingId) {
      const currentMeeting = userId != null
        ? await queryOne<MeetingFull>(`SELECT id, title, date, project_id, summary_raw, summary_structured FROM meetings WHERE id = $1 AND user_id = $2`, [requestedMeetingId, userId])
        : await queryOne<MeetingFull>(`SELECT id, title, date, project_id, summary_raw, summary_structured FROM meetings WHERE id = $1`, [requestedMeetingId]);
      if (currentMeeting) {
        fullMeetingContent = `## ТЕКУЩАЯ ВСТРЕЧА (пользователь сейчас её просматривает):\n## ${currentMeeting.title} (${currentMeeting.date})\n${getMeetingContext(currentMeeting, 15000)}`;
      }
      // Also include other relevant meetings
      const otherMeetings = userId != null
        ? await queryAll<MeetingFull>(`SELECT id, title, date, project_id, summary_raw, summary_structured FROM meetings WHERE id != $1 AND user_id = $2 AND (summary_raw != '' OR summary_structured != '') ORDER BY date DESC LIMIT 10`, [requestedMeetingId, userId])
        : await queryAll<MeetingFull>(`SELECT id, title, date, project_id, summary_raw, summary_structured FROM meetings WHERE id != $1 AND (summary_raw != '' OR summary_structured != '') ORDER BY date DESC LIMIT 10`, [requestedMeetingId]);
      if (otherMeetings.length > 0) {
        fullMeetingContent += '\n\n---\n\n' + otherMeetings.map(m =>
          `## Встреча #${m.id}: ${m.title} (${m.date})\n${getMeetingContext(m, 4000)}`
        ).join('\n\n---\n\n');
      }
      meetings = [currentMeeting, ...otherMeetings].filter(Boolean) as MeetingFull[];
    } else if (needsFullMeetings) {
      // Smart meeting query with filters
      const conditions: string[] = ["(summary_raw IS NOT NULL AND summary_raw != '' OR summary_structured IS NOT NULL AND summary_structured != '')"];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (userId != null) { conditions.push(`user_id = $${paramIdx++}`); params.push(userId); }
      if (meetingDateFrom) { conditions.push(`date >= $${paramIdx++}`); params.push(meetingDateFrom); }
      if (matchedProject) { conditions.push(`project_id = $${paramIdx++}`); params.push(matchedProject.id); }

      // If person filter, join with meeting_people
      let query: string;
      if (matchedPerson) {
        query = `SELECT DISTINCT m.id, m.title, m.date, m.project_id, m.summary_raw, m.summary_structured
          FROM meetings m
          JOIN meeting_people mp ON m.id = mp.meeting_id
          WHERE mp.person_id = $${paramIdx++} AND ${conditions.join(' AND ')}
          ORDER BY m.date DESC LIMIT 10`;
        params.push(matchedPerson.id);
      } else {
        query = `SELECT id, title, date, project_id, summary_raw, summary_structured
          FROM meetings WHERE ${conditions.join(' AND ')}
          ORDER BY date DESC LIMIT 10`;
      }

      const allMeetings = await queryAll<MeetingFull>(query, params);

      // Budget: ~30K chars total (faster response, sufficient context)
      const MAX_TOTAL_CHARS = 30000;
      let totalChars = 0;
      const meetingParts: string[] = [];
      const perMeetingBudget = Math.max(1500, Math.floor(MAX_TOTAL_CHARS / Math.max(allMeetings.length, 1)));

      for (const m of allMeetings) {
        const content = getMeetingContext(m, perMeetingBudget);
        if (!content) continue;
        const part = `## Встреча #${m.id}: ${m.title} (${m.date})\n${content}`;
        if (totalChars + part.length > MAX_TOTAL_CHARS) break;
        meetingParts.push(part);
        totalChars += part.length;
      }

      fullMeetingContent = meetingParts.join('\n\n---\n\n');
      meetings = allMeetings;
    } else {
      // No meeting query — just include list for reference
      meetings = userId != null
        ? await queryAll<MeetingFull>(`SELECT id, title, date, project_id FROM meetings WHERE user_id = $1 ORDER BY date DESC LIMIT 30`, [userId])
        : await queryAll<MeetingFull>(`SELECT id, title, date, project_id FROM meetings ORDER BY date DESC LIMIT 30`, []);
    }

    const systemPrompt = `Ты — персональный ассистент и коуч. Умный, дружелюбный, вдумчивый, мотивирующий. Можешь разговаривать на любые темы, советовать, обсуждать идеи.

Подключён к таск-трекеру пользователя.

СТИЛЬ ОБЩЕНИЯ — МОТИВАЦИЯ ПРЕЖДЕ ВСЕГО:
1. ВСЕГДА начинай ответ с чего-то позитивного! Даже если прямых "побед" нет — найди что похвалить: "Ты уже в деле — это главное!", "Круто что следишь за задачами!"
2. Если завершил задачи за неделю — "За эту неделю ты закрыл ${doneThisWeek.c} задач — отличный темп! 💪"
3. Если есть привычки — "Привычки работают! ${habitStreaks.length > 0 ? habitStreaks.map(h => `${h.icon || '✓'} ${h.title} сделана сегодня` ).join(', ') : 'Сегодня ещё есть время отметить'} 🔥"
4. Если провёл встречи — "Продуктивная неделя: ${weekMeetings.c} встреч!"
5. Если задач в работе — "У тебя ${inProgress} задач в работе — двигаешься!"
6. ПОСЛЕ позитива — мягко напомни что осталось, без давления и негатива
7. Если пользователь просто пишет привет/ничего конкретного — подбодри и предложи: "Хочешь закинуть задачу или встречу? Или обсудим что-нибудь?"
8. НЕ начинай с просрочек! НИКОГДА! Сначала ВСЕГДА что-то хорошее.
9. Используй эмодзи, будь живым и энергичным собеседником, не сухим ботом.
10. Если совсем нет успехов — скажи "Новый день — новые возможности! 🚀" или "Сегодня отличный день чтобы начать! ✨"

СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ:
✅ Завершено задач: сегодня ${doneRecently.c}, за неделю ${doneThisWeek.c}, всего ${totalDone}
📋 В работе сейчас: ${inProgress} задач
📅 Встречи: сегодня ${todayMeetings.c}, за неделю ${weekMeetings.c}
${habitStreaks.length > 0 ? `🔥 Привычки сегодня: ${habitStreaks.map(h => `${h.icon || '✓'} ${h.title}`).join(', ')}` : '🌱 Привычки сегодня пока не отмечены — можно напомнить!'}
${streakCounts.filter(h => h.recent_count >= 3).map(h => `🏆 ${h.icon || '✓'} ${h.title}: ${h.recent_count} дней за месяц`).join('\n')}

ДАННЫЕ СИСТЕМЫ:
Сегодня: ${today}
Проекты: ${JSON.stringify(projects.map(p => ({ id: p.id, name: p.name })))}
Задачи (последние 30 + в работе): ${JSON.stringify([...overdueTasks, ...tasks.filter(t => t.status === 'in_progress'), ...tasks.filter(t => !overdueTasks.includes(t) && t.status !== 'in_progress' && t.status !== 'done' && t.status !== 'someday')].slice(0, 30).map(t => ({ id: t.id, title: t.title, status: t.status, project_id: t.project_id, due_date: t.due_date })))}
Всего задач: ${tasks.length} (показаны приоритетные)
${overdueTasks.length > 0 ? `\n⚠️ Просроченные (${overdueTasks.length}): ${JSON.stringify(overdueTasks.map(t => ({ id: t.id, title: t.title, due_date: t.due_date, project_id: t.project_id })))}\n` : ''}Встречи: ${JSON.stringify(meetings.map(m => ({ id: m.id, title: m.title, date: m.date, project_id: m.project_id })))}
Люди: ${JSON.stringify(people.map(p => ({ id: p.id, name: p.name })))}
${parsed.data.last_contact ? `\n🧑 LAST_CONTACT (только что создан/обновлён): id=${parsed.data.last_contact.id}, name="${parsed.data.last_contact.name}". Любые команды про "к проекту", "добавь телефон/email", "привяжи" — относятся к ЭТОМУ контакту!\n` : ''}
${fullMeetingContent ? `\n=== ДАННЫЕ ВСТРЕЧ (${meetings.length} встреч${meetingDateFrom ? `, с ${meetingDateFrom}` : ''}${matchedProject ? `, проект: ${matchedProject.name}` : ''}${matchedPerson ? `, участник: ${matchedPerson.name}` : ''}) ===\n${fullMeetingContent}\n=== КОНЕЦ ДАННЫХ ВСТРЕЧ ===\n\nОтвечай конкретно на основе содержимого встреч выше. Цитируй фрагменты и указывай из какой встречи информация. Если пользователь спрашивает про конкретную тему — ищи по ВСЕМ предоставленным встречам, не только последним.` : ''}

Статусы задач: backlog, todo, in_progress, done, someday
Сейчас: ${moscowDateTimeString()}

ЖЕЛЕЗНЫЕ ПРАВИЛА:
1. Если пользователь даёт команду → ОБЯЗАТЕЛЬНО выполни через actions! НИКОГДА не говори "добавляю"/"создаю" без action в массиве!
2. ЧЕЛОВЕК ≠ ПРОЕКТ! Имена людей (Сергей, Ольга, Иван) → create_person. Проекты — это направления работы (Robots, V-Cards, Стройка).
3. "Добавь Сергея к проекту Robots" = create_person с project_id, НЕ create_project!
4. "Добавь к проекту X" (задачу) = update_task с project_id.
5. Если пользователь просит обработать НЕСКОЛЬКО → отдельный action для КАЖДОГО.
6. Для вопросов (что, как, когда) → actions пусты, ответ в response.
7. Контекст предыдущих сообщений — "её", "эту", "ту", "его" = предыдущий объект.
8. "Привяжи X к проекту Y" = найди person_id по имени → update_person с project_id. ОБЯЗАТЕЛЬНО action!
9. Если указан LAST_CONTACT → "к проекту", "добавь email/телефон", "привяжи" = update_person с его person_id.
10. RESPONSE должен ЧЁТКО сообщать что СДЕЛАНО, а не что планируется. "✅ Создан контакт X" а не "Создаю контакт X".
11. ЗАМЕТКИ ВСТРЕЧИ → ВСТРЕЧА + ЗАДАЧИ В КАРТОЧКЕ! Если пользователь скидывает длинный текст с заметками/конспектом встречи (ключевые слова: "встреча с", "литература", "что важно", имена людей, тезисы) → создай ОДНУ create_meeting с: summary_raw = весь текст заметок, tasks = массив конкретных задач/действий из заметок. Задачи попадут в backlog карточки встречи. В response напиши краткое резюме встречи и список задач, которые создал.
12. Если пользователь указал проект ("проект Образование") → ОБЯЗАТЕЛЬНО найди его project_id и привяжи встречу/задачу к нему!

Верни ТОЛЬКО JSON (без markdown, без \`\`\`). ВАЖНО: поле "response" должно быть ПЕРВЫМ:
{
  "response": "Ответ пользователю — кратко и дружелюбно",
  "actions": [
    {"type": "create_task", "title": "string", "project_id": number|null, "status": "todo", "priority": 1-5, "due_date": "YYYY-MM-DD"|null, "person_ids": [number]},
    {"type": "move_task", "task_id": number, "status": "string"},
    {"type": "delete_task", "task_id": number},
    {"type": "update_task", "task_id": number, ...fields},
    {"type": "create_project", "name": "string", "color": "#hex"},
    {"type": "create_idea", "title": "string", "body": "string?", "project_id": number|null, "category": "business|product|personal|growth"},
    {"type": "create_bundle", "project_name": "string (название проекта или 'все')"},
    {"type": "create_goal", "title": "string", "description": "string?", "project_id": number|null, "target_value": number?, "unit": "string?"},
    {"type": "update_goal", "goal_id": number, "current_value": number?, "status": "active|completed?"},
    {"type": "update_project", "project_id": number, "name": "string?", "color": "#hex?", "status": "string?"},
    {"type": "delete_project", "project_id": number},
    {"type": "create_meeting", "title": "string", "date": "YYYY-MM-DD", "project_id": number|null, "person_ids": [number], "summary_raw": "полный текст заметок встречи", "tasks": ["задача 1", "задача 2"]},
    {"type": "update_meeting", "meeting_id": number, "title": "string?", "date": "YYYY-MM-DD?", "project_id": number?},
    {"type": "delete_meeting", "meeting_id": number},
    {"type": "create_person", "name": "string", "company": "string?", "role": "string?", "phone": "string?", "email": "string?", "telegram": "string?", "notes": "string?", "project_id": number|null},
    {"type": "update_person", "person_id": number, "name": "string?", "company": "string?", "role": "string?", "phone": "string?", "email": "string?", "telegram": "string?", "project_id": number|null},
    {"type": "delete_person", "person_id": number},
    {"type": "send_to_telegram", "content": "текст для файла", "filename": "name.md", "message": "сопроводительное сообщение"}
  ],
  "response": "Ответ пользователю — кратко и дружелюбно"
}

ВАЖНО про файлы:
- Если пользователь просит "сохрани в файл", "отправь в ТГ", "пришли файл" — используй action send_to_telegram
- content = полный текст для файла (markdown)
- filename = имя файла (например "report.md", "tasks.md")
- message = что написать в сообщении при отправке
- Файл будет отправлен пользователю в Telegram`;

    const voiceChatMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...parsed.data.history,
      { role: 'user', content: parsed.data.text },
    ];

    // Check if client wants SSE streaming
    const wantsStream = req.headers['accept'] === 'text/event-stream';
    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      let fullText = '';
      try {
        for await (const token of claude.chatTokenStream(voiceChatMessages, systemPrompt, 'gpt-4.1-mini')) {
          fullText += token;
          res.write(`data: ${JSON.stringify({ t: token })}\n\n`);
        }
      } catch (streamErr) {
        res.write(`data: ${JSON.stringify({ error: streamErr instanceof Error ? streamErr.message : 'stream error' })}\n\n`);
        res.end();
        return;
      }

      // Parse and execute actions from full streamed text
      let streamCommand: { actions: Array<Record<string, unknown>>; response: string };
      try {
        streamCommand = JSON.parse(fullText) as { actions: Array<Record<string, unknown>>; response: string };
      } catch {
        const m = fullText.match(/\{[\s\S]*\}/);
        try { streamCommand = m ? JSON.parse(m[0]) : { actions: [], response: fullText }; }
        catch { streamCommand = { actions: [], response: fullText }; }
      }
      if (!streamCommand.actions) streamCommand.actions = [];

      const streamResults: Array<{ type: string; success: boolean; detail: string }> = [];
      for (const action of streamCommand.actions) {
        try {
          streamResults.push(await executeVoiceAction(action, userId, req as AuthRequest));
        } catch (err) {
          streamResults.push({ type: String(action['type']), success: false, detail: err instanceof Error ? err.message : 'Ошибка' });
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, response: streamCommand.response, results: streamResults })}\n\n`);
      res.end();
      return;
    }

    const result = await claude.chat(voiceChatMessages, systemPrompt, 'gpt-4.1-mini', false, true, userId);

    let command: { actions: Array<Record<string, unknown>>; response: string };
    try {
      command = JSON.parse(result) as { actions: Array<Record<string, unknown>>; response: string };
    } catch {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { command = JSON.parse(jsonMatch[0]); }
        catch { command = { actions: [], response: result }; }
      } else {
        command = { actions: [], response: result };
      }
    }
    if (!command.actions) command.actions = [];
    if (!command.response) command.response = '';
    const results: Array<{ type: string; success: boolean; detail: string }> = [];

    for (const action of command.actions) {
      results.push(await executeVoiceAction(action, userId, req as AuthRequest).catch(err => ({
        type: String(action['type']),
        success: false,
        detail: err instanceof Error ? err.message : 'Ошибка',
      })));
    }

    if (command.actions.length > 0) {
      console.log(`[voice-cmd] actions: ${JSON.stringify(command.actions)}`);
    }
    res.json(ok({ actions: command.actions, results, response: command.response }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Voice command error'));
  }
});

aiRouter.post('/daily-plan', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const today = moscowDateString();

    // Today's tasks by due_date and priority
    const todayTasks = userId != null
      ? await queryAll(`SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status != 'done' AND (due_date = $1 OR status = 'in_progress') AND user_id = $2 ORDER BY priority DESC`, [today, userId])
      : await queryAll(`SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status != 'done' AND (due_date = $1 OR status = 'in_progress') ORDER BY priority DESC`, [today]);

    // All active tasks (for broader context)
    const activeTasks = userId != null
      ? await queryAll(`SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND user_id = $1 ORDER BY priority DESC LIMIT 30`, [userId])
      : await queryAll(`SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') ORDER BY priority DESC LIMIT 30`, []);

    // Today's meetings
    const meetings = userId != null
      ? await queryAll(`SELECT title, date FROM meetings WHERE date = $1 AND user_id = $2 ORDER BY date ASC`, [today, userId])
      : await queryAll(`SELECT title, date FROM meetings WHERE date = $1 ORDER BY date ASC`, [today]);

    // Habits not yet done today
    const habits = userId != null
      ? await queryAll(`
          SELECT h.title, h.icon FROM habits h
          WHERE h.archived = 0 AND h.user_id = $1 AND h.id NOT IN (
            SELECT habit_id FROM habit_logs WHERE date = $2 AND completed = 1
          )
        `, [userId, today])
      : await queryAll(`
          SELECT h.title, h.icon FROM habits h
          WHERE h.archived = 0 AND h.id NOT IN (
            SELECT habit_id FROM habit_logs WHERE date = $1 AND completed = 1
          )
        `, [today]);

    // Goals progress
    const goals = userId != null
      ? await queryAll(`SELECT title, current_value, target_value, unit, status FROM goals WHERE status = 'active' AND user_id = $1`, [userId])
      : await queryAll(`SELECT title, current_value, target_value, unit, status FROM goals WHERE status = 'active'`, []);

    // Priority project context
    const priorityProjectId = req.body?.priority_project_id ? Number(req.body.priority_project_id) : null;
    let priorityLine = '';
    if (priorityProjectId) {
      const proj = await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [priorityProjectId]);
      if (proj) {
        const projTasks = userId != null
          ? await queryAll(`SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND project_id = $1 AND user_id = $2 ORDER BY priority DESC`, [priorityProjectId, userId])
          : await queryAll(`SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND project_id = $1 ORDER BY priority DESC`, [priorityProjectId]);
        priorityLine = `\n\n⭐ ПРИОРИТЕТНЫЙ ПРОЕКТ НА СЕГОДНЯ: "${proj.name}". Его задачи должны быть в фокусе и занимать основную часть дня.\nЗадачи приоритетного проекта: ${JSON.stringify(projTasks)}`;
      }
    }

    const prompt = `Создай оптимальный план на день на русском. Учитывай приоритеты, дедлайны, встречи.${priorityProjectId ? ' Особое внимание удели приоритетному проекту — его задачи должны стоять первыми и занимать большую часть дня.' : ''} Группируй задачи по энергии: утро=сложные, день=средние, вечер=лёгкие. Формат:
🌅 Утро (8:00-12:00)
- [ ] Задача 1
- [ ] Задача 2

☀️ День (12:00-17:00)
...

🌙 Вечер (17:00-21:00)
...

Данные:
Задачи на сегодня: ${JSON.stringify(todayTasks)}
Все активные задачи: ${JSON.stringify(activeTasks)}
Встречи сегодня: ${JSON.stringify(meetings)}
Привычки (не выполнены сегодня): ${JSON.stringify(habits)}
Цели и прогресс: ${JSON.stringify(goals)}${priorityLine}
Дата: ${today}`;

    const plan = await claude.chat([{ role: 'user', content: prompt }], '', 'gpt-4.1-mini', false, false, userId);
    res.json(ok({ plan }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/productivity-analysis', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const today = moscowDateString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Tasks completed in last 7 days
    const completedTasks = userId != null
      ? await queryAll(`SELECT title, priority, project_id, updated_at FROM tasks WHERE status = 'done' AND updated_at >= $1 AND user_id = $2 ORDER BY updated_at DESC`, [weekAgo, userId])
      : await queryAll(`SELECT title, priority, project_id, updated_at FROM tasks WHERE status = 'done' AND updated_at >= $1 ORDER BY updated_at DESC`, [weekAgo]);

    // Tasks created in last 7 days
    const createdTasks = userId != null
      ? await queryAll(`SELECT title, priority, project_id, created_at FROM tasks WHERE created_at >= $1 AND user_id = $2 ORDER BY created_at DESC`, [weekAgo, userId])
      : await queryAll(`SELECT title, priority, project_id, created_at FROM tasks WHERE created_at >= $1 ORDER BY created_at DESC`, [weekAgo]);

    // Overdue tasks
    const overdueTasks = userId != null
      ? await queryAll(`SELECT title, priority, due_date, project_id FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < $1 AND user_id = $2 ORDER BY due_date ASC`, [today, userId])
      : await queryAll(`SELECT title, priority, due_date, project_id FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < $1 ORDER BY due_date ASC`, [today]);

    // Task distribution by project
    const projectDistribution = userId != null
      ? await queryAll(`
          SELECT p.name as project, COUNT(t.id) as task_count
          FROM tasks t
          LEFT JOIN projects p ON t.project_id = p.id
          WHERE t.archived = 0 AND t.status != 'done' AND t.user_id = $1
          GROUP BY t.project_id, p.name
          ORDER BY task_count DESC
        `, [userId])
      : await queryAll(`
          SELECT p.name as project, COUNT(t.id) as task_count
          FROM tasks t
          LEFT JOIN projects p ON t.project_id = p.id
          WHERE t.archived = 0 AND t.status != 'done'
          GROUP BY t.project_id, p.name
          ORDER BY task_count DESC
        `, []);

    // Habit completion rate (last 7 days)
    const habits = userId != null
      ? await queryAll<{ id: number; title: string }>(`SELECT id, title FROM habits WHERE archived = 0 AND user_id = $1`, [userId])
      : await queryAll<{ id: number; title: string }>(`SELECT id, title FROM habits WHERE archived = 0`, []);
    const habitLogs = await queryAll<{ habit_id: number; completed_days: number }>(
      "SELECT habit_id, COUNT(*) as completed_days FROM habit_logs WHERE date >= $1 AND completed = 1 GROUP BY habit_id",
      [weekAgo]
    );
    const habitStats = habits.map(h => {
      const log = habitLogs.find(l => l.habit_id === h.id);
      return { title: h.title, completed_days: log?.completed_days ?? 0, total_days: 7 };
    });

    // Goals progress
    const goals = userId != null
      ? await queryAll(`SELECT title, current_value, target_value, unit, status FROM goals WHERE status = 'active' AND user_id = $1`, [userId])
      : await queryAll(`SELECT title, current_value, target_value, unit, status FROM goals WHERE status = 'active'`, []);

    const prompt = `Проведи анализ продуктивности за последние 7 дней на русском языке.

Выполнено задач: ${completedTasks.length}
Создано задач: ${createdTasks.length}
Просроченные задачи: ${JSON.stringify(overdueTasks)}
Распределение по проектам: ${JSON.stringify(projectDistribution)}
Привычки (за 7 дней): ${JSON.stringify(habitStats)}
Цели: ${JSON.stringify(goals)}

Период: ${weekAgo} — ${today}

Сделай структурированный анализ:
1. 📈 Общая статистика (выполнено vs создано)
2. 📊 Распределение по проектам (% задач)
3. ⏰ Просроченные задачи и рекомендации
4. ✅ Привычки — процент выполнения
5. 🎯 Прогресс по целям
6. 💡 Рекомендации по улучшению продуктивности`;

    const analysis = await claude.chat([{ role: 'user', content: prompt }], '', 'gpt-4.1-mini', false, false, userId);
    res.json(ok({ analysis }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.get('/search', async (req: AuthRequest, res: Response) => {
  const q = req.query['q'];
  if (typeof q !== 'string' || !q) { res.status(400).json(fail('Query parameter q is required')); return; }
  try {
    const tasks = await queryAll("SELECT title FROM tasks WHERE title LIKE $1 LIMIT 10", [`%${q}%`]);
    const meetings = await queryAll("SELECT title, summary_raw FROM meetings WHERE title LIKE $1 OR summary_raw LIKE $2 LIMIT 5", [`%${q}%`, `%${q}%`]);
    const result = await claude.searchKnowledge(q, JSON.stringify({ tasks, meetings }));
    res.json(ok(result));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Search error'));
  }
});
