import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ClaudeService } from '../services/claude.service';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';
import { ObsidianService } from '../services/obsidian.service';
import { config } from '../config';
import { moscowDateString, moscowDateTimeString } from '../utils/time';
import { generateBundle, findProjectByName } from '../services/bundle.service';

export const aiRouter = Router();
const claude = new ClaudeService();
const obsidian = new ObsidianService(config.vaultPath);

const ChatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  context: z.string().optional(),
});

aiRouter.post('/chat', async (req: Request, res: Response) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  try {
    // Build vault context for AI
    let vaultContext = '';
    try { vaultContext = obsidian.readAllForContext(); } catch {}

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

aiRouter.post('/daily-brief', async (_req: Request, res: Response) => {
  try {
    const today = moscowDateString();
    const tasks = getDb().prepare("SELECT title, status, priority, urgency, due_date FROM tasks WHERE archived = 0 AND status != 'done' ORDER BY priority DESC LIMIT 20").all();
    const meetings = getDb().prepare('SELECT title, date FROM meetings WHERE date >= ? ORDER BY date ASC LIMIT 10').all(today);
    const brief = await claude.dailyBrief(JSON.stringify(tasks), JSON.stringify(meetings));
    res.json(ok({ brief }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/weekly-brief', async (_req: Request, res: Response) => {
  try {
    const today = moscowDateString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const db = getDb();
    const completedTasks = db.prepare("SELECT title, priority FROM tasks WHERE status = 'done' AND updated_at >= ? ORDER BY updated_at DESC").all(weekAgo);
    const activeTasks = db.prepare("SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') ORDER BY priority DESC LIMIT 20").all();
    const weekMeetings = db.prepare('SELECT title, date, summary_raw FROM meetings WHERE date >= ? AND date <= ? ORDER BY date DESC').all(weekAgo, today);
    const upcomingMeetings = db.prepare('SELECT title, date FROM meetings WHERE date > ? ORDER BY date ASC LIMIT 5').all(today);

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

aiRouter.post('/voice-command', async (req: Request, res: Response) => {
  const parsed = VoiceCommandSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }

  try {
    const db = getDb();

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
    const projects = db.prepare('SELECT id, name FROM projects WHERE archived = 0').all() as Array<{ id: number; name: string }>;
    const tasks = db.prepare("SELECT id, title, status, project_id FROM tasks WHERE archived = 0").all() as Array<{ id: number; title: string; status: string; project_id: number | null }>;
    const people = db.prepare("SELECT id, name FROM people").all() as Array<{ id: number; name: string }>;

    // Auto-detect if question is about meetings → include full content
    const meetingKeywords = /встреч|обсужд|говорил|сказал|рассказ|прошл|последн|протокол|стенограмм|робот|стартап|консультац|совещан/i;
    const needsFullMeetings = meetingKeywords.test(parsed.data.text);

    type MeetingWithContent = { id: number; title: string; date: string; project_id: number | null; summary_raw?: string };
    let meetings: MeetingWithContent[];
    let fullMeetingContent = '';

    if (needsFullMeetings) {
      const fullMeetings = db.prepare("SELECT id, title, date, project_id, summary_raw FROM meetings ORDER BY date DESC LIMIT 5").all() as Array<MeetingWithContent>;
      fullMeetingContent = fullMeetings.map(m =>
        `## Встреча #${m.id}: ${m.title} (${m.date})\n${(m.summary_raw || '').slice(0, 8000)}`
      ).join('\n\n---\n\n');
      meetings = fullMeetings;
    } else {
      meetings = db.prepare("SELECT id, title, date, project_id FROM meetings ORDER BY date DESC LIMIT 20").all() as Array<MeetingWithContent>;
    }

    const systemPrompt = `Ты — персональный ассистент. Умный, дружелюбный, вдумчивый собеседник. Можешь разговаривать на любые темы, советовать, обсуждать идеи.

Подключён к таск-трекеру пользователя.

ДАННЫЕ СИСТЕМЫ:
Проекты: ${JSON.stringify(projects.map(p => ({ id: p.id, name: p.name })))}
Задачи: ${JSON.stringify(tasks.slice(0, 30).map(t => ({ id: t.id, title: t.title, status: t.status, project_id: t.project_id })))}
Встречи: ${JSON.stringify(meetings.map(m => ({ id: m.id, title: m.title, date: m.date, project_id: m.project_id })))}
Люди: ${JSON.stringify(people.map(p => ({ id: p.id, name: p.name })))}
${fullMeetingContent ? `\n=== ПОЛНЫЕ ТРАНСКРИПЦИИ ПОСЛЕДНИХ ВСТРЕЧ ===\n${fullMeetingContent}\n=== КОНЕЦ ===\n\nОтвечай конкретно на основе содержимого транскрипций выше. Цитируй фрагменты когда уместно.` : ''}

Статусы задач: backlog, todo, in_progress, done, someday
Сейчас: ${moscowDateTimeString()}

КАК РАБОТАТЬ:
1. Если пользователь чётко даёт команду (создай, перенеси, удали, обнови) → выполни через actions
2. ВО ВСЕХ ОСТАЛЬНЫХ СЛУЧАЯХ → свободный разговор, actions пусты, отвечай развёрнуто в response
3. Отвечай на русском, содержательно
4. НЕ создавай объекты если пользователь просто общается или спрашивает!
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
    {"type": "delete_person", "person_id": number}
  ],
  "response": "Ответ пользователю — кратко и дружелюбно"
}`;

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...parsed.data.history,
      { role: 'user', content: parsed.data.text },
    ];

    const result = await claude.chat(messages, systemPrompt, 'o3', false, true);

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
            const r = db.prepare('INSERT INTO tasks (project_id, title, description, status, priority, due_date) VALUES (?, ?, ?, ?, ?, ?)').run(
              action['project_id'] ?? null, action['title'], (action['description'] as string) ?? '', action['status'] ?? 'todo', action['priority'] ?? 3, action['due_date'] ?? null
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
            db.prepare('INSERT INTO projects (name, color) VALUES (?, ?)').run(action['name'], action['color'] ?? '#6366f1');
            results.push({ type: 'create_project', success: true, detail: `Проект "${action['name']}" создан` });
            break;
          }
          case 'create_idea': {
            const r = db.prepare('INSERT INTO ideas (title, body, category, project_id, status) VALUES (?, ?, ?, ?, ?)').run(
              action['title'], (action['body'] as string) ?? '', (action['category'] as string) ?? 'personal',
              action['project_id'] ?? null, 'backlog'
            );
            const ideaId = Number(r.lastInsertRowid);
            const projName = action['project_id'] ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(action['project_id'] as number) as { name: string } | undefined)?.name : null;
            results.push({ type: 'create_idea', success: true, detail: `Идея "${action['title']}"${projName ? ` → ${projName}` : ''} → Backlog` });
            void ideaId;
            break;
          }
          case 'create_goal': {
            db.prepare('INSERT INTO goals (title, description, type, project_id, target_value, unit) VALUES (?, ?, ?, ?, ?, ?)').run(
              action['title'], (action['description'] as string) ?? '', 'goal',
              action['project_id'] ?? null, action['target_value'] ?? 100, (action['unit'] as string) ?? '%'
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
            const r = db.prepare('INSERT INTO meetings (title, date, project_id, summary_raw) VALUES (?, ?, ?, ?)').run(action['title'], action['date'], action['project_id'] ?? null, '');
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
            const r = db.prepare('INSERT INTO people (name, company, role) VALUES (?, ?, ?)').run(action['name'], action['company'] ?? '', action['role'] ?? '');
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
          default:
            results.push({ type: String(action['type']), success: false, detail: 'Неизвестное действие' });
        }
      } catch (err) {
        results.push({ type: String(action['type']), success: false, detail: err instanceof Error ? err.message : 'Ошибка' });
      }
    }

    res.json(ok({ actions: command.actions, results, response: command.response }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'Voice command error'));
  }
});

aiRouter.get('/search', async (req: Request, res: Response) => {
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
