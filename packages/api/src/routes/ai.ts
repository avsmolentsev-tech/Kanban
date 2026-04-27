import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ClaudeService } from '../services/claude.service';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';
import { moscowDateString, moscowDateTimeString } from '../utils/time';
import { generateBundle, findProjectByName } from '../services/bundle.service';
import type { AuthRequest } from '../middleware/auth';
import { getUserId } from '../middleware/user-scope';

export const aiRouter = Router();
const claude = new ClaudeService();
const obsidian = new ObsidianService(config.vaultPath);

const ChatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  context: z.string().optional(),
});

aiRouter.post('/chat', async (req: AuthRequest, res: Response) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  try {
    // Build vault context for AI (scoped to user)
    let vaultContext = '';
    try { vaultContext = obsidian.forUser(getUserId(req)).readAllForContext(); } catch {}

    const systemPrompt = [
      parsed.data.context ?? '',
      vaultContext ? `\n\nДанные из Obsidian Vault (проекты, задачи, встречи, идеи, люди):\n\n${vaultContext}` : '',
    ].filter(Boolean).join('\n');

    const reply = await claude.chat(parsed.data.messages, systemPrompt, 'gpt-4.1');
    res.json(ok({ reply }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/daily-brief', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const userFilter = userId != null ? ' AND user_id = ?' : '';
    const userParams = userId != null ? [userId] : [];
    const today = moscowDateString();
    const tasks = getDb().prepare(`SELECT title, status, priority, urgency, due_date FROM tasks WHERE archived = 0 AND status != 'done'${userFilter} ORDER BY priority DESC LIMIT 20`).all(...userParams);
    const meetings = getDb().prepare(`SELECT title, date FROM meetings WHERE date >= ?${userFilter} ORDER BY date ASC LIMIT 10`).all(today, ...userParams);
    const brief = await claude.dailyBrief(JSON.stringify(tasks), JSON.stringify(meetings));
    res.json(ok({ brief }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/weekly-brief', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const userFilter = userId != null ? ' AND user_id = ?' : '';
    const userParams = userId != null ? [userId] : [];
    const today = moscowDateString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const db = getDb();
    const completedTasks = db.prepare(`SELECT title, priority FROM tasks WHERE status = 'done' AND updated_at >= ?${userFilter} ORDER BY updated_at DESC`).all(weekAgo, ...userParams);
    const activeTasks = db.prepare(`SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday')${userFilter} ORDER BY priority DESC LIMIT 20`).all(...userParams);
    const weekMeetings = db.prepare(`SELECT title, date, summary_raw FROM meetings WHERE date >= ? AND date <= ?${userFilter} ORDER BY date DESC`).all(weekAgo, today, ...userParams);
    const upcomingMeetings = db.prepare(`SELECT title, date FROM meetings WHERE date > ?${userFilter} ORDER BY date ASC LIMIT 5`).all(today, ...userParams);

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

    const brief = await claude.chat([{ role: 'user', content: prompt }], '', 'gpt-4.1');
    res.json(ok({ brief }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

// Voice command — parse natural language into action and execute
const VoiceCommandSchema = z.object({
  text: z.string().min(1),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional().default([]),
});

aiRouter.post('/voice-command', async (req: AuthRequest, res: Response) => {
  const parsed = VoiceCommandSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }

  try {
    const db = getDb();
    const userId = getUserId(req);
    const userFilter = userId != null ? ' AND user_id = ?' : '';
    const userParams: unknown[] = userId != null ? [userId] : [];

    // Check for claude/клод prefix → save as Claude note
    const claudeMatch = parsed.data.text.match(/^(клод|claude)[:\s,-]+([\s\S]+)$/i);
    if (claudeMatch) {
      const content = claudeMatch[2].trim();
      db.prepare('INSERT INTO claude_notes (content, source) VALUES (?, ?)').run(content, 'web');
      const pending = (db.prepare('SELECT COUNT(*) as c FROM claude_notes WHERE processed = 0').get() as { c: number }).c;
      res.json(ok({
        actions: [],
        results: [],
        response: `📝 Заметка сохранена для Claude Code\n📬 В очереди: ${pending}\n\nСкажи мне в Claude Code "обработай заметки"`,
      }));
      return;
    }
    const projects = db.prepare(`SELECT id, name FROM projects WHERE archived = 0${userFilter}`).all(...userParams) as Array<{ id: number; name: string }>;
    const tasks = db.prepare(`SELECT id, title, status, project_id, due_date FROM tasks WHERE archived = 0${userFilter}`).all(...userParams) as Array<{ id: number; title: string; status: string; project_id: number | null; due_date: string | null }>;
    const people = db.prepare(`SELECT id, name FROM people WHERE 1=1${userFilter}`).all(...userParams) as Array<{ id: number; name: string }>;

    const today = moscowDateString();
    const overdueTasks = tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'someday');

    // Auto-detect if question is about meetings → include full content
    const meetingKeywords = /встреч|обсужд|говорил|сказал|рассказ|прошл|последн|протокол|стенограмм|робот|стартап|консультац|совещан/i;
    const needsFullMeetings = meetingKeywords.test(parsed.data.text);

    type MeetingWithContent = { id: number; title: string; date: string; project_id: number | null; summary_raw?: string };
    let meetings: MeetingWithContent[];
    let fullMeetingContent = '';

    if (needsFullMeetings) {
      const fullMeetings = db.prepare(`SELECT id, title, date, project_id, summary_raw FROM meetings WHERE 1=1${userFilter} ORDER BY date DESC LIMIT 5`).all(...userParams) as Array<MeetingWithContent>;
      fullMeetingContent = fullMeetings.map(m =>
        `## Встреча #${m.id}: ${m.title} (${m.date})\n${(m.summary_raw || '').slice(0, 8000)}`
      ).join('\n\n---\n\n');
      meetings = fullMeetings;
    } else {
      meetings = db.prepare(`SELECT id, title, date, project_id FROM meetings WHERE 1=1${userFilter} ORDER BY date DESC LIMIT 20`).all(...userParams) as Array<MeetingWithContent>;
    }

    const systemPrompt = `Ты — персональный ассистент. Умный, дружелюбный, вдумчивый собеседник. Можешь разговаривать на любые темы, советовать, обсуждать идеи.

Подключён к таск-трекеру пользователя.

ДАННЫЕ СИСТЕМЫ:
Сегодня: ${today}
Проекты: ${JSON.stringify(projects.map(p => ({ id: p.id, name: p.name })))}
Задачи: ${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, status: t.status, project_id: t.project_id, due_date: t.due_date })))}
${overdueTasks.length > 0 ? `\n⚠️ ПРОСРОЧЕННЫЕ ЗАДАЧИ (${overdueTasks.length}): ${JSON.stringify(overdueTasks.map(t => ({ id: t.id, title: t.title, due_date: t.due_date, project_id: t.project_id })))}\nОбязательно напоминай пользователю о просроченных задачах если он спрашивает о статусе, задачах или прогрессе!\n` : ''}Встречи: ${JSON.stringify(meetings.map(m => ({ id: m.id, title: m.title, date: m.date, project_id: m.project_id })))}
Люди: ${JSON.stringify(people.map(p => ({ id: p.id, name: p.name })))}
${fullMeetingContent ? `\n=== ПОЛНЫЕ ТРАНСКРИПЦИИ ПОСЛЕДНИХ ВСТРЕЧ ===\n${fullMeetingContent}\n=== КОНЕЦ ===\n\nОтвечай конкретно на основе содержимого транскрипций выше. Цитируй фрагменты когда уместно.` : ''}

Статусы задач: backlog, todo, in_progress, done, someday
Сейчас: ${moscowDateTimeString()}

КАК РАБОТАТЬ:
1. Если пользователь даёт команду (создай, добавь, перенеси, удали, обнови, поставь, привяжи, измени, разбери, раскидай) → ОБЯЗАТЕЛЬНО выполни через actions! Не просто говори что сделал — ВЕРНИ actions массив!
2. "Добавь к проекту X" = update_task с project_id. "Добавь к выполнению в этом месяце" = update_task со статусом и due_date.
3. Если пользователь просит обработать НЕСКОЛЬКО задач — верни отдельный action для КАЖДОЙ задачи.
4. Для вопросов (что, как, когда, расскажи) → actions пусты, ответ в response.
5. НИКОГДА не говори "добавляю" или "делаю" в response если actions массив пустой! Либо делай, либо объясни почему не можешь.
5. Контекст предыдущих сообщений — для "её", "эту", "ту"

Верни ТОЛЬКО JSON (без markdown, без \`\`\`):
{
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
    {"type": "create_meeting", "title": "string", "date": "YYYY-MM-DD", "project_id": number|null, "person_ids": [number]},
    {"type": "update_meeting", "meeting_id": number, "title": "string?", "date": "YYYY-MM-DD?", "project_id": number?},
    {"type": "delete_meeting", "meeting_id": number},
    {"type": "create_person", "name": "string", "company": "string?", "role": "string?"},
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

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...parsed.data.history,
      { role: 'user', content: parsed.data.text },
    ];

    const result = await claude.chat(messages, systemPrompt, 'gpt-4.1', false, true);

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
      try {
        switch (action['type']) {
          case 'create_task': {
            const r = db.prepare('INSERT INTO tasks (project_id, title, description, status, priority, due_date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
              action['project_id'] ?? null, action['title'], (action['description'] as string) ?? '', action['status'] ?? 'todo', action['priority'] ?? 3, action['due_date'] ?? null, userId
            );
            const taskId = Number(r.lastInsertRowid);
            // Auto-add self if no people specified
            let peopleIds = Array.isArray(action['person_ids']) ? action['person_ids'] as number[] : [];
            if (peopleIds.length === 0) {
              const selfRow = db.prepare("SELECT id FROM people WHERE LOWER(name) IN ('я','me','self') LIMIT 1").get() as { id: number } | undefined;
              if (selfRow) peopleIds = [selfRow.id];
            }
            for (const pid of peopleIds) {
              db.prepare('INSERT OR IGNORE INTO task_people (task_id, person_id) VALUES (?, ?)').run(taskId, pid);
            }
            results.push({ type: 'create_task', success: true, detail: `Задача "${action['title']}" создана` });
            break;
          }
          case 'move_task': {
            db.prepare("UPDATE tasks SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(action['status'], action['task_id']);
            results.push({ type: 'move_task', success: true, detail: `Задача #${action['task_id']} → ${action['status']}` });
            break;
          }
          case 'delete_task': {
            db.prepare("UPDATE tasks SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(action['task_id']);
            results.push({ type: 'delete_task', success: true, detail: `Задача #${action['task_id']} удалена` });
            break;
          }
          case 'update_task': {
            const fields: string[] = []; const values: unknown[] = [];
            for (const key of ['title', 'priority', 'urgency', 'due_date', 'start_date', 'project_id', 'description', 'status']) {
              if (action[key] !== undefined) { fields.push(`${key} = ?`); values.push(action[key]); }
            }
            if (fields.length > 0) db.prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, action['task_id']);
            results.push({ type: 'update_task', success: true, detail: `Задача #${action['task_id']} обновлена` });
            break;
          }
          case 'create_project': {
            db.prepare('INSERT INTO projects (name, color, user_id) VALUES (?, ?, ?)').run(action['name'], action['color'] ?? '#6366f1', userId);
            results.push({ type: 'create_project', success: true, detail: `Проект "${action['name']}" создан` });
            break;
          }
          case 'create_idea': {
            const r = db.prepare('INSERT INTO ideas (title, body, category, project_id, status, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(
              action['title'], (action['body'] as string) ?? '', (action['category'] as string) ?? 'personal',
              action['project_id'] ?? null, 'backlog', userId
            );
            const ideaId = Number(r.lastInsertRowid);
            const projName = action['project_id'] ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(action['project_id'] as number) as { name: string } | undefined)?.name : null;
            results.push({ type: 'create_idea', success: true, detail: `Идея "${action['title']}"${projName ? ` → ${projName}` : ''} → Backlog` });
            void ideaId;
            break;
          }
          case 'create_goal': {
            db.prepare('INSERT INTO goals (title, description, type, project_id, target_value, unit, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
              action['title'], (action['description'] as string) ?? '', 'goal',
              action['project_id'] ?? null, action['target_value'] ?? 100, (action['unit'] as string) ?? '%', userId
            );
            results.push({ type: 'create_goal', success: true, detail: `🎯 Цель "${action['title']}"` });
            break;
          }
          case 'update_goal': {
            const fields: string[] = []; const values: unknown[] = [];
            if (action['current_value'] !== undefined) { fields.push('current_value = ?'); values.push(action['current_value']); }
            if (action['status'] !== undefined) { fields.push('status = ?'); values.push(action['status']); }
            if (fields.length > 0) db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`).run(...values, action['goal_id']);
            results.push({ type: 'update_goal', success: true, detail: `🎯 Цель #${action['goal_id']} обновлена` });
            break;
          }
          case 'create_bundle': {
            const pname = (action['project_name'] as string) ?? 'все';
            const match = findProjectByName(pname);
            if (match === null) {
              results.push({ type: 'create_bundle', success: false, detail: `Проект "${pname}" не найден` });
            } else {
              const br = generateBundle(match);
              results.push({ type: 'create_bundle', success: true, detail: `📦 Bundle: ${br.vaultPath} (${br.sizeKb} KB)` });
            }
            break;
          }
          case 'update_project': {
            const fields: string[] = []; const values: unknown[] = [];
            for (const key of ['name', 'color', 'status']) {
              if (action[key] !== undefined) { fields.push(`${key} = ?`); values.push(action[key]); }
            }
            if (fields.length > 0) db.prepare(`UPDATE projects SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, action['project_id']);
            results.push({ type: 'update_project', success: true, detail: `Проект #${action['project_id']} обновлён` });
            break;
          }
          case 'delete_project': {
            db.prepare("UPDATE projects SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(action['project_id']);
            results.push({ type: 'delete_project', success: true, detail: `Проект #${action['project_id']} удалён` });
            break;
          }
          case 'create_meeting': {
            const r = db.prepare('INSERT INTO meetings (title, date, project_id, summary_raw, user_id) VALUES (?, ?, ?, ?, ?)').run(action['title'], action['date'], action['project_id'] ?? null, '', userId);
            const meetingId = Number(r.lastInsertRowid);
            if (Array.isArray(action['person_ids'])) {
              for (const pid of action['person_ids'] as number[]) db.prepare('INSERT OR IGNORE INTO meeting_people (meeting_id, person_id) VALUES (?, ?)').run(meetingId, pid);
            }
            results.push({ type: 'create_meeting', success: true, detail: `Встреча "${action['title']}" на ${action['date']}` });
            break;
          }
          case 'update_meeting': {
            const fields: string[] = []; const values: unknown[] = [];
            for (const key of ['title', 'date', 'project_id', 'summary_raw']) {
              if (action[key] !== undefined) { fields.push(`${key} = ?`); values.push(action[key]); }
            }
            if (fields.length > 0) db.prepare(`UPDATE meetings SET ${fields.join(', ')} WHERE id = ?`).run(...values, action['meeting_id']);
            results.push({ type: 'update_meeting', success: true, detail: `Встреча #${action['meeting_id']} обновлена` });
            break;
          }
          case 'delete_meeting': {
            db.prepare('DELETE FROM meeting_people WHERE meeting_id = ?').run(action['meeting_id']);
            db.prepare('DELETE FROM meetings WHERE id = ?').run(action['meeting_id']);
            results.push({ type: 'delete_meeting', success: true, detail: `Встреча #${action['meeting_id']} удалена` });
            break;
          }
          case 'create_person': {
            const r = db.prepare('INSERT INTO people (name, company, role, user_id) VALUES (?, ?, ?, ?)').run(action['name'], action['company'] ?? '', action['role'] ?? '', userId);
            results.push({ type: 'create_person', success: true, detail: `Контакт "${action['name']}" создан` });
            break;
          }
          case 'delete_person': {
            db.prepare('DELETE FROM task_people WHERE person_id = ?').run(action['person_id']);
            db.prepare('DELETE FROM meeting_people WHERE person_id = ?').run(action['person_id']);
            db.prepare('DELETE FROM people_projects WHERE person_id = ?').run(action['person_id']);
            db.prepare('DELETE FROM people WHERE id = ?').run(action['person_id']);
            results.push({ type: 'delete_person', success: true, detail: `Контакт #${action['person_id']} удалён` });
            break;
          }
          case 'send_to_telegram': {
            const content = (action['content'] as string) ?? '';
            const filename = (action['filename'] as string) ?? 'file.md';
            const message = (action['message'] as string) ?? '';
            if (!content) {
              results.push({ type: 'send_to_telegram', success: false, detail: 'Нет содержимого для файла' });
              break;
            }
            // Write temp file and send via telegram
            const fs = require('fs');
            const tmpPath = `/tmp/pis-file-${Date.now()}-${filename}`;
            fs.writeFileSync(tmpPath, content, 'utf-8');
            // Find user's tg_id
            const userId = getUserId(req as AuthRequest);
            if (userId) {
              const userRow = db.prepare('SELECT tg_id FROM users WHERE id = ?').get(userId) as { tg_id: string | null } | undefined;
              if (userRow?.tg_id) {
                const { telegramService } = require('../services/telegram.service');
                await telegramService.sendFileToUser(userRow.tg_id, tmpPath, filename, message || `📄 ${filename}`);
                results.push({ type: 'send_to_telegram', success: true, detail: `📤 Файл "${filename}" отправлен в Telegram` });
              } else {
                results.push({ type: 'send_to_telegram', success: false, detail: 'Telegram не привязан к аккаунту' });
              }
            } else {
              results.push({ type: 'send_to_telegram', success: false, detail: 'Не авторизован' });
            }
            try { fs.unlinkSync(tmpPath); } catch {}
            break;
          }
          default:
            results.push({ type: String(action['type']), success: false, detail: 'Неизвестное действие' });
        }
      } catch (err) {
        results.push({ type: String(action['type']), success: false, detail: err instanceof Error ? err.message : 'Ошибка' });
      }
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
    const userFilter = userId != null ? ' AND user_id = ?' : '';
    const userParams = userId != null ? [userId] : [];
    const today = moscowDateString();
    const db = getDb();

    // Today's tasks by due_date and priority
    const todayTasks = db.prepare(
      `SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status != 'done' AND (due_date = ? OR status = 'in_progress')${userFilter} ORDER BY priority DESC`
    ).all(today, ...userParams);

    // All active tasks (for broader context)
    const activeTasks = db.prepare(
      `SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday')${userFilter} ORDER BY priority DESC LIMIT 30`
    ).all(...userParams);

    // Today's meetings
    const meetings = db.prepare(
      `SELECT title, date FROM meetings WHERE date = ?${userFilter} ORDER BY date ASC`
    ).all(today, ...userParams);

    // Habits not yet done today
    const habits = db.prepare(`
      SELECT h.title, h.icon FROM habits h
      WHERE h.archived = 0${userFilter} AND h.id NOT IN (
        SELECT habit_id FROM habit_logs WHERE date = ? AND completed = 1
      )
    `).all(...userParams, today);

    // Goals progress
    const goals = db.prepare(
      `SELECT title, current_value, target_value, unit, status FROM goals WHERE status = 'active'${userFilter}`
    ).all(...userParams);

    const prompt = `Создай оптимальный план на день на русском. Учитывай приоритеты, дедлайны, встречи. Группируй задачи по энергии: утро=сложные, день=средние, вечер=лёгкие. Формат:
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
Цели и прогресс: ${JSON.stringify(goals)}
Дата: ${today}`;

    const plan = await claude.chat([{ role: 'user', content: prompt }], '', 'gpt-4.1');
    res.json(ok({ plan }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/productivity-analysis', async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const userFilter = userId != null ? ' AND user_id = ?' : '';
    const userParams = userId != null ? [userId] : [];
    const today = moscowDateString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const db = getDb();

    // Tasks completed in last 7 days
    const completedTasks = db.prepare(
      `SELECT title, priority, project_id, updated_at FROM tasks WHERE status = 'done' AND updated_at >= ?${userFilter} ORDER BY updated_at DESC`
    ).all(weekAgo, ...userParams);

    // Tasks created in last 7 days
    const createdTasks = db.prepare(
      `SELECT title, priority, project_id, created_at FROM tasks WHERE created_at >= ?${userFilter} ORDER BY created_at DESC`
    ).all(weekAgo, ...userParams);

    // Overdue tasks
    const overdueTasks = db.prepare(
      `SELECT title, priority, due_date, project_id FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND due_date < ?${userFilter} ORDER BY due_date ASC`
    ).all(today, ...userParams);

    // Task distribution by project
    const projectDistribution = db.prepare(`
      SELECT p.name as project, COUNT(t.id) as task_count
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.archived = 0 AND t.status != 'done'${userId != null ? ' AND t.user_id = ?' : ''}
      GROUP BY t.project_id
      ORDER BY task_count DESC
    `).all(...userParams);

    // Habit completion rate (last 7 days)
    const habits = db.prepare(`SELECT id, title FROM habits WHERE archived = 0${userFilter}`).all(...userParams) as Array<{ id: number; title: string }>;
    const habitLogs = db.prepare(
      "SELECT habit_id, COUNT(*) as completed_days FROM habit_logs WHERE date >= ? AND completed = 1 GROUP BY habit_id"
    ).all(weekAgo) as Array<{ habit_id: number; completed_days: number }>;
    const habitStats = habits.map(h => {
      const log = habitLogs.find(l => l.habit_id === h.id);
      return { title: h.title, completed_days: log?.completed_days ?? 0, total_days: 7 };
    });

    // Goals progress
    const goals = db.prepare(
      `SELECT title, current_value, target_value, unit, status FROM goals WHERE status = 'active'${userFilter}`
    ).all(...userParams);

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

    const analysis = await claude.chat([{ role: 'user', content: prompt }], '', 'gpt-4.1');
    res.json(ok({ analysis }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.get('/search', async (req: AuthRequest, res: Response) => {
  const q = req.query['q'];
  if (typeof q !== 'string' || !q) { res.status(400).json(fail('Query parameter q is required')); return; }
  try {
    const tasks = getDb().prepare("SELECT title FROM tasks WHERE title LIKE ? LIMIT 10").all(`%${q}%`);
    const meetings = getDb().prepare("SELECT title, summary_raw FROM meetings WHERE title LIKE ? OR summary_raw LIKE ? LIMIT 5").all(`%${q}%`, `%${q}%`);
    const result = await claude.searchKnowledge(q, JSON.stringify({ tasks, meetings }));
    res.json(ok(result));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Search error'));
  }
});
