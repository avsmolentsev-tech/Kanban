import OpenAI from 'openai';
import { config } from '../config';
import type { MeetingStructured, InboxAnalysis } from '@pis/shared';

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

  async chat(messages: Array<{ role: 'user' | 'assistant'; content: string }>, systemPrompt = ''): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: this.buildSystemPrompt(systemPrompt) },
        ...messages,
      ],
    });
    return response.choices[0]?.message?.content ?? '';
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
    const prompt = `Analyze this content (file type: ${fileType}) and return ONLY valid JSON:
{"detected_type":"meeting|idea|task|material|unknown","title":"string","date":"YYYY-MM-DD or null","people":["names"],"project_hints":["names"],"agreements":["strings"],"tasks":["strings"],"ideas":["strings"],"summary":"2-3 sentences","key_facts":["strings"],"tags":["strings"]}

Content:
${text}`;
    const result = await this.chat([{ role: 'user', content: prompt }]);
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude did not return valid JSON for inbox analysis');
    return JSON.parse(jsonMatch[0]) as InboxAnalysis;
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
