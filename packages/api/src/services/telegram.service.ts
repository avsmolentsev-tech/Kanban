import * as path from 'path';
import * as fs from 'fs';
import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from '../config';
import { queryAll, queryOne, execute } from '../db/db';
import { IngestService } from './ingest.service';
import { ClaudeService } from './claude.service';
import OpenAI from 'openai';
import { moscowDateString, moscowDateTimeString } from '../utils/time';
import { generateBundle, findProjectByName } from './bundle.service';
import { generateAllFormats } from './converter.service';
import { DraftSession } from './draft-session';
import type { ExtractionResult, DraftCard } from '@pis/shared';
import { ObsidianService } from './obsidian.service';
import { renderDraftCard, inlineKeyboard, parseCallbackData } from './card-renderer';

export class TelegramService {
  private bot: Telegraf | null = null;
  private chatHistories = new Map<number, Array<{ role: 'user' | 'assistant'; content: string }>>();
  private pendingLogins = new Map<number, 'email' | 'password'>(); // tg_id → waiting state
  private pendingEmails = new Map<number, string>(); // tg_id → email entered
  private recentActions = new Map<number, Array<{ type: string; title: string; id: number; table: string; date: string; savedAt: number }>>();
  private proMode = new Set<number>(); // tg_id → next audio uses OpenAI Whisper API
  private contentType = new Map<number, string>(); // tg_id → 'lecture'|'interview' for next audio
  private lastCreatedPerson = new Map<number, { name: string; id: number; ts: number }>(); // tg_id → last created contact
  private pendingPhotoData = new Map<number, { data: Record<string, string>; ts: number }>(); // tg_id → buffered photo data waiting for name
  private drafts = new DraftSession({
    timeoutMs: 60 * 60_000, // 1 hour — no rush
    onTimeout: (c) => {
      this.saveDraftAsIs(c)
        .then(() => {
          // Notify user that draft was auto-saved
          this.notifyUser(c.tgId, `✅ ${c.type === 'meeting' ? 'Встреча' : 'Запись'} «${c.title}» автоматически сохранена.\n\nМожешь найти её в приложении и отредактировать в любое время.`);
        })
        .catch((e) => console.error('[draft] timeout save failed:', e));
    },
  });

  private getChatHistory(tgId: number): Array<{ role: 'user' | 'assistant'; content: string }> {
    if (!this.chatHistories.has(tgId)) this.chatHistories.set(tgId, []);
    return this.chatHistories.get(tgId)!;
  }

  /** Download file from Telegram. In local Bot API mode, reads from disk. Otherwise fetches via URL. */
  private async downloadTelegramFile(ctx: any, fileId: string): Promise<Buffer> {
    if (process.env.TELEGRAM_LOCAL_API_ROOT) {
      // Local mode: getFile returns absolute file_path on disk
      const file = await ctx.telegram.getFile(fileId);
      const filePath = file.file_path;
      if (filePath && fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
      // Fallback: try URL-based download
    }
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await fetch(fileLink.href);
    return Buffer.from(await response.arrayBuffer());
  }

  /** Resolve internal user id from Telegram user id. Returns null if not linked — user must /login first. */
  private async resolveUserId(tgId: number, _tgName?: string): Promise<number | null> {
    if (!tgId) return null;
    const row = await queryOne<{ id: number }>("SELECT id FROM users WHERE tg_id = $1", [String(tgId)]);
    if (row) return row.id;
    // No auto-create — user must link via /login
    return null;
  }

  private pushRecentAction(tgId: number, action: { type: string; title: string; id: number; table: string; date: string; savedAt: number }): void {
    const actions = this.recentActions.get(tgId) ?? [];
    actions.unshift(action);
    if (actions.length > 10) actions.length = 10;
    this.recentActions.set(tgId, actions);
  }

  private async saveDraftAsIs(draft: DraftCard): Promise<void> {
    const obsidian = new ObsidianService(config.vaultPath).forUser(draft.userId);
    const tagsList = draft.tags;
    if (draft.type === 'meeting') {
      // Check for duplicate: same title + date
      const existing = await queryOne<{ id: number; title: string }>(
        'SELECT id, title FROM meetings WHERE user_id = $1 AND date = $2 AND title = $3',
        [draft.userId, draft.date, draft.title]
      );
      if (existing) {
        console.log(`[draft] duplicate meeting detected: "${draft.title}" on ${draft.date} (existing #${existing.id})`);
        // Update existing instead of creating new
        await execute(
          'UPDATE meetings SET summary_raw = $1, summary_structured = $2 WHERE id = $3',
          [draft.summary || draft.title, JSON.stringify({ transcript: draft.transcript }), existing.id]
        );
        this.pushRecentAction(draft.tgId, { type: 'meeting', title: draft.title, id: existing.id, table: 'meetings', date: draft.date, savedAt: Date.now() });
        return;
      }
      // summary_raw = readable summary (no transcript), transcript stored separately in summary_structured
      const summaryBody = draft.summary || draft.title;
      // Resolve project
      const cleanProject = (draft.projectName ?? '').replace(/^❓\s*/, '').replace(/\s*\(не найден\)$/, '').trim() || null;
      let projectId: number | null = null;
      if (cleanProject) {
        const allProjects = await queryAll<{ id: number; name: string }>('SELECT id, name FROM projects WHERE user_id = $1 AND archived = 0', [draft.userId]);
        const lowerClean = cleanProject.toLowerCase();
        const proj = allProjects.find(p => p.name.toLowerCase() === lowerClean || p.name.toLowerCase().includes(lowerClean) || lowerClean.includes(p.name.toLowerCase()));
        projectId = proj?.id ?? null;
      }
      const inserted = await queryOne<{ id: number }>(
        'INSERT INTO meetings (user_id, title, date, project_id, summary_raw, summary_structured, source_file, processed, meeting_type) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8) RETURNING id',
        [draft.userId, draft.title, draft.date, projectId, summaryBody, JSON.stringify({ transcript: draft.transcript }), draft.sourceKind, draft.meetingType || 'meeting']
      );
      const meetingId = inserted!.id;
      // Link people
      for (const personName of draft.people) {
        const person = await queryOne<{ id: number }>('SELECT id FROM people WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [draft.userId, personName.trim()]);
        if (person) {
          await execute('INSERT INTO meeting_people (meeting_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [meetingId, person.id]);
        } else {
          const newPerson = await queryOne<{ id: number }>('INSERT INTO people (user_id, name) VALUES ($1, $2) RETURNING id', [draft.userId, personName.trim()]);
          await execute('INSERT INTO meeting_people (meeting_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [meetingId, newPerson!.id]);
        }
      }
      const vaultRel = await obsidian.writeMeeting({
        title: draft.title, date: draft.date, people: draft.people,
        project: cleanProject ?? undefined,
        company: draft.companyName ?? undefined,
        summary: summaryBody, agreements: 0,
        source: `telegram-${draft.sourceKind}`,
        tags: tagsList,
      });
      await execute('UPDATE meetings SET vault_path = $1 WHERE id = $2', [vaultRel, meetingId]);
      this.pushRecentAction(draft.tgId, { type: 'meeting', title: draft.title, id: meetingId, table: 'meetings', date: draft.date, savedAt: Date.now() });

      // Tasks from meeting are NOT auto-created — user selects them via UI dialog

      // Async: generate pro summaries (Notes, Q&A)
      if (draft.transcript && draft.transcript.length > 200) {
        const claude = new ClaudeService();
        claude.generateProSummaries(draft.transcript, draft.title, draft.people, draft.meetingType || 'meeting').then(async (summaries) => {
          // Read-merge-write to avoid overwriting user edits
          const existingRow = await queryOne<{ summary_structured: string | null }>('SELECT summary_structured FROM meetings WHERE id = $1', [meetingId]);
          let merged: Record<string, unknown> = {};
          try { merged = JSON.parse(existingRow?.summary_structured || '{}'); } catch {}
          merged = { ...merged, ...summaries, transcript: draft.transcript };
          await execute(
            'UPDATE meetings SET summary_raw = $1, summary_structured = $2 WHERE id = $3',
            [summaries.notes || summaryBody, JSON.stringify(merged), meetingId]
          );
          console.log(`[draft] pro summaries generated for meeting #${meetingId}`);
          // Re-sync to Obsidian with full structured data (notes, Q&A, actions)
          try {
            const fresh = await queryOne<Record<string, unknown>>('SELECT * FROM meetings WHERE id = $1', [meetingId]);
            if (fresh && (fresh['sync_vault'] as number | null | undefined) !== 0) {
              const projectNameRow = fresh['project_id'] ? await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [fresh['project_id'] as number]) : undefined;
              const projectName = projectNameRow?.name;
              const peopleNames = (await queryAll<{ name: string }>('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1', [meetingId])).map(x => x.name);
              const vp = await obsidian.writeMeeting({
                title: fresh['title'] as string,
                date: fresh['date'] as string,
                ...(projectName ? { project: projectName } : {}),
                summary: (fresh['summary_raw'] as string) ?? '',
                structured: { notes: summaries.notes, qa: summaries.qa, ...(summaries.actions ? { actions: summaries.actions } : {}) },
                people: peopleNames,
              });
              if (vp && vp !== fresh['vault_path']) {
                await execute('UPDATE meetings SET vault_path = $1 WHERE id = $2', [vp, meetingId]);
              }
              console.log(`[draft] vault re-synced for meeting #${meetingId}`);
            }
          } catch (vaultErr) {
            console.warn(`[draft] vault re-sync failed for meeting #${meetingId}:`, vaultErr instanceof Error ? vaultErr.message : vaultErr);
          }
        }).catch((err) => {
          console.warn(`[draft] pro summaries failed for meeting #${meetingId}:`, err instanceof Error ? err.message : err);
        });
      }
    } else if (draft.type === 'task') {
      // Resolve project
      const cleanProject = (draft.projectName ?? '').replace(/^❓\s*/, '').replace(/\s*\(не найден\)$/, '').trim() || null;
      let projectId: number | null = null;
      if (cleanProject) {
        const allProjects = await queryAll<{ id: number; name: string }>('SELECT id, name FROM projects WHERE user_id = $1 AND archived = 0', [draft.userId]);
        const lowerClean = cleanProject.toLowerCase();
        const proj = allProjects.find(p => p.name.toLowerCase() === lowerClean || p.name.toLowerCase().includes(lowerClean) || lowerClean.includes(p.name.toLowerCase()));
        projectId = proj?.id ?? null;
      }
      const taskInserted = await queryOne<{ id: number }>(
        'INSERT INTO tasks (user_id, title, description, status, priority, urgency, project_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [draft.userId, draft.title, draft.summary, 'todo', 3, 3, projectId]
      );
      const taskId = taskInserted!.id;
      // Link people
      for (const personName of draft.people) {
        const person = await queryOne<{ id: number }>('SELECT id FROM people WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [draft.userId, personName.trim()]);
        let personId: number;
        if (person) {
          personId = person.id;
        } else {
          const newPerson = await queryOne<{ id: number }>('INSERT INTO people (user_id, name) VALUES ($1, $2) RETURNING id', [draft.userId, personName.trim()]);
          personId = newPerson!.id;
        }
        await execute('INSERT INTO task_people (task_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [taskId, personId]);
      }
      const vaultRel = await obsidian.writeTask({
        title: draft.title, status: 'todo', priority: 3, urgency: 3,
        project: draft.projectName ?? undefined,
        company: draft.companyName ?? undefined,
        people: draft.people,
        tags: tagsList,
        source: `telegram-${draft.sourceKind}`,
      });
      await execute('UPDATE tasks SET vault_path = $1 WHERE id = $2', [vaultRel, taskId]);
      this.pushRecentAction(draft.tgId, { type: 'task', title: draft.title, id: taskId, table: 'tasks', date: draft.date, savedAt: Date.now() });
    } else if (draft.type === 'idea') {
      // Resolve project
      const cleanProjectIdea = (draft.projectName ?? '').replace(/^❓\s*/, '').replace(/\s*\(не найден\)$/, '').trim() || null;
      let ideaProjectId: number | null = null;
      if (cleanProjectIdea) {
        const proj = await queryOne<{ id: number }>('SELECT id FROM projects WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [draft.userId, cleanProjectIdea]);
        ideaProjectId = proj?.id ?? null;
      }
      const ideaInserted = await queryOne<{ id: number }>(
        'INSERT INTO ideas (user_id, title, body, category, status, project_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [draft.userId, draft.title, draft.summary, 'personal', 'backlog', ideaProjectId]
      );
      const ideaId = ideaInserted!.id;
      await obsidian.writeIdea({
        title: draft.title, body: draft.summary,
        category: 'personal',
        project: draft.projectName ?? undefined,
        company: draft.companyName ?? undefined,
        date: draft.date,
        tags: tagsList,
        source: `telegram-${draft.sourceKind}`,
      });
      this.pushRecentAction(draft.tgId, { type: 'idea', title: draft.title, id: ideaId, table: 'ideas', date: draft.date, savedAt: Date.now() });
    } else {
      await obsidian.writeInboxItem(`${draft.date}-${draft.title}.txt`, draft.transcript);
    }
  }

  private async applyCorrection(ctx: any, draft: DraftCard, userText: string): Promise<void> {
    const claude = new ClaudeService();
    const existingProjects = await queryAll<{ name: string }>('SELECT name FROM projects WHERE user_id = $1 AND archived = 0', [draft.userId]);
    const patched = await claude.correctDraft(draft, userText, existingProjects.map(p => p.name));
    // Fuzzy-match project from correction against DB
    let projectName = patched.project_hints[0] ?? null;
    if (projectName) {
      const hint = projectName.toLowerCase();
      const match = existingProjects.find(p =>
        p.name.toLowerCase() === hint ||
        p.name.toLowerCase().includes(hint) ||
        hint.includes(p.name.toLowerCase())
      );
      projectName = match ? match.name : `❓ ${projectName} (не найден)`;
    }
    const updated = this.drafts.update(draft.tgId, {
      type: patched.detected_type,
      title: patched.title,
      date: patched.date,
      projectName,
      companyName: patched.company_hints[0] ?? null,
      people: patched.people,
      tags: [...patched.tags_hierarchical, ...patched.tags_free],
      summary: patched.summary,
      awaitingEdit: false,
    });
    if (!updated) {
      await ctx.reply('❌ Драфт не найден, попробуй заново.');
      return;
    }
    // Send NEW card message (old one is far up in chat — user can't see it)
    const msg = await ctx.reply(
      `✅ Коррекция применена:\n\n${renderDraftCard(updated)}`,
      { reply_markup: inlineKeyboard(updated) },
    );
    // Update card message ID to the new message so OK/Fix buttons work on it
    this.drafts.update(draft.tgId, { cardMessageId: msg.message_id });
  }

  private async buildAndSendDraft(
    ctx: any,
    userId: number,
    tgId: number,
    sourceKind: DraftCard['sourceKind'],
    transcript: string,
    sourceLocalPath: string | null,
  ): Promise<void> {
    if (!transcript.trim()) { await ctx.reply('⚠️ Пустой текст, нечего сохранять'); return; }
    const claude = new ClaudeService();

    // Check if lecture mode was set
    const cType = this.contentType.get(tgId);
    if (cType) this.contentType.delete(tgId); // one-shot

    // Pass existing project names to Claude so it picks from the list
    const existingProjects = await queryAll<{ name: string }>('SELECT name FROM projects WHERE user_id = $1 AND archived = 0', [userId]);
    const projectNames = existingProjects.map(p => p.name);
    const meetingType = (cType === 'lecture' || cType === 'interview') ? cType : 'meeting';
    const typeHint = cType === 'lecture' ? 'lecture' : (cType === 'interview' ? 'interview' : undefined);
    const extraction: ExtractionResult = await claude.extractDraft(transcript, typeHint, projectNames);

    // Safety net: save raw transcript to vault inbox immediately (survives PM2 restart)
    try {
      const obsidian = new ObsidianService(config.vaultPath).forUser(userId);
      const safeTitle = extraction.title.replace(/[/\\?%*:|"<>]/g, '').slice(0, 60);
      const inboxName = `${extraction.date}-draft-${safeTitle}.md`;
      const inboxContent = `---\nstatus: draft\ntype: ${extraction.detected_type}\ntitle: "${extraction.title}"\ndate: ${extraction.date}\npeople: [${extraction.people.join(', ')}]\nproject: "${extraction.project_hints[0] ?? ''}"\n---\n\n## Резюме\n\n${extraction.summary}\n\n---\n\n## Транскрипция\n\n${transcript}`;
      await obsidian.writeInboxItem(inboxName, inboxContent);
      console.log(`[draft] saved transcript to inbox: ${inboxName}`);
    } catch (e) {
      console.error('[draft] failed to save transcript to inbox:', e);
    }

    const card = this.drafts.create(tgId, userId, extraction, sourceKind, transcript, sourceLocalPath, meetingType as any);
    // Fuzzy-match project against DB
    if (card.projectName) {
      const hint = card.projectName.toLowerCase();
      const match = existingProjects.find(p =>
        p.name.toLowerCase() === hint ||
        p.name.toLowerCase().includes(hint) ||
        hint.includes(p.name.toLowerCase())
      );
      if (match) {
        this.drafts.update(tgId, { projectName: match.name });
      } else {
        this.drafts.update(tgId, { projectName: `❓ ${card.projectName} (не найден)` });
      }
    }
    const msg = await ctx.reply(renderDraftCard(this.drafts.get(tgId) ?? card), { reply_markup: inlineKeyboard(this.drafts.get(tgId) ?? card) });
    this.drafts.update(tgId, { cardMessageId: msg.message_id });
  }

  /** Execute a command via AI — same as web voice commands */
  private async executeCommand(text: string, tgUserId?: number, lastContact?: { id: number; name: string }): Promise<{ text: string; files?: Array<{ path: string; filename: string }> }> {
    const userId = tgUserId ? await this.resolveUserId(tgUserId) : null;
    const userFilter = userId != null ? ' AND user_id = $1' : '';
    const userParams = userId != null ? [userId] : [];
    const claude = new ClaudeService();
    const projects = await queryAll<{ id: number; name: string }>(`SELECT id, name FROM projects WHERE archived = 0${userFilter}`, userParams);
    const tasks = await queryAll<{ id: number; title: string; status: string; project_id: number | null; due_date: string | null }>(`SELECT id, title, status, project_id, due_date FROM tasks WHERE archived = 0${userFilter}`, userParams);
    const people = await queryAll<{ id: number; name: string }>(`SELECT id, name FROM people WHERE 1=1${userFilter}`, userParams);
    let goals: Array<{ id: number; title: string; type: string; parent_id: number | null; current_value: number; target_value: number; unit: string; status: string }> = [];
    try { goals = await queryAll<typeof goals[number]>(`SELECT id, title, type, parent_id, current_value, target_value, unit, status FROM goals WHERE status = 'active'${userFilter} ORDER BY type, parent_id`, userParams); } catch {}

    const today = moscowDateString();
    const todayTasks = tasks.filter(t => t.due_date === today && t.status !== 'done' && t.status !== 'someday');
    const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
    const overdueTasks = tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'someday');

    // Auto-detect if question is about meetings → include full content
    const meetingKeywords = /встреч|обсужд|говорил|сказал|рассказ|прошл|последн|протокол|стенограмм|робот|стартап|консультац|совещан/i;
    const needsFullMeetings = meetingKeywords.test(text);

    let meetings: Array<{ id: number; title: string; date: string; project_id: number | null; preview: string; people: string[] }>;
    let fullMeetingContent = '';

    // Helper: fetch people linked to a meeting
    const getMeetingPeople = async (meetingId: number): Promise<string[]> => {
      const rows = await queryAll<{ name: string }>('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1', [meetingId]);
      return rows.map(r => r.name);
    };

    if (needsFullMeetings) {
      const fullMeetings = await queryAll<{ id: number; title: string; date: string; project_id: number | null; summary_raw: string }>(`SELECT id, title, date, project_id, summary_raw FROM meetings WHERE 1=1${userFilter} ORDER BY date DESC LIMIT 5`, userParams);
      const fullMeetingsWithPeople = await Promise.all(fullMeetings.map(async m => ({ ...m, people: await getMeetingPeople(m.id) })));
      fullMeetingContent = fullMeetingsWithPeople.map(m => {
        return `## Встреча #${m.id}: ${m.title} (${m.date})${m.people.length ? ` [Участники: ${m.people.join(', ')}]` : ''}\n${(m.summary_raw || '').slice(0, 8000)}`;
      }).join('\n\n---\n\n');
      meetings = fullMeetingsWithPeople.map(m => ({ id: m.id, title: m.title, date: m.date, project_id: m.project_id, preview: (m.summary_raw || '').slice(0, 200), people: m.people }));
    } else {
      const rawMeetings = await queryAll<{ id: number; title: string; date: string; project_id: number | null; preview: string }>(`SELECT id, title, date, project_id, SUBSTRING(summary_raw, 1, 500) as preview FROM meetings WHERE 1=1${userFilter} ORDER BY date DESC LIMIT 20`, userParams);
      meetings = await Promise.all(rawMeetings.map(async m => ({ ...m, people: await getMeetingPeople(m.id) })));
    }

    // Recent user actions (what was just transcribed/saved/edited — for context continuity)
    const tgId = tgUserId ?? 0;
    const recent = this.recentActions.get(tgId) ?? [];
    const recentContext = recent.length > 0
      ? `\n\nНЕДАВНИЕ ДЕЙСТВИЯ ПОЛЬЗОВАТЕЛЯ (что он только что делал в этой сессии):\n${recent.slice(0, 5).map((a, i) => `${i + 1}. [${a.type}] "${a.title}" (id=${a.id}, таблица=${a.table}, дата=${a.date})`).join('\n')}\n\nЕсли пользователь говорит "эта встреча", "последняя встреча", "из неё", "к ней" — он имеет в виду запись #1 из этого списка. НЕ СПРАШИВАЙ "какую встречу вы имеете в виду" если контекст очевиден из недавних действий.`
      : '';

    const systemPrompt = `Ты — персональный ассистент пользователя в Telegram. Ты умный, дружелюбный, вдумчивый собеседник.

Ты подключён к таск-трекеру и Obsidian vault пользователя, но главное — ты можешь разговаривать на любые темы, советовать, обсуждать идеи, помогать думать. Ты эксперт во всём — бизнес, проекты, продуктивность, саморазвитие, технологии, жизнь.

ДАННЫЕ СИСТЕМЫ ПОЛЬЗОВАТЕЛЯ:
Сегодня: ${today}
Проекты: ${JSON.stringify(projects.map(p => ({ id: p.id, name: p.name })))}
Задачи: ${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, status: t.status, project_id: t.project_id, due_date: t.due_date })))}
${todayTasks.length > 0 ? `\n📋 ЗАДАЧИ НА СЕГОДНЯ (${todayTasks.length}, НЕ ВЫПОЛНЕНЫ!): ${JSON.stringify(todayTasks.map(t => ({ id: t.id, title: t.title, status: t.status, project_id: t.project_id })))}\nЕсли пользователь спрашивает про задачи или "что на сегодня" — ОБЯЗАТЕЛЬНО показывай этот список. НЕ говори что "все сделано" если список не пуст!\n` : ''}${inProgressTasks.length > 0 ? `\n🔄 В РАБОТЕ (${inProgressTasks.length}): ${JSON.stringify(inProgressTasks.map(t => ({ id: t.id, title: t.title, project_id: t.project_id })))}\n` : ''}${overdueTasks.length > 0 ? `\n⚠️ ПРОСРОЧЕННЫЕ ЗАДАЧИ (${overdueTasks.length}): ${JSON.stringify(overdueTasks.map(t => ({ id: t.id, title: t.title, due_date: t.due_date, project_id: t.project_id })))}\nОбязательно напоминай пользователю о просроченных задачах если он спрашивает о статусе, задачах или прогрессе!\n` : ''}Встречи: ${JSON.stringify(meetings.map(m => ({ id: m.id, title: m.title, date: m.date, project_id: m.project_id, people: m.people, preview: (m.preview || '').slice(0, 200) })))}${recentContext}
Люди: ${JSON.stringify(people.map(p => ({ id: p.id, name: p.name })))}
${lastContact ? `\n🧑 ПОСЛЕДНИЙ КОНТАКТ (только что создан): id=${lastContact.id}, name="${lastContact.name}". Команды "к проекту", "добавь телефон/email", "привяжи" — относятся к ЭТОМУ человеку. Используй update_person!\n` : ''}Цели и ключевые результаты (OKR):
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

ЖЕЛЕЗНЫЕ ПРАВИЛА:
1. Команда (создай, перенеси, удали, обнови, привяжи) → ОБЯЗАТЕЛЬНО actions! НИКОГДА не говори "создаю" без action!
2. ЧЕЛОВЕК ≠ ПРОЕКТ! Имена (Сергей, Ольга) → create_person. Проекты = направления (Robots, V-Cards).
3. "Добавь Сергея к проекту" = create_person с project_id ИЛИ update_person. НЕ create_project!
4. Вопросы → response, actions пусты
5. Отвечай на русском, ЧЁТКО: "✅ Создан контакт X" а не "Создаю контакт X"
6. Контекст: «её», «эту», «его» = предыдущий объект
7. НЕ создавай задачи/проекты если не просят явно
8. ДАТЫ: если пользователь упоминает дату ("5 мая", "вчера", "в прошлую пятницу", "2 недели назад") — вычисли правильную дату в YYYY-MM-DD. Сегодня = ${today}. НЕ ставь сегодняшнюю дату если пользователь явно назвал другую!
   Примеры: "встреча была 5 мая" → date="2026-05-05", "вчерашняя встреча" → date вчерашнего дня, "задача на следующий понедельник" → due_date следующего понедельника
9. ЗАДАЧИ НА НЕДЕЛЮ: если пользователь создаёт несколько задач и говорит "на неделю" / "на эту неделю" / "задачи на неделю" / "планы на неделю" / "распредели по дням" — АВТОМАТИЧЕСКИ применяй логику из раздела ЕЖЕНЕДЕЛЬНЫЕ ЦЕЛИ: распредели задачи по дням Пн-Вс текущей недели, ставь due_date каждой задаче, status="todo". НИКОГДА не создавай задачи без due_date если пользователь упомянул неделю!

🚨 ЖЕЛЕЗНОЕ ПРАВИЛО про создание сущностей:
- Списки «Проекты», «Задачи», «Встречи», «Люди», «Цели» выше — это ПОЛНЫЙ список того, что есть у пользователя в БД прямо сейчас.
- Если в списке стоит [] (пустая скобка) — у пользователя НИЧЕГО не заведено.
- Если пользователь просит «создай проекты X, Y, Z» или «заведи задачи A, B, C» и этих названий НЕТ в списке выше — ТЫ ОБЯЗАН вернуть соответствующие create_* actions в массиве actions. По одной action на каждый объект.
- НИКОГДА не отвечай «проекты уже существуют», «создано ✅», «добавлено», если в actions не вернул соответствующий create_*. Иначе ты обманешь пользователя — в БД ничего не появится.
- Если название совпадает с уже существующим проектом/задачей из списка — не дублируй, но скажи об этом явно в response.
- Принцип: если в response пишешь «создал ✅ X» — в actions ОБЯЗАТЕЛЬНО должна быть соответствующая create_* запись.

ЕЖЕНЕДЕЛЬНЫЕ ЦЕЛИ:
Когда пользователь отвечает на вопрос о целях/задачах на неделю (или сам пишет "цели на неделю: ...", "задачи на неделю", "задачи на эту неделю", "вот планы на неделю", "вот мои задачи на неделю", или просто перечисляет задачи после упоминания "неделя"):
1. Распредели по дням Пн-Вс (не больше 1-2 задач на день, оставь Сб-Вс легче).
2. Привяжи к проектам из списка если совпадают.
3. Создай задачи через actions: type="create_task", title=<цель>, description="[🎯 Цель недели] <контекст>", due_date=<YYYY-MM-DD>, status="todo".
4. Подтверди пользователю раскладку.

BHAG (Большая Дерзкая Цель на год):
Когда пользователь ставит BHAG ("моя цель на год...", "хочу достичь...", "главная цель на год..."):
1. Создай goal: {"type": "create_goal", "title": "...", "description": "...", "goal_type": "bhag", "due_date": "YYYY-12-31"}
2. Скажи: "🎯 BHAG создана! Открой Mind Map в приложении — я помогу декомпозировать на milestones и задачи."
3. НЕ пытайся декомпозировать прямо в чате — для этого есть Mind Map.

ФОКУС ДНЯ:
Когда пользователь ставит цели на неделю, также спроси/предложи фокус на каждый день.
Фокус — это одно слово или короткая фраза (1-5 слов), описывающая главный приоритет дня.
Примеры: "контент", "встречи и нетворкинг", "продукт V-Cards", "отдых", "документы и отчёты".
После подтверждения пользователем, сохрани фокусы в дневник через actions:
- type: "set_focus", date: "YYYY-MM-DD", focus: "текст фокуса"

Если пользователь просит поставить фокус на один конкретный день — тоже используй set_focus.

ВАЖНО: Всегда отвечай в формате JSON с полями "actions" (массив) и "response" (строка).
Для вопросов actions = [], а ответ в response.

Верни ТОЛЬКО JSON (без markdown, без \`\`\`):
{
  "actions": [
    {"type": "create_task", "title": "string", "project_id": number|null, "status": "todo", "priority": 1-5, "due_date": "YYYY-MM-DD"|null, "person_ids": [number], "description": "string?"},
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
    {"type": "send_meeting", "meeting_id": number, "kind": "summary|full", "format": "md|pdf|docx"},
    {"type": "set_focus", "date": "YYYY-MM-DD", "focus": "текст фокуса"} — установить фокус дня в дневнике
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

    const model = 'gpt-4.1-mini';

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
    if (!Array.isArray(command.actions)) command.actions = [];
    const results: string[] = [];

    for (const action of command.actions) {
      try {
        switch (action['type']) {
          case 'create_task': {
            const taskIns = await queryOne<{ id: number }>(
              'INSERT INTO tasks (project_id, title, description, status, priority, due_date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
              [action['project_id'] ?? null, action['title'], (action['description'] as string) ?? '', action['status'] ?? 'todo', action['priority'] ?? 3, action['due_date'] ?? null, userId]
            );
            const taskId = taskIns!.id;
            // Auto-add self if no people specified
            let peopleIds = Array.isArray(action['person_ids']) ? action['person_ids'] as number[] : [];
            if (peopleIds.length === 0) {
              const selfRow = await queryOne<{ id: number }>("SELECT id FROM people WHERE LOWER(name) IN ('я','me','self') LIMIT 1");
              if (selfRow) peopleIds = [selfRow.id];
            }
            for (const pid of peopleIds) {
              await execute('INSERT INTO task_people (task_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [taskId, pid]);
            }
            const projNameRow = action['project_id'] ? await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [action['project_id'] as number]) : null;
            const projName = projNameRow?.name ?? null;
            results.push(`✅ Задача "${action['title']}"${projName ? ` → ${projName}` : ''}`);
            break;
          }
          case 'move_task': {
            await execute("UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2", [action['status'], action['task_id']]);
            results.push(`✅ Задача #${action['task_id']} → ${action['status']}`);
            break;
          }
          case 'delete_task': {
            await execute("UPDATE tasks SET archived = 1 WHERE id = $1", [action['task_id']]);
            results.push(`🗑 Задача #${action['task_id']} удалена`);
            break;
          }
          case 'update_task': {
            const fields: string[] = [];
            const values: unknown[] = [];
            for (const key of ['title', 'priority', 'urgency', 'due_date', 'project_id']) {
              if (action[key] !== undefined) { fields.push(`${key} = $${values.length + 1}`); values.push(action[key]); }
            }
            if (fields.length > 0) {
              values.push(action['task_id']);
              await execute(`UPDATE tasks SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`, values);
            }
            results.push(`✅ Задача #${action['task_id']} обновлена`);
            break;
          }
          case 'create_project': {
            await execute('INSERT INTO projects (name, color, user_id) VALUES ($1, $2, $3)', [action['name'], action['color'] ?? '#6366f1', userId]);
            results.push(`✅ Проект "${action['name']}"`);
            break;
          }
          case 'create_idea': {
            await execute(
              'INSERT INTO ideas (title, body, category, project_id, status, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
              [action['title'], (action['body'] as string) ?? '', (action['category'] as string) ?? 'personal', action['project_id'] ?? null, 'backlog', userId]
            );
            const ideaProjRow = action['project_id'] ? await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [action['project_id'] as number]) : null;
            const projName = ideaProjRow?.name ?? null;
            results.push(`💡 Идея "${action['title']}"${projName ? ` → ${projName}` : ''} → Backlog`);
            break;
          }
          case 'create_habit': {
            await execute(
              'INSERT INTO habits (title, icon, remind_time, user_id) VALUES ($1, $2, $3, $4)',
              [action['title'], (action['icon'] as string) ?? '✅', action['remind_time'] ?? null, userId]
            );
            results.push(`🔥 Привычка "${action['title']}" создана${action['remind_time'] ? ` (⏰ ${action['remind_time']})` : ''}`);
            break;
          }
          case 'log_habit': {
            const title = (action['habit_title'] as string).toLowerCase();
            const habit = await queryAll<{ id: number; title: string }>(`SELECT id, title FROM habits WHERE archived = 0${userFilter}`, userParams);
            const match = habit.find(h => h.title.toLowerCase().includes(title) || title.includes(h.title.toLowerCase()));
            if (match) {
              const today = moscowDateString();
              const existingLog = await queryOne<{ id: number }>("SELECT id FROM habit_logs WHERE habit_id = $1 AND date = $2", [match.id, today]);
              if (existingLog) {
                results.push(`✅ "${match.title}" уже отмечена сегодня`);
              } else {
                await execute("INSERT INTO habit_logs (habit_id, date) VALUES ($1, $2)", [match.id, today]);
                results.push(`✅ "${match.title}" отмечена!`);
              }
            } else {
              results.push(`❌ Привычка "${action['habit_title']}" не найдена`);
            }
            break;
          }
          case 'create_goal': {
            const goalType = (action['goal_type'] as string) ?? 'goal';
            await execute(
              'INSERT INTO goals (title, description, type, project_id, target_value, unit, due_date, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
              [action['title'], (action['description'] as string) ?? '', goalType,
              action['project_id'] ?? null, action['target_value'] ?? 100, (action['unit'] as string) ?? '%', action['due_date'] ?? null, userId]
            );
            results.push(`🎯 Цель "${action['title']}" создана`);
            break;
          }
          case 'create_key_result': {
            await execute(
              'INSERT INTO goals (title, type, parent_id, target_value, unit, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
              [action['title'], 'key_result', action['parent_id'], action['target_value'] ?? 100, (action['unit'] as string) ?? '%', userId]
            );
            results.push(`📊 KR "${action['title']}" добавлен`);
            break;
          }
          case 'update_goal': {
            const fields: string[] = [];
            const values: unknown[] = [];
            if (action['current_value'] !== undefined) { fields.push(`current_value = $${values.length + 1}`); values.push(action['current_value']); }
            if (action['status'] !== undefined) { fields.push(`status = $${values.length + 1}`); values.push(action['status']); }
            if (fields.length > 0) {
              values.push(action['goal_id']);
              await execute(`UPDATE goals SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
            }
            results.push(`🎯 Цель #${action['goal_id']} обновлена`);
            break;
          }
          case 'create_bundle': {
            const pname = (action['project_name'] as string) ?? 'все';
            const match = await findProjectByName(pname);
            if (match === null) {
              results.push(`❌ Проект "${pname}" не найден`);
            } else {
              const r = await generateBundle(match);
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
            const meetIns = await queryOne<{ id: number }>(
              'INSERT INTO meetings (title, date, project_id, summary_raw, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
              [action['title'], action['date'], action['project_id'] ?? null, summary, userId]
            );
            const meetingId = meetIns!.id;
            if (Array.isArray(action['person_ids'])) {
              for (const pid of action['person_ids'] as number[]) {
                await execute('INSERT INTO meeting_people (meeting_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [meetingId, pid]);
              }
            }
            const meetProjRow = action['project_id'] ? await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [action['project_id'] as number]) : null;
            const projName = meetProjRow?.name ?? null;
            results.push(`✅ Встреча "${action['title']}" на ${action['date']}${projName ? ` [${projName}]` : ''}`);
            break;
          }
          case 'update_meeting': {
            const fields: string[] = [];
            const values: unknown[] = [];
            for (const key of ['title', 'date', 'project_id', 'summary_raw']) {
              if (action[key] !== undefined) { fields.push(`${key} = $${values.length + 1}`); values.push(action[key]); }
            }
            if (fields.length > 0) {
              values.push(action['meeting_id']);
              await execute(`UPDATE meetings SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
            }
            if (Array.isArray(action['person_ids'])) {
              await execute('DELETE FROM meeting_people WHERE meeting_id = $1', [action['meeting_id']]);
              for (const pid of action['person_ids'] as number[]) {
                await execute('INSERT INTO meeting_people (meeting_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [action['meeting_id'], pid]);
              }
            }
            results.push(`✅ Встреча #${action['meeting_id']} обновлена`);
            break;
          }
          case 'delete_meeting': {
            await execute('DELETE FROM meeting_people WHERE meeting_id = $1', [action['meeting_id']]);
            await execute('DELETE FROM meetings WHERE id = $1', [action['meeting_id']]);
            results.push(`🗑 Встреча #${action['meeting_id']} удалена`);
            break;
          }
          case 'set_focus': {
            const date = action['date'] as string;
            const focus = action['focus'] as string;
            if (date && focus) {
              const existingFocus = await queryOne<{ id: number }>('SELECT id FROM journal WHERE date = $1 AND user_id = $2', [date, userId]);
              if (existingFocus) {
                await execute('UPDATE journal SET focus = $1 WHERE date = $2 AND user_id = $3', [focus, date, userId]);
              } else {
                await execute('INSERT INTO journal (date, focus, user_id) VALUES ($1, $2, $3)', [date, focus, userId]);
              }
              results.push(`🎯 Фокус на ${date}: ${focus}`);
            }
            break;
          }
          case 'create_person': {
            const name = action['name'] as string;
            if (!name) { results.push('❌ Не указано имя'); break; }
            const existingP = await queryOne<{ id: number }>('SELECT id FROM people WHERE LOWER(name) = LOWER($1) AND user_id = $2', [name, userId]);
            let personId: number;
            if (existingP) {
              personId = existingP.id;
              // Update fields if provided
              for (const key of ['phone', 'email', 'telegram', 'company', 'role', 'notes']) {
                if (action[key]) await execute(`UPDATE people SET ${key} = $1 WHERE id = $2`, [action[key], personId]);
              }
            } else {
              const personIns = await queryOne<{ id: number }>(
                'INSERT INTO people (name, company, role, phone, email, telegram, notes, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
                [name, (action['company'] as string) ?? '', (action['role'] as string) ?? '', (action['phone'] as string) ?? '',
                (action['email'] as string) ?? '', (action['telegram'] as string) ?? '', (action['notes'] as string) ?? '', userId]
              );
              personId = personIns!.id;
            }
            if (action['project_id']) {
              try { await execute('INSERT INTO people_projects (person_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [personId, action['project_id']]); } catch {}
            }
            this.lastCreatedPerson.set(userId ?? 0, { id: personId, name, ts: Date.now() });
            results.push(`✅ Контакт "${name}" ${existingP ? 'обновлён' : 'создан'}${action['project_id'] ? ' + привязан к проекту' : ''}`);
            break;
          }
          case 'update_person': {
            const pid = action['person_id'] as number;
            if (!pid) { results.push('❌ Не указан person_id'); break; }
            const fields: string[] = [];
            const values: unknown[] = [];
            for (const f of ['name', 'company', 'role', 'phone', 'email', 'telegram', 'notes']) {
              if (action[f] !== undefined && action[f] !== '') { fields.push(`${f} = $${values.length + 1}`); values.push(action[f]); }
            }
            if (fields.length > 0) {
              values.push(pid, userId);
              await execute(`UPDATE people SET ${fields.join(', ')} WHERE id = $${values.length - 1} AND user_id = $${values.length}`, values);
            }
            if (action['project_id']) {
              try { await execute('INSERT INTO people_projects (person_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [pid, action['project_id']]); } catch {}
            }
            const pNameRow = await queryOne<{ name: string }>('SELECT name FROM people WHERE id = $1', [pid]);
            const pName = pNameRow?.name ?? `#${pid}`;
            results.push(`✅ Контакт "${pName}" обновлён`);
            break;
          }
          case 'delete_person': {
            const pid = action['person_id'] as number;
            const personCheck = await queryOne<{ id: number }>('SELECT id FROM people WHERE id = $1 AND user_id = $2', [pid, userId]);
            if (personCheck) {
              await execute('DELETE FROM task_people WHERE person_id = $1', [pid]);
              await execute('DELETE FROM meeting_people WHERE person_id = $1', [pid]);
              await execute('DELETE FROM people_projects WHERE person_id = $1', [pid]);
              await execute('DELETE FROM people WHERE id = $1 AND user_id = $2', [pid, userId]);
              results.push(`🗑 Контакт #${pid} удалён`);
            } else {
              results.push(`❌ Контакт #${pid} не найден`);
            }
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

  /** Transcribe audio via OpenAI Whisper API (pro mode) */
  private async transcribeProAudio(buffer: Buffer, filename: string): Promise<string> {
    const { transcribeWithOpenAI } = require('./whisper-queue');
    return transcribeWithOpenAI(buffer, filename);
  }

  /** Transcribe audio — queued with concurrency limit, OpenAI overflow */
  private async transcribeAudio(buffer: Buffer, filename: string): Promise<string> {
    const { transcribeWithOverflow, getQueueStatus } = require('./whisper-queue');
    const status = getQueueStatus();
    if (status.queued > 0) {
      console.log(`[whisper] queue status: ${status.active} active, ${status.queued} waiting`);
    }
    return transcribeWithOverflow(buffer, filename);
  }

  start(): void {
    if (!config.telegramBotToken) {
      console.log('[telegram] no token, bot disabled');
      return;
    }

    // handlerTimeout: Infinity — long-running handlers (whisper on 15+ min audio,
    // AI command chains) must not be killed mid-flight.
    // TELEGRAM_LOCAL_API_ROOT — point to local Bot API server to remove 20MB file limit.
    const localApiRoot = process.env.TELEGRAM_LOCAL_API_ROOT;
    const tgOpts: any = { handlerTimeout: Infinity };
    if (localApiRoot) {
      tgOpts.telegram = { apiRoot: localApiRoot };
      console.log(`[telegram] using local Bot API: ${localApiRoot}`);
    }
    this.bot = new Telegraf(config.telegramBotToken, tgOpts);

    this.bot.catch((err: unknown) => {
      console.error('[telegram] bot error:', err instanceof Error ? err.message : err);
    });

    // /start
    this.bot.command('start', async (ctx) => {
      const tgId = ctx.from?.id ?? 0;
      const existing = await queryOne<{ id: number; name: string }>("SELECT id, name FROM users WHERE tg_id = $1", [String(tgId)]);

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
        // Not linked — must login with existing account
        ctx.reply(
          '👋 Добро пожаловать в Clarity Space!\n\n' +
          'Для начала привяжите свой аккаунт:\n\n' +
          '1️⃣ Зарегистрируйтесь на сайте: https://clarity-space.ru\n' +
          '2️⃣ Нажмите /login и введите email и пароль\n\n' +
          'После привязки бот будет работать с вашими задачами, встречами и проектами.',
          Markup.inlineKeyboard([
            [Markup.button.callback('🔑 Привязать аккаунт', 'onboard_login')],
          ])
        );
      }
    });

    // Callback: link existing account → ask email
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
    this.bot.command('login', async (ctx) => {
      const parts = ctx.message.text.replace(/^\/login\s*/, '').trim().split(/\s+/);
      const email = (parts[0] || '').toLowerCase();
      const password = parts[1] || '';
      if (!email || !password) {
        ctx.reply('Формат: /login email пароль\n\nПример: /login alex@mail.com 123456\n\nПривяжет Telegram к аккаунту на сайте. Все данные подтянутся автоматически.');
        return;
      }
      const tgId = String(ctx.from?.id ?? '');
      const existingUser = await queryOne<{ id: number; name: string; email: string; password_hash: string; tg_id: string | null }>('SELECT id, name, email, password_hash, tg_id FROM users WHERE email = $1', [email]);
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
      const autoAccount = await queryOne<{ id: number }>("SELECT id FROM users WHERE tg_id = $1 AND email LIKE '%@telegram.local'", [tgId]);
      if (autoAccount && autoAccount.id !== existingUser.id) {
        for (const table of ['tasks', 'projects', 'meetings', 'people', 'ideas', 'documents', 'habits', 'goals', 'journal']) {
          try { await execute(`UPDATE ${table} SET user_id = $1 WHERE user_id = $2`, [existingUser.id, autoAccount.id]); } catch {}
        }
        await execute('DELETE FROM users WHERE id = $1', [autoAccount.id]);
      }
      await execute('UPDATE users SET tg_id = $1 WHERE id = $2', [tgId, existingUser.id]);
      ctx.reply(`✅ Готово! Telegram привязан к ${existingUser.name} (${existingUser.email}).\n\nВсе данные подтянулись. Можешь пользоваться!`);
      // Delete the message with password for security
      try { ctx.deleteMessage(ctx.message.message_id); } catch {}
    });

    // /cmd — execute command via AI
    this.bot.command('cmd', async (ctx) => {
      const text = ctx.message.text.replace(/^\/cmd\s*/, '').trim();
      if (!text) { ctx.reply('Формат: /cmd создай задачу купить молоко'); return; }
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
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
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const text = ctx.message.text.replace(/^\/bundle\s*/, '').trim();
      if (!text) {
        ctx.reply('Формат:\n/bundle <название проекта>\n/bundle все\n\nПримеры:\n/bundle Атланты\n/bundle Robots\n\nОтправлю файлы: PDF, DOCX, MD');
        return;
      }
      try {
        ctx.reply('📦 Собираю bundle и конвертирую...');
        const match = await findProjectByName(text);
        if (match === null) {
          ctx.reply(`❌ Проект "${text}" не найден`);
          return;
        }
        const result = await generateBundle(match);
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
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
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
          const openai = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl });
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
        const result = await ingestService.ingestText(transcript, userId);
        await sendLong(ctx, await formatIngestResult(result));
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    });

    // /habits — today's habits
    this.bot.command('habits', async (ctx) => {
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const habits = await queryAll<{ id: number; title: string; icon: string }>("SELECT id, title, icon FROM habits WHERE archived = 0 AND user_id = $1", [userId]);
      if (habits.length === 0) { ctx.reply('🔥 Нет привычек. Добавь в /app → Привычки'); return; }
      const today = moscowDateString();
      const logs = await queryAll<{ habit_id: number }>("SELECT habit_id FROM habit_logs WHERE date = $1", [today]);
      const doneSet = new Set(logs.map(l => l.habit_id));
      const lines = habits.map(h => `${doneSet.has(h.id) ? '✅' : '⬜'} ${h.icon} ${h.title}`);
      ctx.reply(`🔥 Привычки (${doneSet.size}/${habits.length}):\n\n${lines.join('\n')}\n\nОтметить: "отметь привычку Медитация"`);
    });

    this.bot.command('meetings', async (ctx) => {
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const meetings = await queryAll<{ title: string; date: string; project_name: string | null }>("SELECT m.title, m.date, p.name as project_name FROM meetings m LEFT JOIN projects p ON m.project_id = p.id WHERE m.user_id = $1 ORDER BY m.date DESC LIMIT 10", [userId]);
      if (meetings.length === 0) { ctx.reply('Нет встреч'); return; }
      const lines = meetings.map(m => `📅 ${m.date} — ${m.title}${m.project_name ? ` [${m.project_name}]` : ''}`);
      ctx.reply(`🤝 Последние встречи:\n\n${lines.join('\n')}`);
    });

    // /tasks — today's tasks
    this.bot.command('tasks', async (ctx) => {
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const tasks = await queryAll<{ title: string; status: string; priority: number; due_date: string | null; project_id: number | null }>(
        "SELECT title, status, priority, due_date, project_id FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND user_id = $1 ORDER BY priority DESC LIMIT 20",
        [userId]
      );

      if (tasks.length === 0) {
        ctx.reply('Нет активных задач!');
        return;
      }

      const projectMap = new Map(
        (await queryAll<{ id: number; name: string }>('SELECT id, name FROM projects', [])).map(p => [p.id, p.name])
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
    this.bot.command('all', async (ctx) => {
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const tasks = await queryAll<{ title: string; status: string; priority: number }>(
        "SELECT title, status, priority FROM tasks WHERE archived = 0 AND user_id = $1 ORDER BY status, priority DESC",
        [userId]
      );

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
    this.bot.command('projects', async (ctx) => {
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId
      const projects = await queryAll<{ name: string; status: string }>(
        "SELECT name, status, color FROM projects WHERE archived = 0 AND user_id = $1 ORDER BY order_index ASC",
        [userId]
      );

      const lines = projects.map(p => `• ${p.name} (${p.status})`);
      ctx.reply(`📁 Проекты:\n\n${lines.join('\n')}` || 'Нет проектов');
    });

    // /add <title> — quick add task
    this.bot.command('add', async (ctx) => {
      const text = ctx.message.text.replace(/^\/add\s*/, '').trim();
      if (!text) { ctx.reply('Формат: /add Название задачи'); return; }
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId

      const taskIns = await queryOne<{ id: number }>('INSERT INTO tasks (title, status, priority, user_id) VALUES ($1, $2, $3, $4) RETURNING id', [text, 'todo', 3, userId]);
      const tid = taskIns!.id;
      const selfRow = await queryOne<{ id: number }>("SELECT id FROM people WHERE LOWER(name) IN ('я','me','self') LIMIT 1");
      if (selfRow) await execute('INSERT INTO task_people (task_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [tid, selfRow.id]);
      ctx.reply(`✅ Задача добавлена: ${text}`);
    });

    // /focus — show or set today's focus
    this.bot.command('focus', async (ctx) => {
      const tgId = ctx.from?.id ?? 0;
      const userId = await this.resolveUserId(tgId);
      if (!userId) return;
      const text = ctx.message.text.replace(/^\/focus\s*/, '').trim();
      const today = moscowDateString();

      if (!text) {
        const journal = await queryOne<{ focus: string }>('SELECT focus FROM journal WHERE date = $1 AND user_id = $2', [today, userId]);
        if (journal?.focus) {
          await ctx.reply(`🎯 Фокус сегодня: ${journal.focus}\n\nИзменить: /focus <новый фокус>`);
        } else {
          await ctx.reply('🎯 Фокус на сегодня не задан.\n\nПоставить: /focus контент и видео');
        }
        return;
      }

      const existingFocus = await queryOne<{ id: number }>('SELECT id FROM journal WHERE date = $1 AND user_id = $2', [today, userId]);
      if (existingFocus) {
        await execute('UPDATE journal SET focus = $1 WHERE date = $2 AND user_id = $3', [text, today, userId]);
      } else {
        await execute('INSERT INTO journal (date, focus, user_id) VALUES ($1, $2, $3)', [today, text, userId]);
      }
      await ctx.reply(`🎯 Фокус на ${today}: ${text}`);
    });

    // /brief — daily brief (achievements first!)
    this.bot.command('brief', async (ctx) => {
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      const today = moscowDateString();
      const tasks = await queryAll<{ title: string; priority: number; due_date: string | null }>(
        "SELECT title, status, priority, due_date FROM tasks WHERE archived = 0 AND status NOT IN ('done', 'someday') AND user_id = $1 ORDER BY priority DESC LIMIT 10",
        [userId]
      );
      const meetings = await queryAll<{ title: string; date: string }>(
        'SELECT title, date FROM meetings WHERE date >= $1 AND user_id = $2 ORDER BY date ASC LIMIT 5',
        [today, userId]
      );

      // Achievements
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgoDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const doneRecently = await queryOne<{ c: string }>(
        "SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND archived = 0 AND updated_at >= $1 AND user_id = $2",
        [oneDayAgo, userId]
      );
      const habitsDoneToday = await queryAll<{ title: string; icon: string }>(
        `SELECT h.title, h.icon FROM habits h
        WHERE h.archived = 0 AND h.user_id = $1 AND h.id IN (
          SELECT habit_id FROM habit_logs WHERE date = $2 AND completed = 1
        )`,
        [userId, today]
      );
      const topStreaks = await queryAll<{ title: string; icon: string; cnt: string }>(
        `SELECT h.title, h.icon,
          (SELECT COUNT(*) FROM habit_logs hl WHERE hl.habit_id = h.id AND hl.completed = 1 AND hl.date >= $2) as cnt
        FROM habits h WHERE h.archived = 0 AND h.user_id = $1 ORDER BY cnt DESC LIMIT 3`,
        [userId, thirtyDaysAgoDate]
      );
      const overdue = tasks.filter(t => t.due_date && t.due_date < today);

      let brief = '🌅 Доброе утро!\n\n';

      // Achievements first
      const wins: string[] = [];
      if (Number(doneRecently?.c ?? 0) > 0) wins.push(`✅ Закрыто задач за последние сутки: ${doneRecently!.c}`);
      if (habitsDoneToday.length > 0) wins.push(`🔥 Привычки сегодня: ${habitsDoneToday.map(h => `${h.icon || '✓'} ${h.title}`).join(', ')}`);
      for (const s of topStreaks.filter(s => Number(s.cnt) >= 5)) {
        wins.push(`🏆 ${s.icon || '✓'} ${s.title} — ${s.cnt} дней за месяц!`);
      }

      if (wins.length > 0) {
        brief += '💪 Твои успехи:\n';
        brief += wins.map(w => `  ${w}`).join('\n') + '\n\n';
      }

      // Then status
      brief += `📋 Активных задач: ${tasks.length}\n`;
      brief += `📅 Предстоящих встреч: ${meetings.length}\n`;
      if (overdue.length > 0) brief += `⏰ Просроченных: ${overdue.length}\n`;
      brief += '\n';

      if (tasks.length > 0) {
        brief += 'Приоритетные задачи:\n';
        for (const t of tasks.slice(0, 7)) {
          brief += `  • ${t.title} ${'⭐'.repeat(t.priority)}\n`;
        }
      }

      if (tasks.length === 0 && meetings.length === 0) {
        brief += '\n🎉 Свободный день! Хочешь закинуть задачу или встречу?';
      } else {
        brief += '\nПродуктивного дня! 🚀';
      }

      ctx.reply(brief);
    });

    // /search <query>
    this.bot.command('search', async (ctx) => {
      const query = ctx.message.text.replace(/^\/search\s*/, '').trim();
      if (!query) { ctx.reply('Формат: /search ключевое слово'); return; }
      const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { searchService } = require('./search.service');
      const results = await searchService.search(query, 10, userId);
      if (results.length === 0) { ctx.reply('Ничего не найдено'); return; }

      const lines = results.map((r: { type: string; title: string }) => `[${r.type}] ${r.title}`);
      ctx.reply(`🔍 Результаты:\n\n${lines.join('\n')}`);
    });

    // /settings — per-user settings (e.g. reminder_time)
    this.bot.command('settings', async (ctx) => {
      const tgId = ctx.from?.id ?? 0;
      const userId = await this.resolveUserId(tgId, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      if (!userId) return;
      const text = ctx.message.text.replace(/^\/settings\s*/, '').trim();
      if (!text) {
        const rows = await queryAll<{ key: string; value: string }>('SELECT key, value FROM settings WHERE user_id = $1', [userId]);
        if (rows.length === 0) {
          await ctx.reply('⚙️ Настройки пусты. Доступные:\n/settings reminder_time 21:00');
          return;
        }
        const lines = rows.map(r => `• ${r.key} = ${r.value}`);
        await ctx.reply(`⚙️ Настройки:\n${lines.join('\n')}\n\nИзменить: /settings <key> <value>`);
        return;
      }

      const parts = text.split(/\s+/);
      const key = parts[0]!;
      const value = parts.slice(1).join(' ');
      if (!value) {
        const row = await queryOne<{ value: string }>('SELECT value FROM settings WHERE user_id = $1 AND key = $2', [userId, key]);
        await ctx.reply(`Текущее значение: ${row?.value ?? 'не задано'}`);
        return;
      }

      await execute('INSERT INTO settings (key, value, user_id) VALUES ($1, $2, $3) ON CONFLICT(key, user_id) DO UPDATE SET value = $4', [key, value, userId, value]);
      await ctx.reply(`✅ ${key} = ${value}`);
    });

    // /pro — next audio will use OpenAI Whisper API for high-quality transcription
    this.bot.command('pro', (ctx) => {
      const tgId = ctx.from?.id ?? 0;
      this.proMode.add(tgId);
      ctx.reply('🎯 PRO-режим активирован.\n\nОтправьте голосовое или аудиофайл — расшифровка будет через OpenAI Whisper API (высокое качество).\n\nРежим действует для следующей одной записи.');
    });

    // /lecture — next audio transcription formatted as lecture, not meeting
    this.bot.command('lecture', (ctx) => {
      const tgId = ctx.from?.id ?? 0;
      this.contentType.set(tgId, 'lecture');
      ctx.reply('🎓 Режим лекции активирован.\n\nСледующая запись будет оформлена как учебный материал:\n• Оглавление по темам\n• Тезисы и ключевые идеи\n• Определения и термины\n• Выводы\n\nОтправьте аудио или голосовое.');
    });

    // /interview — next audio transcription formatted as interview
    this.bot.command('interview', (ctx) => {
      const tgId = ctx.from?.id ?? 0;
      this.contentType.set(tgId, 'interview');
      ctx.reply('🎙️ Режим интервью активирован.\n\nСледующая запись будет оформлена как интервью:\n• Профиль гостя\n• Ключевые инсайты и цитаты\n• Советы и рекомендации\n• Что применить\n\nОтправьте аудио или голосовое.');
    });

    // /menu — show action menu
    this.bot.command('menu', (ctx) => {
      ctx.reply('📋 Выберите действие:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎤 Встреча', callback_data: 'menu_meeting' }, { text: '🎓 Лекция', callback_data: 'menu_lecture' }, { text: '🎙️ Интервью', callback_data: 'menu_interview' }],
            [{ text: '📋 Задачи на сегодня', callback_data: 'menu_tasks' }, { text: '🌅 Брифинг', callback_data: 'menu_brief' }],
            [{ text: '🔥 Привычки', callback_data: 'menu_habits' }, { text: '📅 Встречи', callback_data: 'menu_meetings' }],
            [{ text: '📱 Открыть приложение', url: config.webappUrl }],
          ],
        },
      });
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
    const formatIngestResult = async (result: { detected_type: string; summary: string; created_records: Array<{ type: string; id: number; title: string }> }): Promise<string> => {
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
          const m = await queryOne<{ project_id: number | null }>('SELECT project_id FROM meetings WHERE id = $1', [mainRec.id]);
          if (m?.project_id) {
            const p = await queryOne<{ name: string }>('SELECT name FROM projects WHERE id = $1', [m.project_id]);
            if (p) msg += `\n📁 Проект: ${p.name}`;
          }
          const people = await queryAll<{ name: string }>('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = $1', [mainRec.id]);
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

    // Inline button callbacks (draft card actions)
    this.bot.on('callback_query', async (ctx) => {
      const data = (ctx.callbackQuery as any).data as string;
      if (!data) { await ctx.answerCbQuery(); return; }

      // Habit check-in callbacks
      if (data.startsWith('habit_done:')) {
        const parts = data.split(':');
        const habitId = Number(parts[1]);
        const date = parts[2]!;
        const tgId = ctx.from!.id;
        await ctx.answerCbQuery('✅');
        try {
          const userId = await this.resolveUserId(tgId, ctx.from?.first_name);
          const existing = await queryOne('SELECT id FROM habit_logs WHERE habit_id = $1 AND date = $2', [habitId, date]);
          if (!existing) {
            await execute('INSERT INTO habit_logs (habit_id, date, completed) VALUES ($1, $2, 1)', [habitId, date]);
          }
          const habit = await queryOne<{ title: string; icon: string }>('SELECT title, icon FROM habits WHERE id = $1 AND user_id = $2', [habitId, userId]);
          if (habit) {
            // Update the button text to show it's done
            try {
              const msg = ctx.callbackQuery.message;
              if (msg && 'text' in msg) {
                const newText = msg.text.replace(`⬜ ${habit.icon} ${habit.title}`, `✅ ${habit.icon} ${habit.title}`);
                // Remove the clicked button from keyboard
                const keyboard = (msg as any).reply_markup?.inline_keyboard?.filter(
                  (row: any[]) => !row.some((btn: any) => btn.callback_data === data)
                ) || [];
                await ctx.editMessageText(newText, {
                  parse_mode: 'HTML',
                  reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
                });
              }
            } catch {}
            // Check if all habits done
            const remaining = await queryAll<{ id: number }>(
              "SELECT h.id FROM habits h WHERE h.archived = 0 AND h.frequency = 'daily' AND h.user_id = $1 AND NOT EXISTS (SELECT 1 FROM habit_logs hl WHERE hl.habit_id = h.id AND hl.date = $2)",
              [userId, date]
            );
            if (remaining.length === 0) {
              await ctx.reply('🎉 Все привычки на сегодня выполнены! Молодец! 💪');
            }
          }
        } catch (err) {
          console.error('[habit_done callback]', err);
        }
        return;
      }

      // Menu button callbacks
      if (data.startsWith('menu_')) {
        const tgId = ctx.from!.id;
        await ctx.answerCbQuery();
        switch (data) {
          case 'menu_lecture':
            this.contentType.set(tgId, 'lecture');
            await ctx.reply('🎓 Режим лекции активирован. Отправьте аудио или голосовое.');
            return;
          case 'menu_interview':
            this.contentType.set(tgId, 'interview');
            await ctx.reply('🎙️ Режим интервью активирован. Отправьте аудио или голосовое.');
            return;
          case 'menu_meeting':
            this.contentType.delete(tgId); // default = meeting
            await ctx.reply('🎤 Отправьте аудио или голосовое для транскрибации встречи.');
            return;
          case 'menu_tasks': {
            const userId = await this.resolveUserId(tgId, ctx.from?.first_name);
            const today = moscowDateString();
            const tasks = await queryAll<{ title: string; priority: number }>("SELECT title, priority FROM tasks WHERE archived = 0 AND status NOT IN ('done','someday') AND (due_date = $1 OR status = 'in_progress') AND user_id = $2 ORDER BY priority DESC LIMIT 10", [today, userId]);
            await ctx.reply(tasks.length > 0 ? `📋 Задачи:\n${tasks.map(t => `  • ${t.title} ${'⭐'.repeat(t.priority)}`).join('\n')}` : '✅ Нет активных задач на сегодня!');
            return;
          }
          case 'menu_brief':
            // Trigger /brief handler
            await (ctx as any).reply('/brief загружается...'); // placeholder
            return;
          case 'menu_habits': {
            const userId = await this.resolveUserId(tgId, ctx.from?.first_name);
            const today = moscowDateString();
            const habits = await queryAll<{ title: string; icon: string; done: number }>("SELECT h.title, h.icon, CASE WHEN hl.id IS NOT NULL THEN 1 ELSE 0 END as done FROM habits h LEFT JOIN habit_logs hl ON hl.habit_id = h.id AND hl.date = $1 AND hl.completed = 1 WHERE h.archived = 0 AND h.user_id = $2", [today, userId]);
            await ctx.reply(habits.length > 0 ? `🔥 Привычки:\n${habits.map(h => `  ${h.done ? '✅' : '⬜'} ${h.icon || '•'} ${h.title}`).join('\n')}` : '🌱 Нет привычек. Создай в приложении!');
            return;
          }
          case 'menu_meetings': {
            const userId = await this.resolveUserId(tgId, ctx.from?.first_name);
            const today = moscowDateString();
            const meetings = await queryAll<{ title: string; date: string }>("SELECT title, date FROM meetings WHERE date >= $1 AND user_id = $2 ORDER BY date ASC LIMIT 5", [today, userId]);
            await ctx.reply(meetings.length > 0 ? `📅 Встречи:\n${meetings.map(m => `  • ${m.date} — ${m.title}`).join('\n')}` : '📅 Нет предстоящих встреч');
            return;
          }
        }
      }

      const parsed = parseCallbackData(data);
      if (!parsed) { await ctx.answerCbQuery('Неверный формат'); return; }
      const tgId = ctx.from!.id;
      const draft = this.drafts.get(tgId);
      if (!draft || draft.id !== parsed.draftId) {
        await ctx.answerCbQuery('Драфт устарел');
        return;
      }
      switch (parsed.action) {
        case 'ok': {
          await this.saveDraftAsIs(draft);
          this.drafts.close(tgId);
          await ctx.answerCbQuery('Сохранено');
          try { await ctx.editMessageReplyMarkup(undefined as any); } catch {}
          await ctx.reply(`✅ Сохранено: ${draft.title}`);
          break;
        }
        case 'fix': {
          this.drafts.update(tgId, { awaitingEdit: true });
          await ctx.answerCbQuery('Жду правку');
          await ctx.reply('Что поменять? Напиши или надиктуй.');
          break;
        }
        case 'cancel': {
          const obsidian = new ObsidianService(config.vaultPath).forUser(draft.userId);
          await obsidian.writeInboxItem(`${draft.date}-отменённый-драфт-${draft.id.slice(0, 8)}.txt`, draft.transcript);
          this.drafts.close(tgId);
          await ctx.answerCbQuery('Отменено');
          try { await ctx.editMessageReplyMarkup(undefined as any); } catch {}
          await ctx.reply('❌ Отменено, транскрипт сохранён в Inbox.');
          break;
        }
        case 'as-meeting':
        case 'as-task':
        case 'as-idea': {
          const newType = parsed.action.replace('as-', '') as DraftCard['type'];
          const newTags = draft.tags.map((t) => t.startsWith('type/') ? `type/${newType}` : t);
          if (!newTags.some((t) => t.startsWith('type/'))) newTags.unshift(`type/${newType}`);
          const updated = this.drafts.update(tgId, { type: newType, tags: newTags });
          if (updated?.cardMessageId) {
            try {
              await ctx.telegram.editMessageText(
                ctx.chat!.id, updated.cardMessageId, undefined,
                renderDraftCard(updated),
                { reply_markup: inlineKeyboard(updated) },
              );
            } catch {}
          }
          await ctx.answerCbQuery(`Тип: ${newType}`);
          break;
        }
      }
    });

    // Any text message → smart routing
    this.bot.on(message('text'), async (ctx) => {
      const text = ctx.message.text;
      if (text.startsWith('/')) return;

      const tgId = ctx.from?.id ?? 0;
      // Clear pro mode if user sends text instead of audio
      this.proMode.delete(tgId);

      // Handle login flow (email → password)
      const loginState = this.pendingLogins.get(tgId);
      if (loginState === 'email') {
        const email = text.trim().toLowerCase();
        if (!email.includes('@')) { ctx.reply('❌ Введи корректный email:'); return; }
        const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
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
        const user = await queryOne<{ id: number; name: string; email: string; password_hash: string }>('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);
        if (!user) { ctx.reply('❌ Ошибка. Нажми /start'); return; }
        const bcrypt = require('bcryptjs');
        if (!bcrypt.compareSync(text, user.password_hash)) { ctx.reply('❌ Неверный пароль. Нажми /start чтобы попробовать снова.'); return; }
        // Link tg_id and merge auto-account if exists
        const autoAccount = await queryOne<{ id: number }>("SELECT id FROM users WHERE tg_id = $1 AND email LIKE '%@telegram.local'", [String(tgId)]);
        if (autoAccount && autoAccount.id !== user.id) {
          for (const table of ['tasks', 'projects', 'meetings', 'people', 'ideas', 'documents', 'habits', 'goals', 'journal']) {
            try { await execute(`UPDATE ${table} SET user_id = $1 WHERE user_id = $2`, [user.id, autoAccount.id]); } catch {}
          }
          await execute('DELETE FROM users WHERE id = $1', [autoAccount.id]);
        }
        await execute('UPDATE users SET tg_id = $1 WHERE id = $2', [String(tgId), user.id]);
        // Delete password message
        try { ctx.deleteMessage(ctx.message.message_id); } catch {}
        ctx.reply(`✅ Готово! Привет, ${user.name}!\n\nТвой аккаунт привязан. Все данные подтянулись.\n\nПросто пиши — я пойму!`);
        return;
      }

      const userId = await this.resolveUserId(tgId, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
      // userId auto-created by resolveUserId

      // If there's an open draft — ANY text is treated as correction (no need to press ✏️ first)
      // Check if user just created a contact and replies with project name
      const lastPerson = this.lastCreatedPerson.get(tgId);
      if (lastPerson && text.length < 100) {
        const allProjects = await queryAll<{ id: number; name: string }>('SELECT id, name FROM projects WHERE user_id = $1 AND archived = 0', [userId]);
        const hint = text.toLowerCase().replace(/^(к проекту|проект|привяжи к)\s*/i, '').trim();
        const match = allProjects.find(p => p.name.toLowerCase() === hint || p.name.toLowerCase().includes(hint) || hint.includes(p.name.toLowerCase()));
        if (match) {
          await execute('UPDATE people SET project_id = $1 WHERE id = $2', [match.id, lastPerson.id]);
          try { await execute('INSERT INTO people_projects (person_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [lastPerson.id, match.id]); } catch {}
          this.lastCreatedPerson.delete(tgId);
          ctx.reply(`✅ ${lastPerson.name} привязан(а) к проекту ${match.name}`);
          return;
        }
        this.lastCreatedPerson.delete(tgId);
      }

      const draft = this.drafts.get(tgId);
      console.log(`[bot] text from tgId=${tgId}, draft=${draft ? `exists (${draft.title})` : 'none'}, text="${text.slice(0, 50)}"`);
      if (draft) {
        console.log(`[bot] applying correction to draft: ${draft.title}`);
        try {
          await this.applyCorrection(ctx, draft, text);
        } catch (err) {
          console.error('[bot] applyCorrection failed:', err);
          ctx.reply(`❌ Не удалось применить коррекцию: ${err instanceof Error ? err.message : 'Unknown'}\n\nПопробуй ещё раз или нажми ОК.`);
        }
        return;
      }

      // If lecture/interview mode was set and text is long enough — treat as transcript
      const pendingContentType = this.contentType.get(tgId);
      if (pendingContentType && text.length > 200) {
        console.log(`[bot] contentType=${pendingContentType}, treating text as transcript (${text.length} chars)`);
        await this.buildAndSendDraft(ctx, tgId, userId, 'text', text, null);
        return;
      }

      // Check if user is referencing a recent action (e.g. "в последней встрече поставь проект X")
      const recent = this.recentActions.get(tgId);
      if (recent && recent.length > 0) {
        const refMatch = text.match(/послед(?:н|ую|ей|яя|юю|ий)|предыдущ|только что|эт(?:у|ой|а|о) встреч|эт(?:у|ой|а|о) задач|эт(?:у|ой|а|о) иде/i);
        if (refMatch) {
          const lastAction = recent[0]!;
          const claude = new ClaudeService();
          try {
            const patchPrompt = `Пользователь хочет внести изменения в недавно сохранённую запись.

Запись:
- Тип: ${lastAction.type}
- Название: "${lastAction.title}"
- ID: ${lastAction.id}
- Таблица: ${lastAction.table}
- Дата: ${lastAction.date}

Запрос пользователя: "${text}"

Верни JSON: {"action": "update", "field_updates": {"project": "...", "company": "...", "people_add": ["..."], "tags_add": ["..."], "title": "...", "type": "..."}}
Включай ТОЛЬКО поля которые пользователь хочет изменить. Если поле не упомянуто — не включай. СТРОГО JSON.`;

            const resp = await claude.openai.chat.completions.create({
              model: 'gpt-4.1-mini',
              temperature: 0.1,
              messages: [{ role: 'system', content: 'Ты парсишь запросы на редактирование записей. Отвечаешь СТРОГО JSON.' }, { role: 'user', content: patchPrompt }],
              response_format: { type: 'json_object' },
            });
            const patch = JSON.parse(resp.choices[0]?.message?.content ?? '{}');

            if (patch.field_updates && Object.keys(patch.field_updates).length > 0) {
              const updates: string[] = [];
              const fu = patch.field_updates;

              if (fu.project) {
                const proj = await queryOne<{ id: number; name: string }>('SELECT id, name FROM projects WHERE user_id = $1 AND LOWER(name) LIKE LOWER($2)', [userId, `%${fu.project}%`]);
                if (proj) {
                  await execute(`UPDATE ${lastAction.table} SET project_id = $1 WHERE id = $2 AND user_id = $3`, [proj.id, lastAction.id, userId]);
                  updates.push(`проект → ${proj.name}`);
                } else {
                  updates.push(`проект "${fu.project}" не найден в базе`);
                }
              }
              if (fu.type && fu.type !== lastAction.type) {
                updates.push(`тип изменён: ${lastAction.type} → ${fu.type} (требует ручной миграции)`);
              }

              if (updates.length > 0) {
                await ctx.reply(`✏️ Обновил "${lastAction.title}":\n${updates.map((u: string) => `• ${u}`).join('\n')}`);
              } else {
                await ctx.reply(`Не смог определить что именно изменить в "${lastAction.title}". Уточни.`);
              }
              return;
            }
          } catch (err) {
            console.error('[recent-action] parse failed:', err);
          }
        }
      }

      // Check for claude/клод prefix → save for Claude Code processing
      const claudeMatch = text.match(/^(клод|claude)[:\s,-]+([\s\S]+)$/i);
      if (claudeMatch) {
        const content = claudeMatch[2]!.trim();
        await execute('INSERT INTO claude_notes (content, source) VALUES ($1, $2)', [content, 'telegram']);
        const pendingRow = await queryOne<{ c: string }>('SELECT COUNT(*) as c FROM claude_notes WHERE processed = 0');
        const pending = Number(pendingRow?.c ?? 0);
        ctx.reply(`📝 Заметка сохранена для Claude Code\n📬 В очереди: ${pending}\n\nСкажи мне в Claude Code "обработай заметки" — разложу всё по Obsidian`);
        return;
      }

      try {
        const intent = await this.classifyMessage(text, ctx.from?.id);
        if (intent === 'command' || intent === 'chat') {
          const lc = this.lastCreatedPerson.get(tgId);
          const response = await this.executeCommand(text, ctx.from?.id, lc && Date.now() - (lc as any).ts < 120000 ? lc : undefined);
          await sendCommandResult(ctx, response);
        } else {
          const ingestService = new IngestService();
          const result = await ingestService.ingestText(text, userId);
          await sendLong(ctx, await formatIngestResult(result));
        }
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Voice message → transcribe first, then decide
    this.bot.on(message('voice'), async (ctx) => {
      try {
        const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        // userId auto-created by resolveUserId

        const tgId = ctx.from?.id ?? 0;
        const isPro = this.proMode.has(tgId);
        if (isPro) {
          this.proMode.delete(tgId);
          ctx.reply('🎯 PRO: Транскрибирую через OpenAI Whisper...');
        } else {
          const { getQueueStatus } = require('./whisper-queue');
          const qStatus = getQueueStatus();
          if (qStatus.active >= 2 && qStatus.queued > 0) {
            ctx.reply(`🎤 В очереди (позиция ${qStatus.queued + 1}). Транскрибирую когда освободится...`);
          } else if (qStatus.active >= 2) {
            ctx.reply('🎤 Транскрибирую (очередь занята, может занять дольше)...');
          } else {
            ctx.reply('🎤 Транскрибирую...');
          }
        }
        const fileId = ctx.message.voice.file_id;
        const buffer = await this.downloadTelegramFile(ctx, fileId);

        // Transcribe via Whisper (pro → OpenAI, normal → local)
        const transcript = isPro
          ? await this.transcribeProAudio(buffer, 'voice.ogg')
          : await this.transcribeAudio(buffer, 'voice.ogg');
        if (!transcript.trim()) { ctx.reply('⚠️ Не удалось распознать речь'); return; }

        // Show transcript
        ctx.reply(`📝 Распознано:\n${transcript}`);

        // Check for claude/клод prefix in voice
        const claudeMatch = transcript.match(/^(клод|claude)[:\s,-]+([\s\S]+)$/i);
        if (claudeMatch) {
          const content = claudeMatch[2]!.trim();
          await execute('INSERT INTO claude_notes (content, source) VALUES ($1, $2)', [content, 'telegram-voice']);
          const pendingRow2 = await queryOne<{ c: string }>('SELECT COUNT(*) as c FROM claude_notes WHERE processed = 0');
          const pending = Number(pendingRow2?.c ?? 0);
          ctx.reply(`📝 Заметка сохранена для Claude Code\n📬 В очереди: ${pending}`);
          return;
        }

        // If there's an open draft — voice after audio is treated as correction (context/clarification)
        const existing = this.drafts.get(tgId);
        if (existing) {
          await this.applyCorrection(ctx, existing, transcript);
          return;
        }

        // Short command handling stays the same
        const intent = await this.classifyMessage(transcript, ctx.from?.id);
        if (intent === 'command' || intent === 'chat') {
          const cmdResponse = await this.executeCommand(transcript, ctx.from?.id);
          await sendCommandResult(ctx, cmdResponse);
          return;
        }

        // Long text (meeting/idea/task) → build and send draft card
        await this.buildAndSendDraft(ctx, userId!, tgId, 'voice', transcript, null);
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Document → check if audio, transcribe; otherwise ingest
    this.bot.on(message('document'), async (ctx) => {
      try {
        const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        // userId auto-created by resolveUserId
        const doc = ctx.message.document;
        const filename = doc.file_name ?? 'file';
        const mime = doc.mime_type ?? '';
        const isAudio = mime.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|webm|flac|aac|wma)$/i.test(filename);
        const isVideo = mime.startsWith('video/') || /\.(mp4|mov|avi|mkv|wmv|m4v)$/i.test(filename);
        const isTranscribable = isAudio || isVideo;

        const fileSizeMb = (doc.file_size ?? 0) / (1024 * 1024);
        // Local Bot API server removes 20MB limit; only block if no local API
        if (fileSizeMb > 20 && !process.env.TELEGRAM_LOCAL_API_ROOT) {
          await ctx.reply(`⚠️ Файл слишком большой (${Math.round(fileSizeMb)} МБ, лимит 20 МБ).\n\nЗалей на Google Drive → сделай публичную ссылку → пришли:\n/transcribe <ссылка>`);
          return;
        }
        if (fileSizeMb > 20) {
          await ctx.reply(`⬇️ Большой файл (${Math.round(fileSizeMb)} МБ), скачиваю через локальный сервер...`);
        }

        const buffer = await this.downloadTelegramFile(ctx, doc.file_id);

        if (isTranscribable) {
          // Transcribe audio/video file
          const tgId = ctx.from?.id ?? 0;
          const isPro = this.proMode.has(tgId);
          if (isPro) {
            this.proMode.delete(tgId);
            ctx.reply('🎯 PRO: Транскрибирую через OpenAI Whisper...');
          } else {
            const { getQueueStatus } = require('./whisper-queue');
            const qStatus = getQueueStatus();
            if (qStatus.active >= 2 && qStatus.queued > 0) {
              ctx.reply(`🎤 В очереди (позиция ${qStatus.queued + 1}). Транскрибирую когда освободится...`);
            } else if (qStatus.active >= 2) {
              ctx.reply('🎤 Транскрибирую (очередь занята, может занять дольше)...');
            } else {
              ctx.reply(isVideo ? '🎬 Транскрибирую видео...' : '🎤 Транскрибирую аудиофайл...');
            }
          }
          const transcript = isPro
            ? await this.transcribeProAudio(buffer, filename)
            : await this.transcribeAudio(buffer, filename);
          if (!transcript.trim()) { ctx.reply('⚠️ Не удалось распознать речь'); return; }

          // Show transcript
          const preview = transcript.length > 500 ? transcript.slice(0, 500) + '...' : transcript;
          ctx.reply(`📝 Транскрипция (${transcript.length} символов):\n${preview}`);

          // If there's an open draft — voice/audio is treated as correction
          const activeDraft = this.drafts.get(ctx.from!.id);
          if (activeDraft) {
            await this.applyCorrection(ctx, activeDraft, transcript);
            return;
          }

          await this.buildAndSendDraft(ctx, userId!, ctx.from!.id, 'audio', transcript, null);
        } else {
          ctx.reply('📄 Обрабатываю файл...');
          const ingestService = new IngestService();
          const result = await ingestService.ingestBuffer(buffer, filename, userId);
          await sendLong(ctx, await formatIngestResult(result));
        }
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Audio message (mp3 etc sent as audio, not voice)
    this.bot.on(message('audio'), async (ctx) => {
      try {
        const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        // userId auto-created by resolveUserId
        const audio = ctx.message.audio;
        const fileSizeMb = (audio.file_size ?? 0) / (1024 * 1024);
        if (fileSizeMb > 20 && !process.env.TELEGRAM_LOCAL_API_ROOT) {
          await ctx.reply(`⚠️ Аудио слишком большое (${Math.round(fileSizeMb)} МБ, лимит 20 МБ).\n\nЗалей на Google Drive → сделай публичную ссылку → пришли:\n/transcribe <ссылка>`);
          return;
        }
        const tgId = ctx.from?.id ?? 0;
        const isPro = this.proMode.has(tgId);
        if (isPro) {
          this.proMode.delete(tgId);
          ctx.reply('🎯 PRO: Транскрибирую через OpenAI Whisper...');
        } else {
          const { getQueueStatus } = require('./whisper-queue');
          const qStatus = getQueueStatus();
          if (fileSizeMb > 20) {
            ctx.reply(`⬇️ Большой файл (${Math.round(fileSizeMb)} МБ), скачиваю и транскрибирую...`);
          } else if (qStatus.active >= 2 && qStatus.queued > 0) {
            ctx.reply(`🎤 В очереди (позиция ${qStatus.queued + 1}). Транскрибирую когда освободится...`);
          } else if (qStatus.active >= 2) {
            ctx.reply('🎤 Транскрибирую (очередь занята, может занять дольше)...');
          } else {
            ctx.reply('🎤 Транскрибирую аудио...');
          }
        }
        const buffer = await this.downloadTelegramFile(ctx, audio.file_id);

        const transcript = isPro
          ? await this.transcribeProAudio(buffer, audio.file_name ?? 'audio.mp3')
          : await this.transcribeAudio(buffer, audio.file_name ?? 'audio.mp3');
        if (!transcript.trim()) { ctx.reply('⚠️ Не удалось распознать речь'); return; }

        const preview = transcript.length > 500 ? transcript.slice(0, 500) + '...' : transcript;
        ctx.reply(`📝 Транскрипция (${transcript.length} символов):\n${preview}`);

        // If there's an open draft — audio is treated as correction
        const activeDraft = this.drafts.get(ctx.from!.id);
        if (activeDraft) {
          await this.applyCorrection(ctx, activeDraft, transcript);
          return;
        }

        await this.buildAndSendDraft(ctx, userId!, ctx.from!.id, 'audio', transcript, null);
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Video message → extract audio and transcribe
    this.bot.on(message('video'), async (ctx) => {
      try {
        const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        const video = ctx.message.video;
        const fileSizeMb = (video.file_size ?? 0) / (1024 * 1024);
        if (fileSizeMb > 20 && !process.env.TELEGRAM_LOCAL_API_ROOT) {
          await ctx.reply(`⚠️ Видео слишком большое (${Math.round(fileSizeMb)} МБ, лимит 20 МБ).\n\nЗалей на Google Drive → сделай публичную ссылку → пришли:\n/transcribe <ссылка>`);
          return;
        }
        const tgId = ctx.from?.id ?? 0;
        const isPro = this.proMode.has(tgId);
        if (isPro) {
          this.proMode.delete(tgId);
          ctx.reply('🎯 PRO: Транскрибирую видео через OpenAI Whisper...');
        } else {
          const { getQueueStatus } = require('./whisper-queue');
          const qStatus = getQueueStatus();
          if (fileSizeMb > 20) {
            ctx.reply(`⬇️ Большое видео (${Math.round(fileSizeMb)} МБ), скачиваю и транскрибирую...`);
          } else if (qStatus.active >= 2 && qStatus.queued > 0) {
            ctx.reply(`🎬 В очереди (позиция ${qStatus.queued + 1}). Транскрибирую когда освободится...`);
          } else {
            ctx.reply('🎬 Транскрибирую видео...');
          }
        }
        const buffer = await this.downloadTelegramFile(ctx, video.file_id);
        const filename = (video as unknown as Record<string, unknown>).file_name as string ?? 'video.mp4';

        const transcript = isPro
          ? await this.transcribeProAudio(buffer, filename)
          : await this.transcribeAudio(buffer, filename);
        if (!transcript.trim()) { ctx.reply('⚠️ Не удалось распознать речь в видео'); return; }

        const preview = transcript.length > 500 ? transcript.slice(0, 500) + '...' : transcript;
        ctx.reply(`📝 Транскрипция видео (${transcript.length} символов):\n${preview}`);

        const activeDraft = this.drafts.get(ctx.from!.id);
        if (activeDraft) {
          await this.applyCorrection(ctx, activeDraft, transcript);
          return;
        }

        await this.buildAndSendDraft(ctx, userId!, ctx.from!.id, 'video', transcript, null);
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Video note (round video) → extract audio and transcribe
    this.bot.on(message('video_note'), async (ctx) => {
      try {
        const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        const videoNote = ctx.message.video_note;
        const tgId = ctx.from?.id ?? 0;
        const isPro = this.proMode.has(tgId);
        if (isPro) {
          this.proMode.delete(tgId);
          ctx.reply('🎯 PRO: Транскрибирую кружок через OpenAI Whisper...');
        } else {
          ctx.reply('🎬 Транскрибирую видео-кружок...');
        }
        const buffer = await this.downloadTelegramFile(ctx, videoNote.file_id);

        const transcript = isPro
          ? await this.transcribeProAudio(buffer, 'video_note.mp4')
          : await this.transcribeAudio(buffer, 'video_note.mp4');
        if (!transcript.trim()) { ctx.reply('⚠️ Не удалось распознать речь'); return; }

        const preview = transcript.length > 500 ? transcript.slice(0, 500) + '...' : transcript;
        ctx.reply(`📝 Транскрипция (${transcript.length} символов):\n${preview}`);

        const activeDraft = this.drafts.get(ctx.from!.id);
        if (activeDraft) {
          await this.applyCorrection(ctx, activeDraft, transcript);
          return;
        }

        await this.buildAndSendDraft(ctx, userId!, ctx.from!.id, 'video', transcript, null);
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Contact shared from phone book
    this.bot.on(message('contact'), async (ctx) => {
      try {
        const userId = await this.resolveUserId(ctx.from?.id ?? 0);
        if (!userId) { ctx.reply('Привяжите аккаунт через /login'); return; }
        const c = ctx.message.contact;
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
        const phone = c.phone_number || '';
        if (!name) { ctx.reply('❌ Контакт без имени'); return; }

        const existing = await queryOne<{ id: number }>('SELECT id FROM people WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [userId, name]);
        if (existing) {
          if (phone) await execute("UPDATE people SET phone = $1 WHERE id = $2 AND (phone = '' OR phone IS NULL)", [phone, existing.id]);
          ctx.reply(`✅ Контакт "${name}" обновлён\n${phone ? `📱 ${phone}` : ''}`);
        } else {
          const newPersonIns = await queryOne<{ id: number }>('INSERT INTO people (name, phone, user_id) VALUES ($1, $2, $3) RETURNING id', [name, phone, userId]);
          const newId = newPersonIns!.id;
          this.lastCreatedPerson.set(ctx.from!.id, { name, id: newId, ts: Date.now() });
          ctx.reply(`✅ Контакт создан: ${name}\n${phone ? `📱 ${phone}\n` : ''}\nПривязать к проекту? Напишите название.`);
        }
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    this.bot.on(message('photo'), async (ctx) => {
      try {
        const userId = await this.resolveUserId(ctx.from?.id ?? 0, [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username);
        if (!userId) { ctx.reply('Привяжите аккаунт через /login'); return; }
        const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
        const buffer = await this.downloadTelegramFile(ctx, photo.file_id);
        const caption = (ctx.message.caption || '').trim();

        ctx.reply('📷 Анализирую фото...');

        // Use GPT-4.1-mini vision to extract contact info
        const OpenAI = require('openai').default;
        const openai = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl });
        const base64 = buffer.toString('base64');
        const mimeType = 'image/jpeg';

        const visionResult = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: `Проанализируй это изображение. Если это визитка, скриншот контакта, или любая информация о человеке — извлеки данные. ${caption ? `Дополнительный контекст от пользователя: "${caption}"` : ''}

Верни СТРОГО JSON:
{
  "is_contact": true/false,
  "name": "Имя Фамилия",
  "company": "компания или ''",
  "role": "должность или ''",
  "phone": "телефон или ''",
  "email": "email или ''",
  "telegram": "@username или ''",
  "notes": "другая полезная информация",
  "summary": "Краткое описание что на фото (1-2 предложения)"
}` },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          }],
          response_format: { type: 'json_object' },
          max_tokens: 1000,
        });

        const raw = visionResult.choices[0]?.message?.content ?? '{}';
        const parsed = JSON.parse(raw);
        console.log('[photo] GPT result:', JSON.stringify(parsed).slice(0, 300));

        if (parsed.is_contact && (parsed.name || parsed.phone || parsed.telegram)) {
          const tgId = ctx.from!.id;

          // Check if there's buffered data from a previous photo (within 30s)
          const pending = this.pendingPhotoData.get(tgId);
          if (pending && Date.now() - pending.ts < 30000) {
            // Merge: fill missing fields from buffered data
            for (const key of ['phone', 'email', 'telegram', 'company', 'role', 'notes']) {
              if (!parsed[key] && pending.data[key]) parsed[key] = pending.data[key];
            }
            if (!parsed.name && pending.data.name) parsed.name = pending.data.name;
            this.pendingPhotoData.delete(tgId);
          }

          // If no name — buffer data and wait for next photo/message
          if (!parsed.name && (parsed.phone || parsed.telegram)) {
            // Check lastCreatedPerson first
            const lastPerson = this.lastCreatedPerson.get(tgId);
            if (lastPerson) {
              if (parsed.phone) await execute("UPDATE people SET phone = $1 WHERE id = $2", [parsed.phone, lastPerson.id]);
              if (parsed.telegram) await execute("UPDATE people SET telegram = $1 WHERE id = $2", [parsed.telegram, lastPerson.id]);
              if (parsed.email) await execute("UPDATE people SET email = $1 WHERE id = $2", [parsed.email, lastPerson.id]);
              ctx.reply(`✅ Контакт "${lastPerson.name}" дополнен\n${parsed.phone ? `📱 ${parsed.phone}\n` : ''}${parsed.telegram ? `📱 ${parsed.telegram}\n` : ''}${parsed.email ? `📧 ${parsed.email}` : ''}`);
              return;
            }
            // Buffer and wait for second photo with name
            this.pendingPhotoData.set(tgId, { data: parsed, ts: Date.now() });
            console.log('[photo] buffered contact data (no name), waiting for next photo');
            return;
          }

          // If has name — also check pending buffer to merge phone/tg
          if (parsed.name) {
            const pending2 = this.pendingPhotoData.get(tgId);
            if (pending2 && Date.now() - pending2.ts < 30000) {
              for (const key of ['phone', 'email', 'telegram']) {
                if (!parsed[key] && pending2.data[key]) parsed[key] = pending2.data[key];
              }
              this.pendingPhotoData.delete(tgId);
              console.log('[photo] merged buffered phone/tg with named contact');
            }
          }
          // Create contact
          const existingPhoto = await queryOne<{ id: number }>('SELECT id FROM people WHERE user_id = $1 AND LOWER(name) = LOWER($2)', [userId, parsed.name.trim()]);
          if (existingPhoto) {
            // Update existing — only fill empty fields
            if (parsed.phone) await execute("UPDATE people SET phone = $1 WHERE id = $2 AND (phone = '' OR phone IS NULL)", [parsed.phone, existingPhoto.id]);
            if (parsed.email) await execute("UPDATE people SET email = $1 WHERE id = $2 AND (email = '' OR email IS NULL)", [parsed.email, existingPhoto.id]);
            if (parsed.telegram) await execute("UPDATE people SET telegram = $1 WHERE id = $2 AND (telegram = '' OR telegram IS NULL)", [parsed.telegram, existingPhoto.id]);
            if (parsed.company) await execute("UPDATE people SET company = $1 WHERE id = $2 AND (company = '' OR company IS NULL)", [parsed.company, existingPhoto.id]);
            if (parsed.role) await execute("UPDATE people SET role = $1 WHERE id = $2 AND (role = '' OR role IS NULL)", [parsed.role, existingPhoto.id]);
            ctx.reply(`✅ Контакт "${parsed.name}" обновлён\n${parsed.phone ? `📱 ${parsed.phone}\n` : ''}${parsed.email ? `📧 ${parsed.email}\n` : ''}${parsed.company ? `🏢 ${parsed.company}\n` : ''}${parsed.notes || ''}`);
          } else {
            const photoPersonIns = await queryOne<{ id: number }>(
              'INSERT INTO people (name, company, role, phone, email, telegram, notes, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
              [parsed.name, parsed.company || '', parsed.role || '', parsed.phone || '', parsed.email || '', parsed.telegram || '', parsed.notes || '', userId]
            );
            const newPersonId = photoPersonIns!.id;
            this.lastCreatedPerson.set(ctx.from!.id, { name: parsed.name, id: newPersonId, ts: Date.now() });
            ctx.reply(`✅ Контакт создан: ${parsed.name}\n${parsed.phone ? `📱 ${parsed.phone}\n` : ''}${parsed.email ? `📧 ${parsed.email}\n` : ''}${parsed.company ? `🏢 ${parsed.company}\n` : ''}${parsed.role ? `💼 ${parsed.role}\n` : ''}${parsed.notes ? `📝 ${parsed.notes}` : ''}\n\nПривязать к проекту? Напишите название проекта.`);
          }
        } else {
          // Not a contact — process as regular image
          ctx.reply(`📷 ${parsed.summary || 'Фото обработано'}`);
        }
      } catch (err) {
        ctx.reply(`❌ Ошибка: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    });

    // Set bot commands menu
    this.bot.telegram.setMyCommands([
      { command: 'menu', description: '📋 Меню действий' },
      { command: 'app', description: '📱 Открыть приложение' },
      { command: 'tasks', description: '📋 Задачи на сегодня' },
      { command: 'brief', description: '🌅 Дневной брифинг' },
      { command: 'habits', description: '🔥 Привычки' },
      { command: 'meetings', description: '🤝 Встречи' },
      { command: 'lecture', description: '🎓 Режим лекции' },
      { command: 'interview', description: '🎙️ Режим интервью' },
      { command: 'pro', description: '🎯 PRO-транскрибация (Whisper)' },
      { command: 'transcribe', description: '🎤 Транскрибация по ссылке' },
      { command: 'add', description: '➕ Добавить задачу' },
      { command: 'focus', description: '🎯 Фокус дня' },
      { command: 'projects', description: '📁 Проекты' },
      { command: 'search', description: '🔍 Поиск' },
      { command: 'all', description: '📊 Все задачи' },
      { command: 'bundle', description: '📦 Bundle' },
      { command: 'settings', description: '⚙️ Настройки' },
      { command: 'start', description: '🚀 Справка' },
    ]).catch(() => {});

    const tryLaunch = (attempt = 0): void => {
      this.bot!.launch({ dropPendingUpdates: true }).then(() => {
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

  /** Send notification with inline keyboard markup */
  async notifyUserWithMarkup(tgId: string, message: string, reply_markup: Record<string, unknown>): Promise<void> {
    if (!this.bot || !tgId) return;
    try {
      await this.bot.telegram.sendMessage(tgId, message, { parse_mode: 'HTML', reply_markup: reply_markup as any });
    } catch (err) {
      console.error(`[telegram] notifyUserWithMarkup(${tgId}) failed:`, err);
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
  async getLinkedUsers(): Promise<Array<{ id: number; tg_id: string; name: string }>> {
    try {
      return await queryAll<{ id: number; tg_id: string; name: string }>("SELECT id, tg_id, name FROM users WHERE tg_id IS NOT NULL AND tg_id != ''");
    } catch { return []; }
  }
}

export const telegramService = new TelegramService();
