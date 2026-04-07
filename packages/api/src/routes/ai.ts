import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ClaudeService } from '../services/claude.service';
import { getDb } from '../db/db';
import { ok, fail } from '@pis/shared';

export const aiRouter = Router();
const claude = new ClaudeService();

const ChatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  context: z.string().optional(),
});

aiRouter.post('/chat', async (req: Request, res: Response) => {
  const parsed = ChatSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }
  try {
    const reply = await claude.chat(parsed.data.messages, parsed.data.context);
    res.json(ok({ reply }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

aiRouter.post('/daily-brief', async (_req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tasks = getDb().prepare("SELECT title, status, priority, urgency, due_date FROM tasks WHERE archived = 0 AND status != 'done' ORDER BY priority DESC LIMIT 20").all();
    const meetings = getDb().prepare('SELECT title, date FROM meetings WHERE date >= ? ORDER BY date ASC LIMIT 10').all(today);
    const brief = await claude.dailyBrief(JSON.stringify(tasks), JSON.stringify(meetings));
    res.json(ok({ brief }));
  } catch (err) {
    res.status(500).json(fail(err instanceof Error ? err.message : 'AI error'));
  }
});

// Voice command — parse natural language into action and execute
const VoiceCommandSchema = z.object({ text: z.string().min(1) });

aiRouter.post('/voice-command', async (req: Request, res: Response) => {
  const parsed = VoiceCommandSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(fail(parsed.error.message)); return; }

  try {
    const db = getDb();
    const projects = db.prepare('SELECT id, name FROM projects WHERE archived = 0').all() as Array<{ id: number; name: string }>;
    const tasks = db.prepare("SELECT id, title, status, project_id FROM tasks WHERE archived = 0").all() as Array<{ id: number; title: string; status: string; project_id: number | null }>;

    const systemPrompt = `Ты — голосовой ассистент таск-трекера. Пользователь диктует команды голосом.

Доступные проекты: ${JSON.stringify(projects.map(p => ({ id: p.id, name: p.name })))}
Доступные задачи: ${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, status: t.status, project_id: t.project_id })))}

Статусы задач: backlog, todo, in_progress, done, someday

Верни ТОЛЬКО JSON (без markdown) с массивом действий:
{
  "actions": [
    {
      "type": "create_task",
      "title": "string",
      "project_id": number | null,
      "status": "todo",
      "priority": 1-5,
      "description": ""
    },
    {
      "type": "move_task",
      "task_id": number,
      "status": "новый статус"
    },
    {
      "type": "delete_task",
      "task_id": number
    },
    {
      "type": "update_task",
      "task_id": number,
      "title": "string (опционально)",
      "priority": "number (опционально)",
      "due_date": "YYYY-MM-DD (опционально)",
      "project_id": "number (опционально)"
    },
    {
      "type": "create_project",
      "name": "string",
      "color": "#hex"
    }
  ],
  "response": "Краткий ответ пользователю о том, что сделано"
}

Если команда непонятна, верни пустой массив actions и в response напиши что не понял.
Сопоставляй названия задач/проектов нечётко (пользователь говорит голосом, могут быть неточности).`;

    const result = await claude.chat(
      [{ role: 'user', content: parsed.data.text }],
      systemPrompt,
      'gpt-4.1'
    );

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.json(ok({ actions: [], results: [], response: 'Не удалось распознать команду' }));
      return;
    }

    const command = JSON.parse(jsonMatch[0]) as {
      actions: Array<Record<string, unknown>>;
      response: string;
    };

    const results: Array<{ type: string; success: boolean; detail: string }> = [];

    for (const action of command.actions) {
      try {
        switch (action['type']) {
          case 'create_task': {
            const r = db.prepare('INSERT INTO tasks (project_id, title, description, status, priority) VALUES (?, ?, ?, ?, ?)').run(
              action['project_id'] ?? null,
              action['title'] as string,
              (action['description'] as string) ?? '',
              (action['status'] as string) ?? 'todo',
              (action['priority'] as number) ?? 3
            );
            results.push({ type: 'create_task', success: true, detail: `Задача "${action['title']}" создана (id: ${r.lastInsertRowid})` });
            break;
          }
          case 'move_task': {
            db.prepare("UPDATE tasks SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(
              action['status'] as string,
              action['task_id'] as number
            );
            results.push({ type: 'move_task', success: true, detail: `Задача #${action['task_id']} перемещена в ${action['status']}` });
            break;
          }
          case 'delete_task': {
            db.prepare("UPDATE tasks SET archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(
              action['task_id'] as number
            );
            results.push({ type: 'delete_task', success: true, detail: `Задача #${action['task_id']} удалена` });
            break;
          }
          case 'update_task': {
            const fields: string[] = [];
            const values: unknown[] = [];
            for (const key of ['title', 'priority', 'urgency', 'due_date', 'start_date', 'project_id', 'description']) {
              if (action[key] !== undefined) { fields.push(`${key} = ?`); values.push(action[key]); }
            }
            if (fields.length > 0) {
              db.prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, action['task_id'] as number);
            }
            results.push({ type: 'update_task', success: true, detail: `Задача #${action['task_id']} обновлена` });
            break;
          }
          case 'create_project': {
            const r = db.prepare('INSERT INTO projects (name, color) VALUES (?, ?)').run(
              action['name'] as string,
              (action['color'] as string) ?? '#6366f1'
            );
            results.push({ type: 'create_project', success: true, detail: `Проект "${action['name']}" создан (id: ${r.lastInsertRowid})` });
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
