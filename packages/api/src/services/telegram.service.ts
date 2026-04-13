import * as path from 'path';
import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from '../config';
import { getDb } from '../db/db';
import { IngestService } from './ingest.service';
import { ClaudeService } from './claude.service';
import OpenAI from 'openai';
import { moscowDateString, moscowDateTimeString } from '../utils/time';
import { generateBundle, findProjectByName } from './bundle.service';
import { generateAllFormats } from './converter.service';

export class TelegramService {
  private bot: Telegraf | null = null;
  private chatHistories = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>();
  private pendingLogins = new Map<number, 'email' | 'password'>(); // tg_id → waiting state
  private pendingEmails = new Map<number, string>(); // tg_id → email entered

  private getChatHistory(tgId: number): Array<{ role: 'user' | 'assistant'; content: string }> {
    if (!this.chatHistories.has(tgId)) this.chatHistories.set(tgId, []);
    return this.chatHistories.get(tgId)!;
  }

  /** Resolve internal user id from Telegram user id. Auto-creates account if not found. */
  private resolveUserId(tgId: number, tgName?: string): number | null {
    if (!tgId) return null;
    const db = getDb();
    const row = db.prepare("SELECT id FROM users WHERE tg_id = ?").get(String(tgId)) as { id: number } | undefined;
    if (row) return row.id;

    // Auto-create user from Telegram
    try {
      const name = tgName || `tg_${tgId}`;
      const bcrypt = require('bcryptjs');
      const randomPass = require('crypto').randomBytes(16).toString('hex');
      const hash = bcrypt.hashSync(randomPass, 10);
      const result = db.prepare('INSERT INTO users (email, password_hash, name, role, tg_id) VALUES (?, ?, ?, ?, ?)').run(
        `tg_${tgId}@telegram.local`, hash, name, 'user', String(tgId)
      );
      const newId = Number(result.lastInsertRowid);
      console.log(`[telegram] auto-created user #${newId} for tg_id ${tgId} (${name})`);
      return newId;
    } catch (err) {
      console.error('[telegram] auto-create user failed:', err);
      return null;
    }
  }

  /** Execute a command via AI — same as web voice commands */
  private async executeCommand(text: string, tgUserId?: number): Promise<{ text: string; files?: Array<{ path: string; filename: string }> }> {
    const db = getDb();
    const userId = tgUserId ? this.resolveUserId(tgUserId) : null;
    const userFilter = userId != null ? ' AND user_id = ?' : '';
    const userParams = userId != null ? [userId] : [];
    const claude = new ClaudeService();
    const projects = db.prepare(`SELECT id, name FROM projects WHERE archived = 0${userFilter}`).all(...userParams) as Array<{ id: number; name: string }>;
    const tasks = db.prepare(`SELECT id, title, status, project_id FROM tasks WHERE archived = 0${userFilter}`).all(...userParams) as Array<{ id: number; title: string; status: string; project_id: number | null }>;
    const people = db.prepare(`SELECT id, name FROM people WHERE 1=1${userFilter}`).all(...userParams) as Array<{ id: number; name: string }>;
    let goals: Array<{ id: number; title: string; type: string; parent_id: number | null; current_value: number; target_value: number; unit: string; status: string }> = [];
    try { goals = db.prepare(`SELECT id, title, type, parent_id, current_value, target_value, unit, status FROM goals WHERE status = 'active'${userFilter} ORDER BY type, parent_id`).all(...userParams) as typeof goals; } catch {}

    // Auto-detect if question is about meetings → include full content
    const meetingKeywords = /встреч|обсужд|говорил|сказал|рассказ|прошл|последн|протокол|стенограмм|робот|стартап|консультац|совещан/i;
    const needsFullMeetings = meetingKeywords.test(text);

    let meetings: Array<{ id: number; title: string; date: string; project_id: number | null; preview: string }>;
    let fullMeetingContent = '';

    if (needsFullMeetings) {
      // Fetch last 5 meetings with FULL content
      const fullMeetings = db.prepare(`SELECT id, title, date, project_id, summary_raw FROM meetings WHERE 1=1${userFilter} ORDER BY date DESC LIMIT 5`).all(...userParams) as Array<{ id: number; title: string; date: string; project_id: number | null; summary_raw: string }>;
      fullMeetingContent = fullMeetings.map(m =>
        `## Встреча #${m.id}: ${m.title} (${m.date})\n${(m.summary_raw || '').slice(0, 8000)}`
      ).join('\n\n---\n\n');
      meetings = fullMeetings.map(m => ({ id: m.id, title: m.title, date: m.date, project_id: m.project_id, preview: (m.summary_raw || '').slice(0, 200) }));
    } else {
      meetings = db.prepare(`SELECT id, title, date, project_id, substr(summary_raw, 1, 500) as preview FROM meetings WHERE 1=1${userFilter} ORDER BY date DESC LIMIT 20`).all(...userParams) as Array<{ id: number; title: string; date: string; project_id: number | null; preview: string }>;
    }

    const systemPrompt = `Ты — персональный ассистент пользователя в Telegram. Ты умный, дружелюбный, вдумчивый собеседник.

Ты подключён к таск-трекеру и Obsidian vault пользователя, но главное — ты можешь разговаривать на любые темы, советовать, обсуждать идеи, помогать думать. Ты эксперт во всём — бизнес, проекты, продуктивность, саморазвитие, технологии, жизнь.

ДАННЫЕ СИСТЕМЫ ПОЛЬЗОВАТЕЛЯ:
Проекты: ${JSON.stringify(projects.map(p => ({ id: p.id, name: p.name })))}
Задачи: ${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, status: t.status, project_id: t.project_id })))}
Встречи: ${JSON.stringify(meetings.map(m => ({ id: m.id, title: m.title, date: m.date, project_id: m.project_id, preview: (m.preview || '').slice(0, 200) })))}
Люди: ${JSON.stringify(people.map(p => ({ id: p.id, name: p.name })))}
Цели и ключевые результаты (OKR):
${goals.map(g => `  ${g.type === 'goal' ? '🎯' : '  📊'} #${g.id} ${g.title} (${g.current_value}/${g.target_value} ${g.unit})${g.parent_id ? ` [KR цели #${g.parent_id}]` : ''}`).join('\n')}

🚨 КРИТИЧЕСКИ ВАЖНО про цели и KR:
- Ключевые результаты (KR) — это НЕ задачи! Они в отдельной таблице goals.
- Чтобы обновить прогресс KR → action type="update_goal", goal_id=id этого KR, current_value=новое число
- НИКОГДА не используй update_task или move_task для KR
- Пример: если KR #2 "Провести партнёрскую сессию" нужно поставить 1% → {"type":"update_goal","goal_id":2,"current_value":1}
${fullMeetingContent ? `\n\n=== ПОЛНЫЕ ТРАНСКРИПЦИИ ПОСЛЕДНИХ ВСТРЕЧ ===\n${fullMeetingContent}\n=== КОНЕЦ ТРАНСКРИПЦИЙ ===\n\nОтвечай конкретно на основе содержимого транскрипций выше. Цитируй фрагменты когда уместно.` : ''}

ДОСТУП К OBSIDIAN VAULT через инструменты:
- search_vault(query) — быстрый поиск по сниппетам
- search_meetings_full(query) — найти встречи с ПОЛНЫМ содержимым транскрипций (используй когда спрашивают ЧТО ОБСУЖДАЛИ, ДЕТАЛИ встречи)
- get_entity_details(type, id) — полные данные задачи/встречи/проекта/человека (включая summary_raw для встреч)
- read_vault_file(path) — прочитать .md файл целиком
- list_vault_folder(folder) — список файлов в папке
- get_weather(city) — погода

🚨 КРИТИЧЕСКИ ВАЖНО про встречи:
- В контексте выше ты уже видишь список встреч с id и preview. Если тебя спрашивают о СОДЕРЖИМОМ встречи — ВСЕГДА вызывай get_entity_details(type='meeting', id=<id>) чтобы получить ПОЛНЫЙ текст summary_raw (там может быть 20000+ символов транскрипции).
- НИКОГДА не отвечай «у меня нет расшифровки» — данные есть в БД, ты ОБЯЗАН вызвать get_entity_details.
- Если пользователь упоминает тему (роботы, стартапы), а точного id не знает → search_meetings_full('тема').
- После получения полного содержимого — отвечай КОНКРЕТНО, цитируй фрагменты.
- Если preview в контексте показывает что-то релевантное — это лишь первые 500 символов, в реальной встрече гораздо больше.

Статусы задач: backlog, todo, in_progress, done, someday
Сейчас: ${moscowDateTimeString()}

КАК РАБОТАТЬ:
1. Если пользователь чётко даёт команду (создай, перенеси, удали, обнови, привяжи) → выполни через actions
2. Если пользователь СПРАШИВАЕТ («какая», «когда», «сколько», «что у меня», «покажи», «какой», «где») → ответь в поле response, actions пусты
3. Если нужны конкретные данные — используй инструменты (search_vault, list_vault_folder, get_entity_details)
4. Можно обсуждать идеи, давать советы, помогать думать
5. Отвечай на русском, содержательно, без канцелярита
6. Контекст предыдущих сообщений — используй для «её», «эту», «ту»
7. НЕ создавай встречи/задачи просто так — только когда явно просят

🚨 ЖЕЛЕЗНОЕ ПРАВИЛО про создание сущностей:
- Списки «Проекты», «Задачи», «Встречи», «Люди», «Цели» выше — это ПОЛНЫЙ список того, что есть у пользователя в БД прямо сейчас.
- Если в списке стоит [] (пустая скобка) — у пользователя НИЧЕГО не заведено.
- Если пользователь просит «создай проекты X, Y, Z» или «заведи задачи A, B, C» и этих названий НЕТ в списке выше — ТЫ ОБЯЗАН вернуть соответствующие create_* actions в массиве actions. По одной action на каждый объект.
- НИКОГДА не отвечай «проекты уже существуют», «создано ✅», «добавлено», если в actions не вернул соответствующий create_*. Иначе ты обманешь пользователя — в БД ничего не появится.
- Если название совпадает с уже существующим проектом/задачей из списка — не дублируй, но скажи об этом явно в response.
- Принцип: если в response пишешь «создал ✅ X» — в actions ОБЯЗАТЕЛЬНО должна быть соответствующая create_* запись.

ВАЖНО: Всегда отвечай в формате JSON с полями "actions" (массив) и "response" (строка).
Для вопросов actions = [], а ответ в response.

Верни ТОЛЬКО JSON (без markdown, без \`\`\`):
{
  "actions": [
    {"type": "create_task", "title": "string", "project_id": number|null, "status": "todo", "priority": 1-5, "due_date": "YYYY-MM-DD"|null, "person_ids": [number]},
    {"type": "move_task", "task_id": number, "status": "string"},
    {"type": "delete_task", "task_id": number},
    {"type": "update_task", "task_id": number, "title": "string?", "priority": number?, "due_date": "YYYY-MM-DD?", "project_id": number?, "person_ids": [number]?},
    {"type": "create_project", "name": "string", "color": "#hex"},
    {"type": "create_idea", "title": "string", "body": "string?", "project_id": number|null, "category": "business|product|personal|growth"},
    {"type": "create_habit", "title": "string", "icon": "emoji", "remind_time": "HH:MM или null"},
    {"type": "log_habit", "habit_title": "string (нечёткое совпадение)"},
    {"type": "create_bundle", "project_name": "string (название проекта или 'все')"},
    {"type": "create_goal", "title": "string", "description": "string?", "project_id": number|null, "target_value": number?, "unit": "string?", "due_date": "YYYY-MM-DD?"},
    {"type": "create_key_result", "parent_id": number, "title": "string", "target_value": number?, "unit": "string?"},
    {"type": "update_goal", "goal_id": number, "current_value": number?, "status": "active|completed?"},
    {"type": "create_meeting", "title": "string", "date": "YYYY-MM-DD", "project_id": number|null, "person_ids": [number], "summary_raw": "string?"},
    {"type": "update_meeting", "meeting_id": number, "title": "string?", "date": "YYYY-MM-DD?", "project_id": number?, "person_ids": [number]?, "summary_raw": "string?"},
    {"type": "delete_meeting", "meeting_id": number},
    {"type": "send_meeting", "meeting_id": number, "kind": "summary|full", "format": "md|pdf|docx"}
  ],
  "response": "Ответ пользователю — будь кратким и дружелюбным"
}

Про send_meeting:
- «пришли резюме встречи N» / «отправь полную транскрипцию» → используй send_meeting
- kind="summary" — AI-резюме (ключевые решения, задачи, следующие шаги)
- kind="full" — полный summary_raw
- format — по запросу пользователя: «в пдф» → pdf, «ворд»/«докс»/«docx» → docx, иначе → md`;

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...this.getChatHistory(tgUserId ?? 0).slice(-200), // last 100 exchanges
      { role: 'user', content: text },
    ];

    const model = 'gpt-4.1';

    const result = await claude.chat(messages, systemPrompt, model, true, true);

    let command: { actions: Array<Record<string, unknown>>; response: string };
    try {
      // JSON mode should return valid JSON directly
      command = JSON.parse(result) as { actions: Array<Record<string, unknown>>; response: string };
    } catch {
      // Fallback: extract JSON from text or use raw text as response
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { command = JSON.parse(jsonMatch[0]); }
        catch { command = { actions: [], response: result }; }
      } else {
        command = { actions: [], response: result };
      }
    }
    if (!command.response) command.response = '';
    const results: string[] = [];

    for (const action of command.actions) {
      try {
        switch (action['type']) {
          case 'create_task': {
            const r = db.prepare('INSERT INTO tasks (project_id, title, description, status, priority, due_date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
              action['project_id'] ?? null, action['title'], '', action['status'] ?? 'todo', action['priority'] ?? 3, action['due_date'] ?? null, userId
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
            const projName = action['project_id'] ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(action['project_id'] as number) as { name: string } | undefined)?.name : null;
            results.push(`✅ Задача "${action['title']}"${projName ? ` → ${projName}` : ''}`);
            break;
          }
          case 'move_task': {
            db.prepare("UPDATE tasks SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?").run(action['status'], action['task_id']);
            results.push(`✅ Задача #${action['task_id']} → ${action['status']}`);
            break;
          }
          case 'delete_task': {
            db.prepare("UPDATE tasks SET archived = 1 WHERE id = ?").run(action['task_id']);
            results.push(`🗑 Задача #${action['task_id']} удалена`);
            break;
          }
          case 'update_task': {
            const fields: string[] = [];
            const values: unknown[] = [];
            for (const key of ['title', 'priority', 'urgency', 'due_date', 'project_id']) {
              if (action[key] !== undefined) { fields.push(`${key} = ?`); values.push(action[key]); }
            }
            if (fields.length > 0) {
              db.prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(...values, action['task_id']);
            }
            results.push(`✅ Задача #${action['task_id']} обновлена`);
            break;
          }
          case 'create_project': {
            db.prepare('INSERT INTO projects (name, color, user_id) VALUES (?, ?, ?)').run(action['name'], action['color'] ?? '#6366f1', userId);
            results.push(`✅ Проект "${action['name']}"`);
            break;
          }
          case 'create_idea': {
            db.prepare('INSERT INTO ideas (title, body, category, project_id, status, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(
              action['title'], (action['body'] as string) ?? '', (action['category'] as string) ?? 'personal',
              action['project_id'] ?? null, 'backlog', userId
            );
            const projName = action['project_id'] ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(action['project_id'] as number) as { name: string } | undefined)?.name : null;
            results.push(`💡 Идея "${action['title']}"${projName ? ` → ${projName}` : ''} → Backlog`);
            break;
          }
          case 'create_habit': {
            db.prepare('INSERT INTO habits (title, icon, remind_time, user_id) VALUES (?, ?, ?, ?)').run(
              action['title'], (action['icon'] as string) ?? '✅', action['remind_time'] ?? null, userId
            );
            results.push(`🔥 Привычка "${action['title']}" создана${action['remind_time'] ? ` (⏰ ${action['remind_time']})` : ''}`);
            break;
          }
          case 'log_habit': {
            const title = (action['habit_title'] as string).toLowerCase();
            const habit = db.prepare(`SELECT id, title FROM habits WHERE archived = 0${userFilter}`).all(...userParams) as Array<{ id: number; title: string }>;
            const match = habit.find(h => h.title.toLowerCase().includes(title) || title.includes(h.title.toLowerCase()));
            if (match) {
              const today = moscowDateString();
              const existing = db.prepare("SELECT id FROM habit_logs WHERE habit_id = ? AND date = ?").get(match.id, today);
              if (existing) {
                results.push(`✅ "${match.title}" уже отмечена сегодня`);
              } else {
                db.prepare("INSERT INTO habit_logs (habit_id, date) VALUES (?, ?)").run(match.id, today);
                results.push(`✅ "${match.title}" отмечена!`);
              }
            } else {
              results.push(`❌ Привычка "${action['habit_title']}" не найдена`);
            }
            break;
          }
          case 'create_goal': {
            const r = db.prepare('INSERT INTO goals (title, description, type, project_id, target_value, unit, due_date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
              action['title'], (action['description'] as string) ?? '', 'goal',
              action['project_id'] ?? null, action['target_value'] ?? 100, (action['unit'] as string) ?? '%', action['due_date'] ?? null, userId
            );
            results.push(`🎯 Цель "${action['title']}" создана`);
            break;
          }
          case 'create_key_result': {
            db.prepare('INSERT INTO goals (title, type, parent_id, target_value, unit, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(
              action['title'], 'key_result', action['parent_id'], action['target_value'] ?? 100, (action['unit'] as string) ?? '%', userId
            );
            results.push(`📊 KR "${action['title']}" добавлен`);
            break;
          }
          case 'update_goal': {
            const fields: string[] = [];
            const values: unknown[] = [];
            if (action['current_value'] !== undefined) { fields.push('current_value = ?'); values.push(action['current_value']); }
            if (action['status'] !== undefined) { fields.push('status = ?'); values.push(action['status']); }
            if (fields.length > 0) {
              db.prepare(`UPDATE goals SET ${fields.join(', ')} WHERE id = ?`).run(...values, action['goal_id']);
            }
            results.push(`🎯 Цель #${action['goal_id']} обновлена`);
            break;
          }
          case 'create_bundle': {
            const pname = (action['project_name'] as string) ?? 'все';
            const match = findProjectByName(pname);
            if (match === null) {
              results.push(`❌ Проект "${pname}" не найден`);
            } else {
              const r = generateBundle(match);
              const fullPath = path.join(config.vaultPath, r.vaultPath);
              // Generate all formats
              const formats = generateAllFormats(fullPath);
              // Store all files for sending
              const files: Array<{ path: string; filename: string }> = [];
              if (formats.pdf) files.push({ path: formats.pdf, filename: r.filename.replace('.md', '.pdf') });
              if (formats.docx) files.push({ path: formats.docx, filename: r.filename.replace('.md', '.docx') });
              files.push({ path: fullPath, filename: r.filename });
              (command as Record<string, unknown>)['_files'] = files;
              results.push(`📦 Bundle: ${r.filename.replace('.md', '')} (${r.sizeKb} KB) → PDF + DOCX + MD`);
            }
            break;
          }
          case 'create_meeting': {
            const summary = (action['summary_raw'] as string) ?? '';
            const r = db.prepare('INSERT INTO meetings (title, date, project_id, summary_raw, user_id) VALUES (?, ?, ?, ?, ?)').run(
              action['title'], action['date'], action['project_id'] ?? null, summary, userId
            );
            const meetingId = Number(r.lastInsertRowid);
            if (Array.isArray(action['person_ids'])) {
              for (const pid of action['person_ids'] as number[]) {
                db.prepare('INSERT OR IGNORE INTO meeting_people (meeting_id, person_id) VALUES (?, ?)').run(meetingId, pid);
              }
            }
            const projName = action['project_id'] ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(action['project_id'] as number) as { name: string } | undefined)?.name : null;
            results.push(`✅ Встреча "${action['title']}" на ${action['date']}${projName ? ` [${projName}]` : ''}`);
            break;
          }
          case 'update_meeting': {
            const fields: string[] = [];
            const values: unknown[] = [];
            for (const key of ['title', 'date', 'project_id', 'summary_raw']) {
              if (action[key] !== undefined) { fields.push(`${key} = ?`); values.push(action[key]); }
            }
            if (fields.length > 0) {
              db.prepare(`UPDATE meetings SET ${fields.join(', ')} WHERE id = ?`).run(...values, action['meeting_id']);
            }
            if (Array.isArray(action['person_ids'])) {
              db.prepare('DELETE FROM meeting_people WHERE meeting_id = ?').run(action['meeting_id']);
              for (const pid of action['person_ids'] as number[]) {
                db.prepare('INSERT OR IGNORE INTO meeting_people (meeting_id, person_id) VALUES (?, ?)').run(action['meeting_id'], pid);
              }
            }
            results.push(`✅ Встреча #${action['meeting_id']} обновлена`);
            break;
          }
          case 'delete_meeting': {
            db.prepare('DELETE FROM meeting_people WHERE meeting_id = ?').run(action['meeting_id']);
            db.prepare('DELETE FROM meetings WHERE id = ?').run(action['meeting_id']);
            results.push(`🗑 Встреча #${action['meeting_id']} удалена`);
            break;
          }
          case 'send_meeting': {
            if (userId == null) { results.push('❌ Не авторизован'); break; }
            const mid = Number(action['meeting_id']);
            const kind = (action['kind'] === 'full' ? 'full' : 'summary') as 'summary' | 'full';
            const format = (['md', 'pdf', 'docx'].includes(String(action['format'])) ? action['format'] : 'pdf') as 'md' | 'pdf' | 'docx';
            const { sendMeetingToTelegram } = require('../routes/meetings');
            try {
              await sendMeetingToTelegram(mid, userId, kind, format);
              results.push(`📤 ${kind === 'summary' ? 'Резюме' : 'Полная транскрипция'} встречи #${mid} отправлена (${format.toUpperCase()})`);
            } catch (err) {
              results.push(`❌ Не смог отправить встречу #${mid}: ${err instanceof Error ? err.message : 'ошибка'}`);
            }
            break;
          }
        }
      } catch (err) {
        results.push(`❌ ${err instanceof Error ? err.message : 'Ошибка'}`);
      }
    }

    // Log actions for debugging
    if (command.actions.length > 0) {
      console.log(`[bot] actions: ${JSON.stringify(command.actions.map(a => ({ type: a['type'], ...a })))}`);
    }

    const responseText = command.response + (results.length > 0 ? '\n\n' + results.join('\n') : '');

    // Save to history (per-user)
    const history = this.getChatHistory(tgUserId ?? 0);
    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: responseText });
    if (history.length > 200) history.splice(0, history.length - 200);

    // Check if there are files to send (bundle etc)
    const files = (command as Record<string, unknown>)['_files'] as Array<{ path: string; filename: string }> | undefined;

    return { text: responseText, files };
  }

  /** Classify message — chat/command vs ingest (for long content) */
  private async classifyMessage(text: string, tgUserId?: number): Promise<'command' | 'ingest' | 'chat'> {
    // Ingest signals: explicit meeting/transcription content
    const ingestPatterns = /^(стенограмма|транскрип|запись встречи|текст встречи|протокол|заметки со встречи)/i;
    if (ingestPatterns.test(text.trim())) return 'ingest';
    // Very long text without context → probably content (e.g. pasted transcript)
    if (text.length > 500 && this.getChatHistory(tgUserId ?? 0).length === 0) return 'ingest';
    // Everything else → chat/command routing through AI
    return 'command';
  }

  /** Transcribe audio via Whisper API */
  /** Transcribe audio — tries local whisper.cpp first (free), falls back to OpenAI API */
  private async transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
    // Try local whisper.cpp first (FREE)
    try {
      const { isLocalWhisperAvailable, transcribeLocal } = require('./whisper-local.service');
      if (isLocalWhisperAvailable()) {
        console.log('[whisper] using local whisper.cpp');
        return transcribeLocal(buffer, filename);
      }
    } catch (err) {
      console.warn('[whisper] local failed, falling back to OpenAI:', err instanceof Error ? err.message : err);
    }

    // Fallback to OpenAI Whisper API ($$$)
    console.log('[whisper] using OpenAI API');
    const openai = new OpenAI({ apiKey: config.openaiApiKey });
    const file = new File([buffer], filename, { type: 'audio/ogg' });
    const result = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: 'ru',
    });
    return result.text;
  }

  start(): void {
    if (!config.telegramBotToken) {
      console.log('[telegram] no token, bot disabled');
      return;
    }

    this.bot = new Telegraf(config.telegramBotToken);

    this.bot.catch((err: unknown) => {
      console.error('[telegram] bot error:', err instanceof Error ? err.message : err);
    });

    // /start
    this.bot.command('start', (ctx) => {
      const tgId = ctx.from?.id ?? 0;
      const db = getDb();
      const existing = db.prepare("SELECT id, name FROM users WHERE tg_id = ?").get(String(tgId)) as { id: number; name: string } | undefined;

      if (existing) {
        // Already linked — show welcome
        const text =
          `🚀 Привет, ${existing.name}!\n\n` +
          '📋 Команды:\n' +
          '/tasks — активные задачи\n' +
          '/meetings — последние встречи\n' +
          '/habits — привычки\n' +
          '/add <название> — быстро добавить задачу\n' +
          '/brief — дневной брифинг\n' +
          '/search <запрос> — поиск\n\n' +
          '🧠 Или просто напиши — я пойму!';

        if (config.webappUrl) {
          ctx.reply(text, Markup.inlineKeyboard([
            Markup.button.webApp('📱 Открыть приложение', config.webappUrl),
          ]));
        } else {
          ctx.reply(text);
        }
      } else {
        // Not linked — offer choice
        ctx.reply(
          '👋 Добро пожаловать в PIS!\n\nВыбери вариант:',
          Markup.inlineKeyboard([
            [Markup.button.callback('🆕 Новый аккаунт', 'onboard_new')],
            [Markup.button.callback('🔑 У меня есть аккаунт', 'onboard_login')],
          ])
        );
      }
    });

    // Callback: new account
    this.bot.action('onboard_new', (ctx) => {
      const tgId = ctx.from?.id ?? 0;
      const tgName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username || `tg_${tgId}`;
      this.resolveUserId(tgId, tgName); // auto-creates
      ctx.editMessageText(`✅ Аккаунт создан!\n\n👤 Имя: ${tgName}\n\nТеперь можешь пользоваться — просто напиши что нужно.`);
    });

    // Callback: existing account → ask email
    this.bot.action('onboard_login', (ctx) => {
      const tgId = ctx.from?.id ?? 0;
      this.pendingLogins.set(tgId, 'email');
      ctx.editMessageText('📧 Введи email, на который регистрировался:');
    });

    // /app — open Mini App
    this.bot.command('app', (ctx) => {
      if (!config.webappUrl) {
        ctx.reply('⚠️ URL приложения не настроен (WEBAPP_URL)');
        return;
      }
      ctx.reply('📱 Открыть приложение:', Markup.inlineKeyboard([
        Markup.button.webApp('Открыть', config.webappUrl),
      ]));
    });

    // /login email password — link Telegram to web account via credentials
    this.bot.command('login', (ctx) => {
      const parts = ctx.message.text.replace(/^\/login\s*/, '').trim().split(/\s+/);
      const email = (parts[0] || '').toLowerCase();
      const password = parts[1] || '';
      if (!email || !password) {
        ctx.reply('Формат: /login email пароль\n\nПример: /login alex@mail.com 123456\n\nПривяжет Telegram к аккаунту на сайте. Все данные подтянутся автоматически.');
        return;
      }
      const db = getDb();
      const tgId = String(ctx.from?.id ?? '');
      const existingUser = db.prepare('SELECT id, name, email, password_hash, tg_id FROM users WHERE email = ?').get(email) as { id: number; name: string; email: string; password_hash: string; tg_id: string | null } | undefined;
      if (!existingUser) {
        ctx.reply(`❌ Аккаунт с email ${email} не найден.`);
        return;
      }
      const bcrypt = require('bcryptjs');
      if (!bcrypt.compareSync(password, existingUser.password_hash)) {
        ctx.reply('❌ Неверный пароль.');
        return;
      }
      // Remove auto-created tg account if exists and merge data
      const autoAccount = db.prepare("SELECT id FROM users WHERE tg_id = ? AND email LIKE '%@telegram.local'").get(tgId) as { id: number } | undefined;
      if (autoAccount && autoAccount.id !== existingUser.id) {
        for (const table of ['tasks', 'projects', 'meetings', 'people', 'ideas', 'documents', 'habits', 'goals', 'journal']) {
          try { db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`).run(existingUser.id, autoAccount.id); } catch {}
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(autoAccount.id);
      }
      db.prepare('UPDATE users SET tg_id = ? WHERE id = ?').run(tgId, existingUser.id);
      ctx.reply(`✅ Готово! Telegram привязан к ${existingUser.name} (${existingUser.email}).\n\nВсе данные подтянулись. Можешь пользоваться!`);
      // Delete the message with password for security
      try { ctx.deleteMessage(ctx.message.message_id); } catch {}
    });

    // /cmd — execute command via AI
    this.bot.command('cmd', async (ctx) => {
      const text = ctx.message.text.replace(/^\/cmd\s*/, '').trim();
      if (!text) { ctx.reply('Формат: /cmd создай задачу купить молоко'); return; }
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      try {
        const response = await this.executeCommand(text, ctx.from?.id);
          await sendCommandResult(ctx, response);
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // /meetings — list recent meetings
    // /bundle — generate NotebookLM bundle for project
    // /bundle — generate and SEND bundle in all formats
    this.bot.command('bundle', async (ctx) => {
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const text = ctx.message.text.replace(/^\/bundle\s*/, '').trim();
      if (!text) {
        ctx.reply('Формат:\n/bundle <название проекта>\n/bundle все\n\nПримеры:\n/bundle Атланты\n/bundle Robots\n\nОтправлю файлы: PDF, DOCX, MD');
        return;
      }
      try {
        ctx.reply('📦 Собираю bundle и конвертирую...');
        const match = findProjectByName(text);
        if (match === null) {
          ctx.reply(`❌ Проект "${text}" не найден`);
          return;
        }
        const result = generateBundle(match);
        const fullPath = path.join(config.vaultPath, result.vaultPath);

        // Generate all formats
        const formats = generateAllFormats(fullPath);

        const caption = `📦 ${result.filename.replace('.md', '')}\n📊 Встреч: ${result.sections.meetings} | Задач: ${result.sections.tasks} | Идей: ${result.sections.ideas}`;

        // Send PDF first (for NotebookLM)
        if (formats.pdf) {
          try {
            await ctx.replyWithDocument(
              { source: formats.pdf, filename: result.filename.replace('.md', '.pdf') },
              { caption: `${caption}\n\n📱 PDF → загрузи в NotebookLM` }
            );
          } catch {}
        }

        // Send DOCX
        if (formats.docx) {
          try {
            await ctx.replyWithDocument(
              { source: formats.docx, filename: result.filename.replace('.md', '.docx') },
              { caption: '📄 DOCX — для Word/Google Docs' }
            );
          } catch {}
        }

        // Send original MD
        try {
          await ctx.replyWithDocument(
            { source: fullPath, filename: result.filename },
            { caption: '📝 MD — исходник для Obsidian' }
          );
        } catch {}

        // Send TXT as backup
        if (formats.txt) {
          try {
            await ctx.replyWithDocument(
              { source: formats.txt, filename: result.filename.replace('.md', '.txt') },
              { caption: '📋 TXT — Copied text для NotebookLM' }
            );
          } catch {}
        }

      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    });

    // /transcribe <url> — download and transcribe large audio from URL
    this.bot.command('transcribe', async (ctx) => {
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const url = ctx.message.text.replace(/^\/transcribe\s*/, '').trim();
      if (!url) { ctx.reply('Формат: /transcribe <ссылка на аудио>\n\nЗалей файл в Google Drive/Яндекс Диск, сделай публичную ссылку и отправь.'); return; }
      try {
        ctx.reply('⬇️ Скачиваю файл...');
        const tmpFile = `/tmp/tg-download-${Date.now()}.mp3`;
        const downloadRes = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300000) });
        if (!downloadRes.ok) throw new Error(`Download failed: ${downloadRes.status}`);
        const buffer_dl = Buffer.from(await downloadRes.arrayBuffer());
        require('fs').writeFileSync(tmpFile, buffer_dl);

        const stats = require('fs').statSync(tmpFile);
        ctx.reply(`✅ Скачано (${Math.round(stats.size / 1024 / 1024)} MB). 🎤 Транскрибирую... (может занять 15-60 мин для длинных записей)`);

        const { transcribeLocal, isLocalWhisperAvailable } = require('./whisper-local.service');
        const buffer = require('fs').readFileSync(tmpFile);
        let transcript: string;

        if (isLocalWhisperAvailable()) {
          transcript = transcribeLocal(buffer, 'download.mp3');
        } else {
          const openai = new OpenAI({ apiKey: config.openaiApiKey });
          const file = new File([buffer], 'audio.mp3', { type: 'audio/mpeg' });
          const result = await openai.audio.transcriptions.create({ model: 'whisper-1', file, language: 'ru' });
          transcript = result.text;
        }

        // Cleanup
        try { require('fs').unlinkSync(tmpFile); } catch {}

        if (!transcript.trim()) { ctx.reply('⚠️ Не удалось распознать речь'); return; }

        await sendLong(ctx, `📝 Транскрипция (${transcript.length} символов):\n${transcript.slice(0, 3500)}`);

        // Ingest as meeting
        const ingestService = new IngestService();
        const result = await ingestService.ingestText(transcript);
        await sendLong(ctx, formatIngestResult(result));
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    });

    // /habits — today's habits
    this.bot.command('habits', (ctx) => {
      const db = getDb();
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const habits = db.prepare("SELECT id, title, icon FROM habits WHERE archived = 0 AND user_id = ?").all(userId) as Array<{ id: number; title: string; icon: string }>;
      if (habits.length === 0) { ctx.reply('🔥 Нет привычек. Добавь в /app → Привычки'); return; }
      const today = moscowDateString();
      const logs = db.prepare("SELECT habit_id FROM habit_logs WHERE date = ?").all(today) as Array<{ habit_id: number }>;
      const doneSet = new Set(logs.map(l => l.habit_id));
      const lines = habits.map(h => `${doneSet.has(h.id) ? '✅' : '⬜'} ${h.icon} ${h.title}`);
      ctx.reply(`🔥 Привычки (${doneSet.size}/${habits.length}):\n\n${lines.join('\n')}\n\nОтметить: "отметь привычку Медитация"`);
    });

    this.bot.command('meetings', (ctx) => {
      const db = getDb();
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const meetings = db.prepare("SELECT m.title, m.date, p.name as project_name FROM meetings m LEFT JOIN projects p ON m.project_id = p.id WHERE m.user_id = ? ORDER BY m.date DESC LIMIT 10").all(userId) as Array<{ title: string; date: string; project_name: string | null }>;
      if (meetings.length === 0) { ctx.reply('Нет встреч'); return; }
      const lines = meetings.map(m => `📅 ${m.date} — ${m.title}${m.project_name ? ` [${m.project_name}]` : ''}`);
      ctx.reply(`🤝 Последние встречи:\n\n${lines.join('\n')}`);
    });

    // /tasks — today's tasks
    this.bot.command('tasks', (ctx) => {
      const db = getDb();
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const tasks = db.prepare(
        "SELECT title, status, priority, due_date, project_id FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND user_id = ? ORDER BY priority DESC LIMIT 20"
      ).all(userId) as Array<{ title: string; status: string; priority: number; due_date: string | null; project_id: number | null }>;

      if (tasks.length === 0) {
        ctx.reply('Нет активных задач!');
        return;
      }

      const projectMap = new Map(
        (db.prepare('SELECT id, name FROM projects').all() as Array<{ id: number; name: string }>).map(p => [p.id, p.name])
      );

      const lines = tasks.map((t) => {
        const status = t.status === 'done' ? '✅' : t.status === 'in_progress' ? '🔄' : '📋';
        const priority = '⭐'.repeat(Math.min(t.priority, 5));
        const project = t.project_id ? `[${projectMap.get(t.project_id) ?? '?'}]` : '';
        const due = t.due_date ? ` 📅${t.due_date}` : '';
        return `${status} ${t.title} ${project}${due}\n   ${priority}`;
      });

      ctx.reply(`📋 Активные задачи:\n\n${lines.join('\n\n')}`);
    });

    // /all — all tasks grouped by status
    this.bot.command('all', (ctx) => {
      const db = getDb();
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const tasks = db.prepare(
        "SELECT title, status, priority FROM tasks WHERE archived = 0 AND user_id = ? ORDER BY status, priority DESC"
      ).all(userId) as Array<{ title: string; status: string; priority: number }>;

      const grouped: Record<string, string[]> = {};
      for (const t of tasks) {
        if (!grouped[t.status]) grouped[t.status] = [];
        grouped[t.status]!.push(`  • ${t.title} ${'⭐'.repeat(t.priority)}`);
      }

      const statusLabels: Record<string, string> = {
        backlog: '📥 Бэклог', todo: '📋 К выполнению', in_progress: '🔄 В работе',
        done: '✅ Готово', someday: '🔮 Когда-нибудь'
      };

      const text = Object.entries(grouped)
        .map(([status, items]) => `${statusLabels[status] ?? status}\n${items.join('\n')}`)
        .join('\n\n');

      ctx.reply(text || 'Нет задач');
    });

    // /projects
    this.bot.command('projects', (ctx) => {
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const projects = getDb().prepare(
        "SELECT name, status, color FROM projects WHERE archived = 0 AND user_id = ? ORDER BY order_index ASC"
      ).all(userId) as Array<{ name: string; status: string }>;

      const lines = projects.map(p => `• ${p.name} (${p.status})`);
      ctx.reply(`📁 Проекты:\n\n${lines.join('\n')}` || 'Нет проектов');
    });

    // /add <title> — quick add task
    this.bot.command('add', (ctx) => {
      const text = ctx.message.text.replace(/^\/add\s*/, '').trim();
      if (!text) { ctx.reply('Формат: /add Название задачи'); return; }
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId

      const r = getDb().prepare('INSERT INTO tasks (title, status, priority, user_id) VALUES (?, ?, ?, ?)').run(text, 'todo', 3, userId);
      const tid = Number(r.lastInsertRowid);
      const selfRow = getDb().prepare("SELECT id FROM people WHERE LOWER(name) IN ('я','me','self') LIMIT 1").get() as { id: number } | undefined;
      if (selfRow) getDb().prepare('INSERT OR IGNORE INTO task_people (task_id, person_id) VALUES (?, ?)').run(tid, selfRow.id);
      ctx.reply(`✅ Задача добавлена: ${text}`);
    });

    // /brief — daily brief
    this.bot.command('brief', async (ctx) => {
      const db = getDb();
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const today = moscowDateString();
      const tasks = db.prepare(
        "SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND user_id = ? ORDER BY priority DESC LIMIT 10"
      ).all(userId);
      const meetings = db.prepare(
        'SELECT title, date FROM meetings WHERE date >= ? AND user_id = ? ORDER BY date ASC LIMIT 5'
      ).all(today, userId);

      let brief = '🌅 Дневной брифинг\n\n';
      brief += `📋 Активных задач: ${(tasks as Array<unknown>).length}\n`;
      brief += `📅 Предстоящих встреч: ${(meetings as Array<unknown>).length}\n\n`;

      if ((tasks as Array<{ title: string }>).length > 0) {
        brief += 'Приоритетные задачи:\n';
        for (const t of tasks as Array<{ title: string; priority: number }>) {
          brief += `  • ${t.title} ${'⭐'.repeat(t.priority)}\n`;
        }
      }

      ctx.reply(brief);
    });

    // /search <query>
    this.bot.command('search', (ctx) => {
      const query = ctx.message.text.replace(/^\/search\s*/, '').trim();
      if (!query) { ctx.reply('Формат: /search ключевое слово'); return; }
      const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { searchService } = require('./search.service');
      const results = searchService.search(query, 10);
      if (results.length === 0) { ctx.reply('Ничего не найдено'); return; }

      const lines = results.map((r: { type: string; title: string }) => `[${r.type}] ${r.title}`);
      ctx.reply(`🔍 Результаты:\n\n${lines.join('\n')}`);
    });

    // Send executeCommand result — text + optional file
    const sendCommandResult = async (ctx: { reply: (text: string) => Promise<unknown>; replyWithDocument: (doc: { source: string; filename: string }, opts?: Record<string, unknown>) => Promise<unknown> }, result: { text: string; files?: Array<{ path: string; filename: string }> }): Promise<void> => {
      await sendLong(ctx, result.text);
      if (result.files) {
        for (const f of result.files) {
          try {
            await ctx.replyWithDocument(
              { source: f.path, filename: f.filename },
              { caption: f.filename.endsWith('.pdf') ? '📱 PDF → загрузи в NotebookLM' : f.filename.endsWith('.docx') ? '📄 DOCX' : '📝 MD' }
            );
          } catch {}
        }
      }
    };

    // Split long message into chunks for Telegram (max 4096 chars)
    const sendLong = async (ctx: { reply: (text: string) => Promise<unknown> }, text: string): Promise<void> => {
      const CHUNK = 4000;
      if (text.length <= CHUNK) { await ctx.reply(text); return; }
      for (let i = 0; i < text.length; i += CHUNK) {
        await ctx.reply(text.slice(i, i + CHUNK));
      }
    };

    // Format ingest result nicely (compact version for Telegram 4096 limit)
    const formatIngestResult = (result: { detected_type: string; summary: string; created_records: Array<{ type: string; id: number; title: string }> }): string => {
      const typeLabels: Record<string, string> = { meeting: '🤝 Встреча', task: '📋 Задача', idea: '💡 Идея', inbox: '📥 Входящее' };
      const label = typeLabels[result.detected_type] ?? result.detected_type;

      // Count tasks separately from main record
      const mainRec = result.created_records?.[0];
      const extraTasks = result.created_records?.filter((_, i) => i > 0 && result.created_records[i]!.type === 'task') ?? [];

      let msg = `${label}`;
      if (mainRec) {
        msg += ` #${mainRec.id}\n**${mainRec.title}**`;

        // Show linked project/people for meeting
        if (mainRec.type === 'meeting') {
          const db = getDb();
          const m = db.prepare('SELECT project_id FROM meetings WHERE id = ?').get(mainRec.id) as { project_id: number | null } | undefined;
          if (m?.project_id) {
            const p = db.prepare('SELECT name FROM projects WHERE id = ?').get(m.project_id) as { name: string } | undefined;
            if (p) msg += `\n📁 Проект: ${p.name}`;
          }
          const people = db.prepare('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(mainRec.id) as Array<{ name: string }>;
          if (people.length > 0) msg += `\n👥 ${people.map(p => p.name).join(', ')}`;
        }
      }

      if (extraTasks.length > 0) {
        msg += `\n\n✅ Создано ${extraTasks.length} задач в Backlog`;
      }

      // Short summary (first 2000 chars max)
      const shortSummary = result.summary.length > 2000 ? result.summary.slice(0, 2000) + '...' : result.summary;
      msg += `\n\n${shortSummary}`;

      return msg;
    };

    // Any text message → smart routing
    this.bot.on(message('text'), async (ctx) => {
      const text = ctx.message.text;
      if (text.startsWith('/')) return;

      const tgId = ctx.from?.id ?? 0;

      // Handle login flow (email → password)
      const loginState = this.pendingLogins.get(tgId);
      if (loginState === 'email') {
        const email = text.trim().toLowerCase();
        if (!email.includes('@')) { ctx.reply('❌ Введи корректный email:'); return; }
        const db = getDb();
        const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined;
        if (!user) { ctx.reply(`❌ Аккаунт ${email} не найден. Попробуй ещё раз или нажми /start`); this.pendingLogins.delete(tgId); return; }
        this.pendingEmails.set(tgId, email);
        this.pendingLogins.set(tgId, 'password');
        ctx.reply('🔑 Теперь введи пароль:');
        return;
      }
      if (loginState === 'password') {
        const email = this.pendingEmails.get(tgId) ?? '';
        this.pendingLogins.delete(tgId);
        this.pendingEmails.delete(tgId);
        const db = getDb();
        const user = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email) as { id: number; name: string; email: string; password_hash: string } | undefined;
        if (!user) { ctx.reply('❌ Ошибка. Нажми /start'); return; }
        const bcrypt = require('bcryptjs');
        if (!bcrypt.compareSync(text, user.password_hash)) { ctx.reply('❌ Неверный пароль. Нажми /start чтобы попробовать снова.'); return; }
        // Link tg_id and merge auto-account if exists
        const autoAccount = db.prepare("SELECT id FROM users WHERE tg_id = ? AND email LIKE '%@telegram.local'").get(String(tgId)) as { id: number } | undefined;
        if (autoAccount && autoAccount.id !== user.id) {
          for (const table of ['tasks', 'projects', 'meetings', 'people', 'ideas', 'documents', 'habits', 'goals', 'journal']) {
            try { db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`).run(user.id, autoAccount.id); } catch {}
          }
          db.prepare('DELETE FROM users WHERE id = ?').run(autoAccount.id);
        }
        db.prepare('UPDATE users SET tg_id = ? WHERE id = ?').run(String(tgId), user.id);
        // Delete password message
        try { ctx.deleteMessage(ctx.message.message_id); } catch {}
        ctx.reply(`✅ Готово! Привет, ${user.name}!\n\nТвой аккаунт привязан. Все данные подтянулись.\n\nПросто пиши — я пойму!`);
        return;
      }

      const userId = this.resolveUserId(tgId, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId

      // Check for claude/клод prefix → save for Claude Code processing
      const claudeMatch = text.match(/^(клод|claude)[:\s,-]+([\s\S]+)$/i);
      if (claudeMatch) {
        const content = claudeMatch[2].trim();
        getDb().prepare('INSERT INTO claude_notes (content, source) VALUES (?, ?)').run(content, 'telegram');
        const pending = (getDb().prepare('SELECT COUNT(*) as c FROM claude_notes WHERE processed = 0').get() as { c: number }).c;
        ctx.reply(`📝 Заметка сохранена для Claude Code\n📬 В очереди: ${pending}\n\nСкажи мне в Claude Code "обработай заметки" — разложу всё по Obsidian`);
        return;
      }

      try {
        const intent = await this.classifyMessage(text, ctx.from?.id);
        if (intent === 'command' || intent === 'chat') {
          const response = await this.executeCommand(text, ctx.from?.id);
          await sendCommandResult(ctx, response);
        } else {
          const ingestService = new IngestService();
          const result = await ingestService.ingestText(text);
          await sendLong(ctx, formatIngestResult(result));
        }
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Voice message → transcribe first, then decide
    this.bot.on(message('voice'), async (ctx) => {
      try {
        const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        // userId auto-created by resolveUserId

        ctx.reply('🎤 Транскрибирую...');
        const fileId = ctx.message.voice.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const response = await fetch(fileLink.href);
        const buffer = Buffer.from(await response.arrayBuffer());

        // Transcribe via Whisper
        const transcript = await this.transcribeAudio(buffer, 'voice.ogg');
        if (!transcript.trim()) { ctx.reply('⚠️ Не удалось распознать речь'); return; }

        // Show transcript
        ctx.reply(`📝 Распознано:\n${transcript}`);

        // Check for claude/клод prefix in voice
        const claudeMatch = transcript.match(/^(клод|claude)[:\s,-]+([\s\S]+)$/i);
        if (claudeMatch) {
          const content = claudeMatch[2].trim();
          getDb().prepare('INSERT INTO claude_notes (content, source) VALUES (?, ?)').run(content, 'telegram-voice');
          const pending = (getDb().prepare('SELECT COUNT(*) as c FROM claude_notes WHERE processed = 0').get() as { c: number }).c;
          ctx.reply(`📝 Заметка сохранена для Claude Code\n📬 В очереди: ${pending}`);
          return;
        }

        // Route: short = command, long = ingest as meeting
        const intent = await this.classifyMessage(transcript, ctx.from?.id);
        if (intent === 'command' || intent === 'chat') {
          const cmdResponse = await this.executeCommand(transcript, ctx.from?.id);
            await sendCommandResult(ctx, cmdResponse);
        } else {
          const ingestService = new IngestService();
          const result = await ingestService.ingestText(transcript);
          await sendLong(ctx, formatIngestResult(result));
        }
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Document → check if audio, transcribe; otherwise ingest
    this.bot.on(message('document'), async (ctx) => {
      try {
        const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        // userId auto-created by resolveUserId
        const doc = ctx.message.document;
        const filename = doc.file_name ?? 'file';
        const mime = doc.mime_type ?? '';
        const isAudio = mime.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|webm|flac|aac|wma)$/i.test(filename);

        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const response = await fetch(fileLink.href);
        const buffer = Buffer.from(await response.arrayBuffer());

        if (isAudio) {
          // Transcribe audio file
          ctx.reply('🎤 Транскрибирую аудиофайл...');
          const transcript = await this.transcribeAudio(buffer, filename);
          if (!transcript.trim()) { ctx.reply('⚠️ Не удалось распознать речь'); return; }

          // Show transcript
          const preview = transcript.length > 500 ? transcript.slice(0, 500) + '...' : transcript;
          ctx.reply(`📝 Транскрипция (${transcript.length} символов):\n${preview}`);

          // Ingest the transcript as text
          const ingestService = new IngestService();
          const result = await ingestService.ingestText(transcript);
          await sendLong(ctx, formatIngestResult(result));
        } else {
          ctx.reply('📄 Обрабатываю файл...');
          const ingestService = new IngestService();
          const result = await ingestService.ingestBuffer(buffer, filename);
          await sendLong(ctx, formatIngestResult(result));
        }
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Audio message (mp3 etc sent as audio, not voice)
    this.bot.on(message('audio'), async (ctx) => {
      try {
        const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        // userId auto-created by resolveUserId
        ctx.reply('🎤 Транскрибирую аудио...');
        const audio = ctx.message.audio;
        const fileLink = await ctx.telegram.getFileLink(audio.file_id);
        const response = await fetch(fileLink.href);
        const buffer = Buffer.from(await response.arrayBuffer());

        const transcript = await this.transcribeAudio(buffer, audio.file_name ?? 'audio.mp3');
        if (!transcript.trim()) { ctx.reply('⚠️ Не удалось распознать речь'); return; }

        const preview = transcript.length > 500 ? transcript.slice(0, 500) + '...' : transcript;
        ctx.reply(`📝 Транскрипция (${transcript.length} символов):\n${preview}`);

        const ingestService = new IngestService();
        const result = await ingestService.ingestText(transcript);
        await sendLong(ctx, formatIngestResult(result));
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    this.bot.on(message('photo'), async (ctx) => {
      try {
        const userId = this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        // userId auto-created by resolveUserId
        const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const response = await fetch(fileLink.href);
        const buffer = Buffer.from(await response.arrayBuffer());

        const ingestService = new IngestService();
        const result = await ingestService.ingestBuffer(buffer, 'photo.jpg');
        ctx.reply(`📷 Фото обработано: ${result.detected_type}\n${result.summary}`);
      } catch (err) {
        ctx.reply(`❌ Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Set bot commands menu
    this.bot.telegram.setMyCommands([
      { command: 'app', description: '📱 Открыть приложение' },
      { command: 'tasks', description: '📋 Активные задачи' },
      { command: 'habits', description: '🔥 Привычки на сегодня' },
      { command: 'meetings', description: '🤝 Последние встречи' },
      { command: 'brief', description: '🌅 Дневной брифинг' },
      { command: 'bundle', description: '📦 Bundle для NotebookLM' },
      { command: 'transcribe', description: '🎤 Транскрибация по ссылке' },
      { command: 'projects', description: '📁 Список проектов' },
      { command: 'add', description: '➕ Быстро добавить задачу' },
      { command: 'search', description: '🔍 Поиск в vault' },
      { command: 'all', description: '📊 Все задачи по статусам' },
      { command: 'cmd', description: '🤖 Выполнить команду' },
      { command: 'start', description: '🚀 Справка' },
    ]).catch(() => {});

    const tryLaunch = (attempt = 0): void => {
      this.bot!.launch().then(() => {
        console.log('[telegram] bot started');
      }).catch((err) => {
        const is409 = /409|Conflict|getUpdates/.test(err.message);
        const maxAttempts = 12;
        if (is409 && attempt < maxAttempts) {
          const delay = Math.min(60000, 5000 * Math.pow(1.4, attempt));
          console.warn(`[telegram] launch 409 (attempt ${attempt + 1}/${maxAttempts}), retry in ${Math.round(delay / 1000)}s`);
          setTimeout(() => tryLaunch(attempt + 1), delay);
        } else {
          console.error('[telegram] bot failed to start:', err.message);
        }
      });
    };
    tryLaunch();

    // Graceful shutdown
    process.once('SIGINT', () => this.bot?.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot?.stop('SIGTERM'));
  }

  /** Send a notification message to the configured user (legacy) */
  async notify(message: string): Promise<void> {
    if (!this.bot || !config.telegramUserId) return;
    try {
      await this.bot.telegram.sendMessage(config.telegramUserId, message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[telegram] notify failed:', err);
    }
  }

  /** Send notification to a specific Telegram user by tg_id */
  async notifyUser(tgId: string, message: string): Promise<void> {
    if (!this.bot || !tgId) return;
    try {
      await this.bot.telegram.sendMessage(tgId, message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error(`[telegram] notifyUser(${tgId}) failed:`, err);
    }
  }

  async sendFile(filePath: string, filename: string, caption?: string): Promise<void> {
    if (!this.bot || !config.telegramUserId) return;
    try {
      await this.bot.telegram.sendDocument(config.telegramUserId, { source: filePath, filename }, caption ? { caption } : undefined);
    } catch (err) {
      console.error('[telegram] sendFile failed:', err);
    }
  }

  async sendFileToUser(tgId: string, filePath: string, filename: string, caption?: string): Promise<void> {
    if (!this.bot || !tgId) return;
    try {
      await this.bot.telegram.sendDocument(tgId, { source: filePath, filename }, caption ? { caption } : undefined);
    } catch (err) {
      console.error(`[telegram] sendFileToUser(${tgId}) failed:`, err);
    }
  }

  /** Get all users with linked Telegram accounts */
  getLinkedUsers(): Array<{ id: number; tg_id: string; name: string }> {
    try {
      const db = getDb();
      return db.prepare("SELECT id, tg_id, name FROM users WHERE tg_id IS NOT NULL AND tg_id != ''").all() as Array<{ id: number; tg_id: string; name: string }>;
    } catch { return []; }
  }
}

export const telegramService = new TelegramService();
