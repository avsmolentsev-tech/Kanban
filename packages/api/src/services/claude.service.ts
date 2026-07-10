import OpenAI from 'openai';
import { config } from '../config';
import type { MeetingStructured, InboxAnalysis, ExtractionResult, DraftCard } from '@pis/shared';
import { toolDefinitions, executeTool } from './tools.service';

export interface TaskSuggestion {
  title: string;
  description: string;
  priority: number;
  urgency: number;
}

export interface SearchResult {
  answer: string;
  sources: string[];
}

export class ClaudeService {
  private readonly client: OpenAI;
  // Public alias so newer code (and tests) can reference `this.openai` / monkey-patch `svc.openai`.
  public openai: OpenAI;

  // Dedicated client for Advisory Board calls (separate key/billing; falls back to main).
  private readonly advisorClient: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl });
    this.openai = this.client;
    this.advisorClient = new OpenAI({ apiKey: config.advisorApiKey || config.openaiApiKey, baseURL: config.openaiBaseUrl });
  }

  private buildSystemPrompt(extra = ''): string {
    return [
      'You are a personal assistant integrated with an Obsidian vault-based life management system.',
      `Today's date: ${new Date().toISOString().split('T')[0]}.`,
      'Always respond in the same language as the user input (Russian or English).',
      'When mentioning people or projects by name, always format them as [[WikiLinks]].',
      extra,
    ].filter(Boolean).join('\n');
  }

  async chat(messages: Array<{ role: 'user' | 'assistant'; content: string }>, systemPrompt = '', model?: string, useTools = false, jsonMode = false, userId?: number | null): Promise<string> {
    const chatMessages: Array<Record<string, unknown>> = [
      { role: 'system', content: this.buildSystemPrompt(systemPrompt) },
      ...messages,
    ];

    const selectedModel = model ?? 'gpt-4.1-mini';
    const isO3 = selectedModel.startsWith('o3') || selectedModel.startsWith('o4');
    const requestOpts: Record<string, unknown> = {
      model: selectedModel,
      messages: chatMessages,
    };
    // o3/o4 models use max_completion_tokens, others use max_tokens
    if (isO3) {
      requestOpts['max_completion_tokens'] = 8192;
    } else {
      requestOpts['max_tokens'] = 8192;
    }

    if (useTools) {
      requestOpts['tools'] = toolDefinitions;
    }
    if (jsonMode) {
      requestOpts['response_format'] = { type: 'json_object' };
    }

    let response = await this.client.chat.completions.create(requestOpts as Parameters<typeof this.client.chat.completions.create>[0]);
    let message = response.choices[0]?.message;

    // Handle tool calls in a loop (max 6 iterations)
    let iterations = 0;
    while (useTools && message?.tool_calls && message.tool_calls.length > 0 && iterations < 6) {
      iterations++;
      chatMessages.push(message as unknown as Record<string, unknown>);
      for (const toolCall of message.tool_calls) {
        if (toolCall.type === 'function') {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          const result = await executeTool(toolCall.function.name, args, userId);
          chatMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      }
      response = await this.client.chat.completions.create({
        ...requestOpts,
        messages: chatMessages,
      } as Parameters<typeof this.client.chat.completions.create>[0]);
      message = response.choices[0]?.message;
    }

    // Log usage
    try {
      const usage = response.usage;
      if (usage) {
        const { execute } = require('../db/db');
        const detail = userId ? `user:${userId}` : '';
        await execute(
          "INSERT INTO usage_logs (type, model, tokens_in, tokens_out, detail, user_id) VALUES ($1, $2, $3, $4, $5, $6)",
          ['ai_chat', selectedModel, usage.prompt_tokens || 0, usage.completion_tokens || 0, detail, userId ?? null]
        );
      }
    } catch {}

    return message?.content ?? '';
  }

  async parseMeeting(rawText: string): Promise<MeetingStructured> {
    const prompt = `Parse the following meeting notes and return ONLY valid JSON matching this schema:
{"title":"string","date":"YYYY-MM-DD or null","summary":"string","people":["names"],"agreements":[{"description":"string","person":"string or null","due_date":"YYYY-MM-DD or null"}],"tasks":["strings"],"ideas":["strings"],"key_facts":["strings"],"tags":["strings"]}

Meeting notes:
${rawText}`;
    const result = await this.chat([{ role: 'user', content: prompt }]);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude did not return valid JSON for meeting parse');
    return JSON.parse(jsonMatch[0]) as MeetingStructured;
  }

  async parseInboxItem(text: string, fileType: string): Promise<InboxAnalysis> {
    const prompt = `Ты — профессиональный аналитик встреч и знаний. Проанализируй контент (тип файла: ${fileType}) и создай структурированное резюме на УРОВНЕ Plaud / Otter.ai.

ТРЕБОВАНИЯ К АНАЛИЗУ:
1. Определи тип контента (встреча, идея, задача, материал)
2. Создай КАЧЕСТВЕННОЕ саммари на русском языке со следующей структурой:
   - Executive summary (2-3 предложения о сути)
   - Ключевые темы (список с кратким описанием каждой)
   - Принятые решения (что было решено)
   - Action items (конкретные задачи с исполнителями)
   - Важные цитаты и инсайты
   - Открытые вопросы
   - Следующие шаги
3. Извлеки все имена людей (только реальные собственные имена, не "я"/"мы")
4. Найди упоминания проектов/компаний/продуктов
5. Выдели все задачи которые кто-то обязался сделать
6. Теги: ключевые темы одним словом

Верни ТОЛЬКО валидный JSON без markdown:
{
  "detected_type": "meeting|idea|task|material|unknown",
  "title": "Краткое информативное название (не более 80 символов)",
  "date": "YYYY-MM-DD или null",
  "people": ["имена реальных участников"],
  "project_hints": ["названия проектов/компаний"],
  "agreements": ["договорённости списком"],
  "tasks": ["конкретные задачи, одна строка = одна задача"],
  "ideas": ["идеи которые прозвучали"],
  "summary": "# Резюме\\n\\n[2-3 предложения executive summary]\\n\\n## Ключевые темы\\n- **Тема 1**: описание\\n- **Тема 2**: описание\\n\\n## Решения\\n- Решение 1\\n- Решение 2\\n\\n## Action items\\n- [ ] Задача 1 (кто делает)\\n- [ ] Задача 2\\n\\n## Инсайты и цитаты\\n> Важная цитата\\n\\n## Открытые вопросы\\n- Вопрос 1\\n\\n## Следующие шаги\\n- Шаг 1",
  "key_facts": ["факты и цифры"],
  "tags": ["ключевые", "слова"]
}

Отвечай на русском языке во всех текстовых полях. Будь конкретным и полезным — избегай общих фраз.

Контент:
${text}`;
    const result = await this.chat([{ role: 'user', content: prompt }], '', 'gpt-4.1-mini', false, true);
    let parsed: InboxAnalysis;
    try {
      parsed = JSON.parse(result) as InboxAnalysis;
    } catch {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Claude did not return valid JSON for inbox analysis');
      parsed = JSON.parse(jsonMatch[0]) as InboxAnalysis;
    }
    return parsed;
  }

  /**
   * Generate pro summaries for a meeting transcript.
   * Returns { notes, qa } — each is markdown text.
   * meetingType: 'meeting' | 'lecture' | 'interview' — selects prompt style.
   */
  async generateProSummaries(transcript: string, title: string, people: string[], meetingType: string = 'meeting'): Promise<{ notes: string; qa: string; actions?: string }> {
    const context = `Название: ${title}\nУчастники: ${people.join(', ') || 'не указаны'}\n\nТранскрипция:\n${transcript.slice(0, 30000)}`;

    const notesPrompt = this.getNotesPrompt(meetingType, context);
    const qaPrompt = this.getQaPrompt(meetingType, context);

    const [notes, qa] = await Promise.all([
      this.chat([{ role: 'user', content: notesPrompt }], '', 'gpt-4.1-mini'),
      this.chat([{ role: 'user', content: qaPrompt }], '', 'gpt-4.1-mini'),
    ]);

    // Extract unique tasks/actions — deduplicate
    let actions: string | undefined;
    try {
      const actionsLabel = meetingType === 'lecture' ? 'учебные задачи' : meetingType === 'interview' ? 'задачи и инсайты к применению' : 'задачи и обязательства';
      const actionsResp = await this.chat([{ role: 'user', content: `Из двух документов ниже извлеки ВСЕ уникальные ${actionsLabel}. Убери дубли. Каждая задача — одна строка с чекбоксом.

ФОРМАТ:
- [ ] Задача — [Ответственный] [срок если есть]

Если одна и та же задача встречается в обоих документах — оставь ОДНУ, более подробную версию.

ДОКУМЕНТ 1 (Notes):
${notes.slice(0, 10000)}

ДОКУМЕНТ 2 (Q&A):
${qa.slice(0, 10000)}` }], '', 'gpt-4.1-mini');
      if (actionsResp.trim()) actions = actionsResp;
    } catch {}

    return { notes, qa, ...(actions ? { actions } : {}) };
  }

  /**
   * Extract REAL action items from a meeting transcript — structured, attributed,
   * and quote-backed so nothing is invented. Processes the full transcript in
   * chunks (no 8k truncation) and returns deduplicated items.
   */
  async extractActionItems(
    transcript: string,
    title: string,
    people: string[] = [],
  ): Promise<Array<{ title: string; owner: string | null; type: 'my_task' | 'their_commitment' | 'mutual_agreement' | 'idea'; due: string | null; quote: string }>> {
    const CHUNK = 12000;
    const MAX_CHUNKS = 8; // bound cost on very long recordings
    const chunks: string[] = [];
    for (let i = 0; i < transcript.length && chunks.length < MAX_CHUNKS; i += CHUNK) {
      chunks.push(transcript.slice(i, i + CHUNK));
    }

    type Item = { title: string; owner: string | null; type: 'my_task' | 'their_commitment' | 'mutual_agreement' | 'idea'; due: string | null; quote: string };
    const collected: Item[] = [];

    for (const chunk of chunks) {
      const prompt = `Ты извлекаешь ТОЛЬКО реальные действия из встречи. Никаких выдумок.

Встреча: "${title}"
Участники: ${people.join(', ') || 'не указаны'}

ЖЁСТКИЕ ПРАВИЛА:
1. Бери ТОЛЬКО явно проговоренные действия: обязательства, договорённости, задачи «нужно сделать».
2. Если действие не сказано явно — НЕ включай. Лучше меньше, но точно.
3. Для КАЖДОГО пункта обязательна ЦИТАТА из транскрипции (дословно, коротко), подтверждающая его. Нет цитаты — не включай пункт.
4. Определи type:
   - "my_task" — делает владелец заметок / наша сторона («я», «мы», «нам нужно»)
   - "their_commitment" — обещал сделать кто-то другой (укажи кто в owner)
   - "mutual_agreement" — совместная договорённость обеих сторон
   - "idea" — идея/предложение БЕЗ явного обязательства
5. owner: имя ответственного из участников, "я" для себя, или null если не ясно.
6. due: дата в формате YYYY-MM-DD, только если срок назван явно, иначе null.

Верни ТОЛЬКО JSON: {"items":[{"title":"краткое действие","owner":"имя|я|null","type":"my_task|their_commitment|mutual_agreement|idea","due":"YYYY-MM-DD|null","quote":"дословная цитата"}]}
Если действий нет — {"items":[]}

Транскрипция:
${chunk}`;

      try {
        const resp = await this.chat([{ role: 'user', content: prompt }], '', 'gpt-4.1-mini', false, true);
        const parsed = JSON.parse(resp) as { items?: Item[] };
        if (Array.isArray(parsed.items)) {
          for (const it of parsed.items) {
            if (!it || typeof it.title !== 'string' || it.title.trim().length < 3) continue;
            if (!it.quote || typeof it.quote !== 'string' || it.quote.trim().length < 3) continue; // no quote → drop (anti-fabrication)
            collected.push({
              title: it.title.trim(),
              owner: it.owner && it.owner !== 'null' ? String(it.owner).trim() : null,
              type: (['my_task', 'their_commitment', 'mutual_agreement', 'idea'].includes(it.type) ? it.type : 'my_task'),
              due: it.due && /^\d{4}-\d{2}-\d{2}$/.test(String(it.due)) ? String(it.due) : null,
              quote: it.quote.trim().slice(0, 300),
            });
          }
        }
      } catch { /* skip unparseable chunk */ }
    }

    // Dedup by normalized title
    const seen = new Set<string>();
    const deduped: Item[] = [];
    for (const it of collected) {
      const key = it.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }
    return deduped;
  }

  // ── Advisory Board (persona engine) ───────────────────────────────────────
  // Personas call the model with their pure system prompt (NOT buildSystemPrompt,
  // which injects a generic assistant identity that would dilute the character).

  /** One-tap разбор: a persona analyses a situation and returns structured output. */
  async advisorAnalyze(personaPrompt: string, context: string): Promise<{ opinion: string; risks: string[]; would_do: string; questions: string[] }> {
    const model = config.advisorModel;
    const system = `${personaPrompt}

Верни ТОЛЬКО валидный JSON:
{"opinion":"твоя оценка ситуации от первого лица","risks":["риск/красный флаг", "..."],"would_do":"что бы ты сделал — конкретные шаги","questions":["уточняющий вопрос к пользователю", "..."]}`;
    const resp = await this.advisorClient.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Разбери эту встречу/ситуацию:\n\n${context}` },
      ],
    });
    const text = resp.choices[0]?.message?.content ?? '{}';
    try {
      const p = JSON.parse(text) as Record<string, unknown>;
      return {
        opinion: typeof p['opinion'] === 'string' ? p['opinion'] as string : text,
        risks: Array.isArray(p['risks']) ? (p['risks'] as string[]) : [],
        would_do: typeof p['would_do'] === 'string' ? p['would_do'] as string : '',
        questions: Array.isArray(p['questions']) ? (p['questions'] as string[]) : [],
      };
    } catch {
      return { opinion: text, risks: [], would_do: '', questions: [] };
    }
  }

  /** Live dialogue: a persona replies in character, holding the situation context + history. */
  async advisorReply(personaPrompt: string, context: string, history: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
    const model = config.advisorModel;
    const system = `${personaPrompt}${context ? `\n\nКонтекст встречи/ситуации, которую вы обсуждаете:\n${context}` : ''}`;
    const resp = await this.advisorClient.chat.completions.create({
      model,
      temperature: 0.8,
      messages: [
        { role: 'system', content: system },
        ...history,
      ],
    });
    return resp.choices[0]?.message?.content ?? '';
  }

  /** Chairman synthesis: combine several advisors' разборы into consensus/disagreement/recommendation. */
  async advisorSynthesize(items: Array<{ name: string; opinion?: string; risks?: string[]; would_do?: string }>): Promise<{ agreement: string[]; disagreement: string[]; recommendation: string }> {
    const model = config.advisorModel;
    const board = items.map(it => `### ${it.name}\nМнение: ${it.opinion ?? ''}\nРиски: ${(it.risks ?? []).join('; ')}\nЧто бы сделал: ${it.would_do ?? ''}`).join('\n\n');
    const system = `Ты — беспристрастный председатель совета директоров. Тебе дали разборы ОДНОЙ ситуации от нескольких советников. Сведи их: где СОГЛАСИЕ между ними, где РАСХОЖДЕНИЯ (кто с кем и в чём), и дай итоговую взвешенную РЕКОМЕНДАЦИЮ. Не выдумывай — опирайся только на эти разборы.
Верни ТОЛЬКО JSON: {"agreement":["пункт согласия"],"disagreement":["расхождение: кто vs кто и в чём"],"recommendation":"итоговая рекомендация"}`;
    const resp = await this.advisorClient.chat.completions.create({
      model,
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `Разборы советников:\n\n${board}` },
      ],
    });
    const text = resp.choices[0]?.message?.content ?? '{}';
    try {
      const p = JSON.parse(text) as Record<string, unknown>;
      return {
        agreement: Array.isArray(p['agreement']) ? (p['agreement'] as string[]) : [],
        disagreement: Array.isArray(p['disagreement']) ? (p['disagreement'] as string[]) : [],
        recommendation: typeof p['recommendation'] === 'string' ? p['recommendation'] as string : '',
      };
    } catch {
      return { agreement: [], disagreement: [], recommendation: text };
    }
  }

  // ── Prompt builders per meeting type ──────────────────────────────────────

  private getNotesPrompt(meetingType: string, context: string): string {
    if (meetingType === 'lecture') {
      return `Ты — профессиональный конспектист. Создай ПОДРОБНЫЙ структурированный КОНСПЕКТ лекции/учебного материала.

ФОРМАТ (markdown):
# [Название лекции]

## Об авторе / спикере
[Кто выступает, его экспертиза, контекст выступления. Если не ясно из транскрипции — пропусти.]

## Оглавление
1. [Тема 1]
2. [Тема 2]
...

## [Тема 1]: [название]
### Ключевые тезисы
- Тезис 1 с конкретикой (цифры, примеры, цитаты)
- Тезис 2
### Примеры и кейсы
[Конкретные примеры, истории, кейсы которые приводил спикер]

## [Тема 2]: [название]
### Ключевые тезисы
- ...
### Примеры и кейсы
- ...

## [Тема N]
...

## Ключевые определения и термины
- **[Термин]** — определение / объяснение из лекции
- ...

## Главные выводы
[5-10 самых важных мыслей и выводов из лекции. Конкретно, без воды.]
1. Вывод 1
2. Вывод 2

## Цитаты
[Яркие и запоминающиеся цитаты спикера — дословно или близко к тексту]
> "цитата 1"
> "цитата 2"

## Что изучить / применить
- [ ] Изучить [тема/книга/метод]
- [ ] Применить [конкретный совет/метод]
- [ ] Проверить [гипотеза/идея]

ВАЖНО:
- Пиши на русском
- Структурируй по темам, а не хронологически
- Конкретика: цифры, названия, методы, примеры ИЗ ЛЕКЦИИ
- Длинные тезисы разбивай на подпункты

🚨 ЗАПРЕТ НА ВЫДУМКИ:
- Пиши ТОЛЬКО то, что ЯВНО сказано в транскрипции!
- НЕ додумывай примеры, цифры, советы
- Если транскрипция неполная — напиши по тому что есть + "⚠️ Транскрипция неполная"
- ЛУЧШЕ короткий точный конспект, чем длинный выдуманный

${context}`;
    }

    if (meetingType === 'interview') {
      return `Ты — профессиональный аналитик интервью. Создай ПОДРОБНЫЙ структурированный разбор интервью.

ФОРМАТ (markdown):
# [Название интервью]

## Участники
[Кто интервьюер, кто гость. Бэкграунд гостя: чем занимается, компания, достижения — только из транскрипции.]

## Ключевые темы
1. [Тема 1]
2. [Тема 2]
...

## [Тема 1]: [название]
[Что рассказал гость. Конкретные истории, цифры, стратегии, опыт. Упоминай кто что сказал.]

## [Тема 2]: [название]
[...]

## [Тема N]
[...]

## Лучшие цитаты
> "цитата 1" — [Имя]
> "цитата 2" — [Имя]

## Ключевые инсайты
[Самые ценные мысли, советы, наблюдения из интервью]
1. Инсайт 1
2. Инсайт 2

## Рекомендации гостя
[Книги, инструменты, методы, контакты которые рекомендовал гость]
- ...

## Спорные / неочевидные мнения
[Тезисы которые противоречат общепринятому мнению или удивляют]
- ...

## Что применить
- [ ] Применить [совет/метод из интервью]
- [ ] Изучить [книга/ресурс/инструмент]
- [ ] Связаться с [человек/компания]

ВАЖНО:
- Пиши на русском
- Передай голос и стиль гостя через цитаты
- Конкретика: цифры, названия компаний, даты, суммы ИЗ ИНТЕРВЬЮ
- Разделяй факты от мнений

🚨 ЗАПРЕТ НА ВЫДУМКИ:
- Пиши ТОЛЬКО то, что ЯВНО сказано в транскрипции!
- НЕ придумывай бэкграунд, цифры, советы
- Если транскрипция неполная — напиши по тому что есть + "⚠️ Транскрипция неполная"

${context}`;
    }

    // Default: meeting
    return `Ты — профессиональный аналитик встреч. Создай ПОЛНЫЕ подробные структурированные ЗАМЕТКИ по встрече в стиле Plaud/Otter.ai.

ФОРМАТ (markdown):
# [Название встречи]

## TL;DR
[2-3 предложения: о чём была встреча и что главное решили. Чтобы понять суть за 10 секунд.]

## Предпосылки и основная информация
[2-3 абзаца: кто участвовал, какие компании представляют, чем занимаются, контекст встречи. Справочная информация о бизнесе участников.]

## [Тема 1]: [название]
[Глубокий разбор темы, а не пересказ. Раскрой:
 - что конкретно обсуждали (цифры, факты, стратегии);
 - ПОЗИЦИИ сторон: кто что предлагал/отстаивал и ПОЧЕМУ (аргументы);
 - где был спор или расхождение, как его разрешили (или не разрешили);
 - что решили по теме и что осталось открытым.
 Упоминай участников по имени.]

## [Тема 2]: [название]
[...]

## [Тема N]
[...]

## Ключевые выводы и решения
[Список самых важных выводов, решений и договорённостей. Каждый пункт — конкретный, с именами ответственных.]
- Вывод/решение 1
- Вывод/решение 2

## Болевые точки и риски
[Проблемы, которые были озвучены. Барьеры, ограничения, риски.]

## Возможности
[Выявленные бизнес-возможности, потенциальные партнёрства, точки роста]

## План действий
[Список ВСЕХ конкретных задач с чекбоксами, ответственными и сроками]
- [ ] Задача — [Ответственный] [срок если есть]
- [ ] ...

## Следующие шаги
[Что делать дальше, какие встречи запланировать, кого привлечь]

ВАЖНО:
- Пиши на русском
- Будь конкретен: цифры, названия компаний, суммы, сроки
- Упоминай кто именно что сказал/предложил — по именам участников
- Не пропускай важные детали
- Раздел "План действий" должен содержать ВСЕ задачи из встречи

🗣️ АТРИБУЦИЯ СПИКЕРОВ (важно, но осторожно):
- Приписывай реплику/обязательство человеку ТОЛЬКО когда из транскрипции явно ясно, кто говорит (обращения по имени, представления, контекст диалога).
- Если неясно, кто произнёс фразу — пиши «(кто именно — неясно)», НЕ угадывай имя.
- Для договорённостей всегда указывай, КТО кому что пообещал (если ясно).

🚨 КРИТИЧЕСКИ ВАЖНО — ЗАПРЕТ НА ВЫДУМКИ:
- Пиши ТОЛЬКО то, что ЯВНО сказано в транскрипции!
- Если в транскрипции нет конкретных цифр — НЕ придумывай цифры
- Если в транскрипции нет конкретных советов — НЕ придумывай советы
- Если транскрипция короткая или некачественная — напиши короткие заметки по тому что ЕСТЬ, и добавь: "⚠️ Транскрипция неполная, информация может быть неточной"
- ЛУЧШЕ написать мало но точно, чем много но выдуманного

${context}`;
  }

  private getQaPrompt(meetingType: string, context: string): string {
    if (meetingType === 'lecture') {
      return `Ты — профессиональный конспектист. Создай разбор лекции в формате ВОПРОСЫ И ОТВЕТЫ — как шпаргалку для подготовки к экзамену.

ФОРМАТ (markdown):
# [Название лекции] — Q&A

## Контекст
[Кто читает лекцию, тема, для кого]

## Вопросы и ответы

### 1. [Тема]: [вопрос как на экзамене]
[Подробный ответ на основе лекции. Конкретика: цифры, примеры, определения ИЗ ЛЕКЦИИ.]

### 2. [Тема]: [вопрос]
[...]

### N. [...]

## Ключевые факты (флеш-карточки)
- **Q:** [вопрос] → **A:** [краткий ответ]
- **Q:** [вопрос] → **A:** [краткий ответ]

## Что изучить дополнительно
- [ ] Изучить [тема]
- [ ] Прочитать [книга/статья]
- [ ] Попрактиковать [метод]

ВАЖНО:
- Формулируй вопросы как преподаватель — проверяя понимание материала
- Ответы 3-8 предложений с конкретикой ИЗ ЛЕКЦИИ
- Пиши на русском
- Флеш-карточки — короткие, для быстрого повторения

🚨 ЗАПРЕТ НА ВЫДУМКИ:
- Если в лекции нет информации по теме — НЕ выдумывай
- ЛУЧШЕ 5 точных Q&A чем 15 выдуманных

${context}`;
    }

    if (meetingType === 'interview') {
      return `Ты — профессиональный аналитик интервью. Создай разбор интервью в формате ВОПРОСЫ И ОТВЕТЫ.

ФОРМАТ (markdown):
# [Название интервью] — Q&A

## Контекст
[Кто интервьюер, кто гость, тема разговора]

## Вопросы и ответы

### 1. [Тема]: [вопрос как задал бы любопытный слушатель]
[Ответ на основе того что сказал гость. Конкретные примеры, цифры, истории.]

### 2. [Тема]: [вопрос]
[...]

### N. [...]

## Советы от гостя
[Конкретные рекомендации, лайфхаки, принципы которые озвучил гость]
1. Совет 1
2. Совет 2

## Ресурсы и рекомендации
[Книги, подкасты, инструменты, люди которых упомянул гость]
- ...

## Инсайты к применению
- [ ] Применить [совет]
- [ ] Связаться с [кто]
- [ ] Изучить [что]

ВАЖНО:
- Вопросы формулируй так, как спросил бы человек, который не слушал интервью
- Ответы 3-8 предложений с конкретикой ИЗ ИНТЕРВЬЮ
- Пиши на русском

🚨 ЗАПРЕТ НА ВЫДУМКИ:
- НЕ выдумывай советы и рекомендации
- ЛУЧШЕ 5 точных Q&A чем 15 выдуманных

${context}`;
    }

    // Default: meeting
    return `Ты — профессиональный аналитик встреч. Создай подробный разбор в формате ВОПРОСЫ И ОТВЕТЫ по встрече.

ФОРМАТ (markdown):
# [Название встречи] — Q&A

## Предпосылки и основная информация
[Контекст: кто, зачем, какие компании]

## Вопросы и ответы

### 1. [Тема]: [вопрос]
[Подробный ответ с конкретикой: цифры, стратегии, примеры, риски. Кто что сказал.]

### 2. [Тема]: [вопрос]
[...]

### N. [...]

## Обязательства и обещания
[Кто что пообещал сделать, предоставить, отправить. КАЖДОЕ обещание каждого участника — отдельный пункт.]
- **[Имя]**: обязался [что именно]
- **[Имя]**: пообещал предоставить [что]

## План действий
[Чекбоксы ВСЕХ задач с ответственными — объедини из всего разговора]
- [ ] Задача — [Ответственный]

ВАЖНО:
- Вопросы и ответы только по темам, которые РЕАЛЬНО обсуждались в транскрипции
- Каждый ответ 3-8 предложений с конкретикой ИЗ ТРАНСКРИПЦИИ
- ОБЯЗАТЕЛЬНО выдели ВСЕ обязательства: "я пришлю", "я предоставлю", "я свяжусь", "я сделаю", "давайте договоримся"
- Пиши на русском
- Формулируй вопросы так, как спросил бы человек, который не был на встрече

🚨 ЗАПРЕТ НА ВЫДУМКИ:
- Если в транскрипции нет информации по теме — НЕ выдумывай ответ
- Если транскрипция короткая/неполная — сделай меньше вопросов, но точных
- ЛУЧШЕ 3 точных Q&A чем 15 выдуманных

${context}`;
  }

  async extractDraft(text: string, todayIsoOrTypeHint?: string, existingProjectNames?: string[]): Promise<ExtractionResult> {
    const isLecture = todayIsoOrTypeHint === 'lecture';
    const isInterview = todayIsoOrTypeHint === 'interview';
    const isTypeHint = isLecture || isInterview;
    const today = (todayIsoOrTypeHint && !isTypeHint) ? todayIsoOrTypeHint : new Date().toISOString().split('T')[0]!;
    const projectListBlock = existingProjectNames && existingProjectNames.length > 0
      ? `\n\nСПИСОК ПРОЕКТОВ ПОЛЬЗОВАТЕЛЯ (выбирай из этого списка, НЕ придумывай новые):\n${existingProjectNames.map(n => `- ${n}`).join('\n')}\nЕсли тема совпадает с одним из проектов — используй ТОЧНОЕ название из списка в project_hints. Если ни один не подходит — оставь project_hints пустым.`
      : '';
    const systemPrompt = `Ты помощник который превращает транскрипт голосовой заметки или свободный текст в структурированную карточку.

Верни СТРОГО JSON без пояснений со следующей схемой:
{
  "detected_type": "meeting" | "task" | "idea" | "inbox",
  "title": "краткое название 4-10 слов на русском",
  "date": "YYYY-MM-DD (сегодня, если автор явно не указал другую)",
  "project_hints": ["строка — ТОЧНОЕ название из списка проектов пользователя"],
  "company_hints": ["строка"],
  "people": ["имя как произнесено"],
  "tags_hierarchical": ["type/<type>", "project/<slug>", "company/<slug>"],
  "tags_free": ["до 5 строк на русском, короткие"],
  "summary": "2-4 предложения на русском",
  "agreements": 0,
  "tasks": ["для встречи: 0-10 задач, вытащенных из разговора"]
}

Правила:
- Всегда включи "type/<тип>" в tags_hierarchical.
- Если проект ясен — добавь "project/<транслит в kebab-case>".
- Если компания ясна — добавь "company/<транслит в kebab-case>".
- Для идей используй "category/<slug>" вместо "project/...".
- Свободные теги короткие, на русском, без спецсимволов, до 5 штук.
- Если дата не указана — сегодняшняя.
- agreements = 0 для task/idea/inbox.
- tasks = [] для task/idea/inbox.

КРИТИЧЕСКИ ВАЖНО для detected_type:
- Если в тексте упоминаются ЛЮДИ по имени + обсуждение/разговор/встреча/созвон/переговоры → ВСЕГДА "meeting", НЕ "idea".
- "idea" — только если автор описывает абстрактную мысль/концепт БЕЗ привязки к конкретным людям и событию.
- Если сомневаешься между meeting и idea → выбирай meeting.
- Если автор говорит "встреча", "встречался", "обсуждали с кем-то" — ВСЕГДА meeting.${isLecture ? '\n\nЭТО ЛЕКЦИЯ/УЧЕБНЫЙ МАТЕРИАЛ! detected_type = "meeting", но в summary сделай подробный конспект по темам: ## Оглавление, ## Ключевые тезисы, ## Определения, ## Выводы. Задачи = ["Изучить ...", "Применить ..."] — учебные задачи.' : ''}${isInterview ? '\n\nЭТО ИНТЕРВЬЮ! detected_type = "meeting", но в summary сделай разбор: кто гость, ключевые инсайты, лучшие цитаты. Задачи = ["Применить ...", "Изучить ...", "Связаться ..."] — практические действия по итогам интервью.' : ''}${projectListBlock}`;
    const userPrompt = `Сегодня: ${today}\n\nТекст:\n${text}\n\nВерни JSON.`;
    const resp = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    });
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as ExtractionResult;
    parsed.project_hints ??= [];
    parsed.company_hints ??= [];
    parsed.people ??= [];
    parsed.tags_hierarchical ??= [`type/${parsed.detected_type ?? 'inbox'}`];
    parsed.tags_free ??= [];
    parsed.tasks ??= [];
    parsed.agreements ??= 0;
    parsed.summary ??= '';
    parsed.date ??= today;
    return parsed;
  }

  async correctDraft(current: DraftCard, userText: string, existingProjectNames?: string[]): Promise<ExtractionResult> {
    const projectList = existingProjectNames && existingProjectNames.length > 0
      ? `\n\nСПИСОК ПРОЕКТОВ ПОЛЬЗОВАТЕЛЯ (выбирай ТОЛЬКО из этого списка для project_hints):\n${existingProjectNames.map(n => `- ${n}`).join('\n')}\nЕсли пользователь упоминает проект — найди ближайшее совпадение из списка. Если не находишь — оставь пустым.`
      : '';
    const resp = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: `Ты обновляешь черновик карточки по запросу пользователя. Возвращаешь JSON с точно такой же схемой: {detected_type, title, date, project_hints, company_hints, people, tags_hierarchical, tags_free, summary, agreements, tasks}. Берёшь текущие поля и применяешь правку. Если правка не касается поля — оставь как было. ВАЖНО: если пользователь говорит "встреча" или "доправляю встречу" — меняй detected_type на "meeting". Если упоминает людей — добавляй/убирай из people. Если упоминает проект — обновляй project_hints. Если говорит "Компания X" — это company_hints, НЕ project_hints. Если говорит "кого-то НЕ было" — убери из people. СТРОГО JSON без пояснений.${projectList}` },
        { role: 'user', content: `Текущий черновик:\n${JSON.stringify({
          detected_type: current.type,
          title: current.title,
          date: current.date,
          project_hints: current.projectName ? [current.projectName] : [],
          company_hints: current.companyName ? [current.companyName] : [],
          people: current.people,
          tags_hierarchical: current.tags.filter((t) => t.includes('/')),
          tags_free: current.tags.filter((t) => !t.includes('/')),
          summary: current.summary,
          agreements: 0,
          tasks: [],
        })}\n\nПравка пользователя:\n${userText}\n\nВерни обновлённый JSON.` },
      ],
      response_format: { type: 'json_object' },
    });
    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as ExtractionResult;
    parsed.project_hints ??= [];
    parsed.company_hints ??= [];
    parsed.people ??= [];
    parsed.tags_hierarchical ??= [`type/${parsed.detected_type ?? 'inbox'}`];
    parsed.tags_free ??= [];
    parsed.tasks ??= [];
    parsed.agreements ??= 0;
    parsed.summary ??= '';
    parsed.date ??= current.date;
    return parsed;
  }

  async suggestTasks(projectContext: string): Promise<TaskSuggestion[]> {
    const prompt = `Given this project context, suggest 3-5 concrete next tasks. Return ONLY a JSON array:
[{"title":"string","description":"string","priority":1-5,"urgency":1-5}]

Project context:
${projectContext}`;
    const result = await this.chat([{ role: 'user', content: prompt }]);
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as TaskSuggestion[];
  }

  async searchKnowledge(query: string, vaultContext: string): Promise<SearchResult> {
    const prompt = `Search the following vault content and answer the query. Return ONLY valid JSON:
{"answer":"string","sources":["relative/vault/paths"]}

Query: ${query}

Vault content:
${vaultContext}`;
    const result = await this.chat([{ role: 'user', content: prompt }]);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { answer: result, sources: [] };
    return JSON.parse(jsonMatch[0]) as SearchResult;
  }

  async dailyBrief(tasksContext: string, meetingsContext: string): Promise<string> {
    const prompt = `Generate a concise morning brief based on today's tasks and upcoming meetings.
Be motivating, practical, and highlight the 3 most important things to focus on today.

Tasks:
${tasksContext}

Upcoming meetings:
${meetingsContext}`;
    return this.chat([{ role: 'user', content: prompt }]);
  }

  async decomposeBhag(bhagTitle: string, bhagDescription: string, existingProjects: string[], today: string): Promise<{
    milestones: Array<{ title: string; due_date: string; tasks: Array<{ title: string; due_date?: string }>; meetings: Array<{ title: string; date?: string }> }>;
  }> {
    const resp = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.3,
      messages: [
        { role: 'system', content: `Ты декомпозируешь большую годовую цель (BHAG) на конкретные milestones и задачи.

Верни СТРОГО JSON:
{
  "milestones": [
    {
      "title": "Название milestone",
      "due_date": "YYYY-MM-DD",
      "tasks": [
        { "title": "Конкретная задача", "due_date": "YYYY-MM-DD" }
      ],
      "meetings": [
        { "title": "Встреча с кем/зачем", "date": "YYYY-MM-DD" }
      ]
    }
  ]
}

Правила:
- 4-6 milestones, распределённых по году от сегодня до конца года
- Каждый milestone: 3-5 задач
- Встречи только если реально нужны (не выдумывай)
- due_date реалистичные, от ближайшего до конца года
- Если цель связана с существующими проектами — упомяни в title задач
- Задачи конкретные и actionable (не "подумать о...", а "составить план...")

Существующие проекты пользователя: ${existingProjects.join(', ')}
Сегодня: ${today}` },
        { role: 'user', content: `BHAG: ${bhagTitle}\n${bhagDescription ? 'Описание: ' + bhagDescription : ''}\n\nДекомпозируй.` },
      ],
      response_format: { type: 'json_object' },
    });
    const raw = resp.choices[0]?.message?.content ?? '{"milestones":[]}';
    return JSON.parse(raw);
  }
}
