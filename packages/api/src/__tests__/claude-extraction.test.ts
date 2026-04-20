import { ClaudeService } from '../services/claude.service';

describe('extractDraft', () => {
  test('returns a parsed ExtractionResult when OpenAI replies with valid JSON', async () => {
    const svc = new ClaudeService();
    const mockResp = {
      detected_type: 'meeting',
      title: 'Обсуждение прототипа',
      date: '2026-04-16',
      project_hints: ['Роботы-мойщики'],
      company_hints: ['Keenon Robotics'],
      people: ['Максим'],
      tags_hierarchical: ['type/meeting', 'project/roboty-mojshiki', 'company/keenon-robotics'],
      tags_free: ['прототип'],
      summary: 'Обсудили прототип',
      agreements: 1,
      tasks: ['Подготовить TZ'],
    };
    // @ts-expect-error monkey-patch the internal openai client
    svc.openai = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(mockResp) } }] }) } } };
    const out = await svc.extractDraft('Встретились с Максимом из Keenon Robotics');
    expect(out).toEqual(mockResp);
  });

  test('fills defaults when OpenAI returns sparse JSON', async () => {
    const svc = new ClaudeService();
    // @ts-expect-error
    svc.openai = { chat: { completions: { create: async () => ({ choices: [{ message: { content: '{"detected_type":"inbox","title":"t","summary":"s"}' } }] }) } } };
    const out = await svc.extractDraft('x');
    expect(out.project_hints).toEqual([]);
    expect(out.company_hints).toEqual([]);
    expect(out.people).toEqual([]);
    expect(out.tags_hierarchical).toEqual(['type/inbox']);
    expect(out.tags_free).toEqual([]);
    expect(out.tasks).toEqual([]);
    expect(out.agreements).toBe(0);
    expect(out.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
