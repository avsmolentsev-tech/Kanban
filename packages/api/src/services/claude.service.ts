import OpenAI from 'openai';
import { config } from '../config';
import type { MeetingStructured, InboxAnalysis } from '@pis/shared';
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

  constructor() {
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
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

  async chat(messages: Array<{ role: 'user' | 'assistant'; content: string }>, systemPrompt = '', model?: string, useTools = false, jsonMode = false): Promise<string> {
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
          const result = await executeTool(toolCall.function.name, args);
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
        const { getDb } = require('../db/db');
        const db = getDb();
        db.prepare("INSERT INTO usage_logs (type, model, tokens_in, tokens_out, detail) VALUES (?, ?, ?, ?, ?)").run(
          'ai_chat', selectedModel, usage.prompt_tokens || 0, usage.completion_tokens || 0, ''
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
    const result = await this.chat([{ role: 'user', content: prompt }], '', 'gpt-4.1', false, true);
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
}
