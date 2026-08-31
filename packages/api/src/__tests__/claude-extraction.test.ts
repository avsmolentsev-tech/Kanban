import { ClaudeService, PII_TOKEN_NOTE } from '../services/claude.service';

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

  /**
   * 152-ФЗ: telegram.service.ts обезличивает транскрипт перед вызовом extractDraft
   * и рассчитывает, что модель вернёт плейсхолдеры (`[УЧАСТНИК_1]` и т.п.) дословно,
   * чтобы restorePiiDeepAndWarn на стороне вызывающего кода мог подставить обратно
   * реальные имена. Без PII_TOKEN_NOTE в systemPrompt модель не знает про этот
   * контракт и может исказить токен или выдумать имя вместо него.
   */
  test('systemPrompt содержит инструкцию про PII-токены (PII_TOKEN_NOTE)', async () => {
    const svc = new ClaudeService();
    let capturedSystemPrompt = '';
    // @ts-expect-error monkey-patch the internal openai client
    svc.openai = { chat: { completions: { create: async (opts: any) => {
      capturedSystemPrompt = opts.messages.find((m: { role: string }) => m.role === 'system')?.content ?? '';
      return { choices: [{ message: { content: '{"detected_type":"meeting","title":"t","summary":"s","people":["[УЧАСТНИК_1]"]}' } }] };
    } } } };
    const out = await svc.extractDraft('[УЧАСТНИК_1] сказал, что перезвонит');
    expect(capturedSystemPrompt).toContain(PII_TOKEN_NOTE);
    // модель может дословно вернуть токен вместо имени — это ожидаемо и корректно
    expect(out.people).toEqual(['[УЧАСТНИК_1]']);
  });
});

describe('extractActionItems', () => {
  /**
   * 152-ФЗ: search.service.ts (синхронизация из vault) обезличивает транскрипт,
   * заголовок и список участников перед extractActionItems и восстанавливает ПД
   * во всём результате через restorePiiDeepAndWarn — тот же контракт, что и у
   * extractDraft. Раньше эта функция не содержала PII_TOKEN_NOTE вовсе.
   */
  test('промпт для каждого чанка содержит инструкцию про PII-токены (PII_TOKEN_NOTE)', async () => {
    const svc = new ClaudeService();
    const chatSpy = jest.spyOn(ClaudeService.prototype, 'chat').mockResolvedValue('{"items":[]}');
    await svc.extractActionItems('[УЧАСТНИК_1] обещал прислать документы', 'Встреча', ['[УЧАСТНИК_1]']);
    expect(chatSpy).toHaveBeenCalled();
    const userMessage = chatSpy.mock.calls[0]![0][0]!.content;
    expect(userMessage).toContain(PII_TOKEN_NOTE);
    chatSpy.mockRestore();
  });
});
