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
  private chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  /** Execute a command via AI — same as web voice commands */
  private async executeCommand(text: string): Promise<{ text: string; file?: { path: string; filename: string } }> {
    const db = getDb();
    const claude = new ClaudeService();
    const projects = db.prepare('SELECT id, name FROM projects WHERE archived = 0').all() as Array<{ id: number; name: string }>;
    const tasks = db.prepare("SELECT id, title, status, project_id FROM tasks WHERE archived = 0").all() as Array<{ id: number; title: string; status: string; project_id: number | null }>;
    const people = db.prepare("SELECT id, name FROM people").all() as Array<{ id: number; name: string }>;

    // Auto-detect if question is about meetings → include full content
    const meetingKeywords = /встреч|обсужд|говорил|сказал|рассказ|прошл|последн|протокол|стенограмм|робот|стартап|консультац|совещан/i;
    const needsFullMeetings = meetingKeywords.test(text);

    let meetings: Array<{ id: number; title: string; date: string; project_id: number | null; preview: string }>;
    let fullMeetingContent = '';

    if (needsFullMeetings) {
      // Fetch last 5 meetings with FULL content
      const fullMeetings = db.prepare("SELECT id, title, date, project_id, summary_raw FROM meetings ORDER BY date DESC LIMIT 5").all() as Array<{ id: number; title: string; date: string; project_id: number | null; summary_raw: string }>;
      fullMeetingContent = fullMeetings.map(m =>
        `## Встреча #${m.id}: ${m.title} (${m.date})\n${(m.summary_raw || '').slice(0, 8000)}`
      ).join('\n\n---\n\n');
      meetings = fullMeetings.map(m => ({ id: m.id, title: m.title, date: m.date, project_id: m.project_id, preview: (m.summary_raw || '').slice(0, 200) }));
    } else {
      meetings = db.prepare("SELECT id, title, date, project_id, substr(summary_raw, 1, 500) as preview FROM meetings ORDER BY date DESC LIMIT 20").all() as Array<{ id: number; title: string; date: string; project_id: number | null; preview: string }>;
    }

    const systemPrompt = `Ты — персональный ассистент пользователя в Telegram. Ты умный, дружелюбный, вдумчивый собеседник.

Ты подключён к таск-трекеру и Obsidian vault пользователя, но главное — ты можешь разговаривать на любые темы, советовать, обсуждать идеи, помогать думать. Ты эксперт во всём — бизнес, проекты, продуктивность, саморазвитие, технологии, жизнь.

ДАННЫЕ СИСТЕМЫ ПОЛЬЗОВАТЕЛЯ:
Проекты: ${JSON.stringify(projects.map(p => ({ id: p.id, name: p.name })))}
Задачи: ${JSON.stringify(tasks.slice(0, 30).map(t => ({ id: t.id, title: t.title, status: t.status, project_id: t.project_id })))}
Встречи: ${JSON.stringify(meetings.map(m => ({ id: m.id, title: m.title, date: m.date, project_id: m.project_id, preview: (m.preview || '').slice(0, 200) })))}
Люди: ${JSON.stringify(people.map(p => ({ id: p.id, name: p.name })))}
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
    {"type": "create_bundle", "project_name": "string (название проекта или 'все')"},
    {"type": "create_meeting", "title": "string", "date": "YYYY-MM-DD", "project_id": number|null, "person_ids": [number], "summary_raw": "string?"},
    {"type": "update_meeting", "meeting_id": number, "title": "string?", "date": "YYYY-MM-DD?", "project_id": number?, "person_ids": [number]?, "summary_raw": "string?"},
    {"type": "delete_meeting", "meeting_id": number}
  ],
  "response": "Ответ пользователю — будь кратким и дружелюбным"
}`;

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...this.chatHistory.slice(-200), // last 100 exchanges
      { role: 'user', content: text },
    ];

    const result = await claude.chat(messages, systemPrompt, 'gpt-4.1', true, true);

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
            const r = db.prepare('INSERT INTO tasks (project_id, title, description, status, priority, due_date) VALUES (?, ?, ?, ?, ?, ?)').run(
              action['project_id'] ?? null, action['title'], '', action['status'] ?? 'todo', action['priority'] ?? 3, action['due_date'] ?? null
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
            db.prepare('INSERT INTO projects (name, color) VALUES (?, ?)').run(action['name'], action['color'] ?? '#6366f1');
            results.push(`✅ Проект "${action['name']}"`);
            break;
          }
          case 'create_idea': {
            db.prepare('INSERT INTO ideas (title, body, category, project_id, status) VALUES (?, ?, ?, ?, ?)').run(
              action['title'], (action['body'] as string) ?? '', (action['category'] as string) ?? 'personal',
              action['project_id'] ?? null, 'backlog'
            );
            const projName = action['project_id'] ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(action['project_id'] as number) as { name: string } | undefined)?.name : null;
            results.push(`💡 Идея "${action['title']}"${projName ? ` → ${projName}` : ''} → Backlog`);
            break;
          }
          case 'create_bundle': {
            const pname = (action['project_name'] as string) ?? 'все';
            const match = findProjectByName(pname);
            if (match === null) {
              results.push(`❌ Проект "${pname}" не найден`);
            } else {
              const r = generateBundle(match);
              // Store for sending file after response
              (command as Record<string, unknown>)['_bundlePath'] = path.join(config.vaultPath, r.vaultPath);
              (command as Record<string, unknown>)['_bundleFilename'] = r.filename;
              results.push(`📦 Bundle: ${r.filename} (${r.sizeKb} KB, встреч: ${r.sections.meetings}, задач: ${r.sections.tasks})`);
            }
            break;
          }
          case 'create_meeting': {
            const summary = (action['summary_raw'] as string) ?? '';
            const r = db.prepare('INSERT INTO meetings (title, date, project_id, summary_raw) VALUES (?, ?, ?, ?)').run(
              action['title'], action['date'], action['project_id'] ?? null, summary
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
        }
      } catch (err) {
        results.push(`❌ ${err instanceof Error ? err.message : 'Ошибка'}`);
      }
    }

    const responseText = command.response + (results.length > 0 ? '\n\n' + results.join('\n') : '');

    // Save to history
    this.chatHistory.push({ role: 'user', content: text });
    this.chatHistory.push({ role: 'assistant', content: responseText });
    if (this.chatHistory.length > 200) this.chatHistory = this.chatHistory.slice(-200);

    // Check if there's a file to send (bundle)
    const bundlePath = (command as Record<string, unknown>)['_bundlePath'] as string | undefined;
    const bundleFilename = (command as Record<string, unknown>)['_bundleFilename'] as string | undefined;

    return { text: responseText, file: bundlePath ? { path: bundlePath, filename: bundleFilename! } : undefined };
  }

  /** Classify message — chat/command vs ingest (for long content) */
  private async classifyMessage(text: string): Promise<'command' | 'ingest' | 'chat'> {
    // Ingest signals: explicit meeting/transcription content
    const ingestPatterns = /^(стенограмма|транскрип|запись встречи|текст встречи|протокол|заметки со встречи)/i;
    if (ingestPatterns.test(text.trim())) return 'ingest';
    // Very long text without context → probably content (e.g. pasted transcript)
    if (text.length > 500 && this.chatHistory.length === 0) return 'ingest';
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

    // /start
    this.bot.command('start', (ctx) => {
      const text =
        '🚀 Бот готов к работе!\n\n' +
        '📋 Команды:\n' +
        '/tasks — активные задачи\n' +
        '/all — все задачи по статусам\n' +
        '/meetings — последние встречи\n' +
        '/projects — список проектов\n' +
        '/add <название> — быстро добавить задачу\n' +
        '/cmd <текст> — выполнить команду\n' +
        '/brief — дневной брифинг\n' +
        '/search <запрос> — поиск\n' +
        '/app — открыть приложение\n\n' +
        '🧠 Умный ввод:\n' +
        '• Команды: «создай задачу...», «перенеси...», «удали...»\n' +
        '• Контент: текст встречи, голосовое, файл → автоматически определит тип\n' +
        '• Голосовое → транскрибация + создание встречи/задачи';

      if (config.webappUrl) {
        ctx.reply(text, Markup.inlineKeyboard([
          Markup.button.webApp('📱 Открыть приложение', config.webappUrl),
        ]));
      } else {
        ctx.reply(text);
      }
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

    // /cmd — execute command via AI
    this.bot.command('cmd', async (ctx) => {
      const text = ctx.message.text.replace(/^\/cmd\s*/, '').trim();
      if (!text) { ctx.reply('Формат: /cmd создай задачу купить молоко'); return; }
      try {
        const response = await this.executeCommand(text);
          await sendCommandResult(ctx, response);
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // /meetings — list recent meetings
    // /bundle — generate NotebookLM bundle for project
    // /bundle — generate and SEND bundle in all formats
    this.bot.command('bundle', async (ctx) => {
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
      const url = ctx.message.text.replace(/^\/transcribe\s*/, '').trim();
      if (!url) { ctx.reply('Формат: /transcribe <ссылка на аудио>\n\nЗалей файл в Google Drive/Яндекс Диск, сделай публичную ссылку и отправь.'); return; }
      try {
        ctx.reply('⬇️ Скачиваю файл...');
        const { execSync } = require('child_process');
        const tmpFile = `/tmp/tg-download-${Date.now()}.mp3`;
        execSync(`wget -q "${url}" -O "${tmpFile}" --max-redirect=5 --timeout=300`, { timeout: 600000 });

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

    this.bot.command('meetings', (ctx) => {
      const db = getDb();
      const meetings = db.prepare("SELECT m.title, m.date, p.name as project_name FROM meetings m LEFT JOIN projects p ON m.project_id = p.id ORDER BY m.date DESC LIMIT 10").all() as Array<{ title: string; date: string; project_name: string | null }>;
      if (meetings.length === 0) { ctx.reply('Нет встреч'); return; }
      const lines = meetings.map(m => `📅 ${m.date} — ${m.title}${m.project_name ? ` [${m.project_name}]` : ''}`);
      ctx.reply(`🤝 Последние встречи:\n\n${lines.join('\n')}`);
    });

    // /tasks — today's tasks
    this.bot.command('tasks', (ctx) => {
      const db = getDb();
      const tasks = db.prepare(
        "SELECT title, status, priority, due_date, project_id FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') ORDER BY priority DESC LIMIT 20"
      ).all() as Array<{ title: string; status: string; priority: number; due_date: string | null; project_id: number | null }>;

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
      const tasks = db.prepare(
        "SELECT title, status, priority FROM tasks WHERE archived = 0 ORDER BY status, priority DESC"
      ).all() as Array<{ title: string; status: string; priority: number }>;

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
      const projects = getDb().prepare(
        "SELECT name, status, color FROM projects WHERE archived = 0 ORDER BY order_index ASC"
      ).all() as Array<{ name: string; status: string }>;

      const lines = projects.map(p => `• ${p.name} (${p.status})`);
      ctx.reply(`📁 Проекты:\n\n${lines.join('\n')}` || 'Нет проектов');
    });

    // /add <title> — quick add task
    this.bot.command('add', (ctx) => {
      const text = ctx.message.text.replace(/^\/add\s*/, '').trim();
      if (!text) { ctx.reply('Формат: /add Название задачи'); return; }

      const r = getDb().prepare('INSERT INTO tasks (title, status, priority) VALUES (?, ?, ?)').run(text, 'todo', 3);
      const tid = Number(r.lastInsertRowid);
      const selfRow = getDb().prepare("SELECT id FROM people WHERE LOWER(name) IN ('я','me','self') LIMIT 1").get() as { id: number } | undefined;
      if (selfRow) getDb().prepare('INSERT OR IGNORE INTO task_people (task_id, person_id) VALUES (?, ?)').run(tid, selfRow.id);
      ctx.reply(`✅ Задача добавлена: ${text}`);
    });

    // /brief — daily brief
    this.bot.command('brief', async (ctx) => {
      const db = getDb();
      const today = moscowDateString();
      const tasks = db.prepare(
        "SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') ORDER BY priority DESC LIMIT 10"
      ).all();
      const meetings = db.prepare(
        'SELECT title, date FROM meetings WHERE date >= ? ORDER BY date ASC LIMIT 5'
      ).all(today);

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

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { searchService } = require('./search.service');
      const results = searchService.search(query, 10);
      if (results.length === 0) { ctx.reply('Ничего не найдено'); return; }

      const lines = results.map((r: { type: string; title: string }) => `[${r.type}] ${r.title}`);
      ctx.reply(`🔍 Результаты:\n\n${lines.join('\n')}`);
    });

    // Send executeCommand result — text + optional file
    const sendCommandResult = async (ctx: { reply: (text: string) => Promise<unknown>; replyWithDocument: (doc: { source: string; filename: string }, opts?: Record<string, unknown>) => Promise<unknown> }, result: { text: string; file?: { path: string; filename: string } }): Promise<void> => {
      await sendLong(ctx, result.text);
      if (result.file) {
        try {
          await ctx.replyWithDocument(
            { source: result.file.path, filename: result.file.filename },
            { caption: '📄 Файл готов — загрузи в NotebookLM' }
          );
        } catch {}
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
        const intent = await this.classifyMessage(text);
        if (intent === 'command' || intent === 'chat') {
          const response = await this.executeCommand(text);
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
        const intent = await this.classifyMessage(transcript);
        if (intent === 'command' || intent === 'chat') {
          const cmdResponse = await this.executeCommand(transcript);
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

    this.bot.launch().then(() => {
      console.log('[telegram] bot started');
    }).catch((err) => {
      console.error('[telegram] bot failed to start:', err.message);
    });

    // Graceful shutdown
    process.once('SIGINT', () => this.bot?.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot?.stop('SIGTERM'));
  }

  /** Send a notification message to the configured user */
  async notify(message: string): Promise<void> {
    if (!this.bot || !config.telegramUserId) return;
    try {
      await this.bot.telegram.sendMessage(config.telegramUserId, message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[telegram] notify failed:', err);
    }
  }
}

export const telegramService = new TelegramService();
