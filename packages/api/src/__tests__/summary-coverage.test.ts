/**
 * Конспект, Q&A и задачи должны покрывать ВСЮ встречу, а не её начало.
 * Раньше час резался трижды: транскрипт до 30 000 символов, вывод модели
 * потолком в 8192 токена (молча, без единого признака обрыва) и документы
 * Notes/Q&A до 10 000 символов перед извлечением задач.
 */
import { ClaudeService } from '../services/claude.service';

type Call = { max_tokens?: number; max_completion_tokens?: number; messages: Array<{ content: string }> };

/** Подменяет клиента OpenAI и копит все запросы. */
function stub(svc: ClaudeService, reply: (call: Call, index: number) => string, finishReason = 'stop'): Call[] {
  const calls: Call[] = [];
  (svc as unknown as { client: unknown }).client = {
    chat: {
      completions: {
        create: async (opts: Call) => {
          calls.push(opts);
          return {
            choices: [{ message: { content: reply(opts, calls.length - 1) }, finish_reason: finishReason }],
          };
        },
      },
    },
  };
  return calls;
}

describe('лимит вывода', () => {
  test('по умолчанию остаётся 8192 — поведение остальных вызовов не тронуто', async () => {
    const svc = new ClaudeService();
    const calls = stub(svc, () => 'ответ');
    await svc.chat([{ role: 'user', content: 'привет' }]);
    expect(calls[0]!.max_tokens).toBe(8192);
  });

  test('переданный лимит доезжает до запроса', async () => {
    const svc = new ClaudeService();
    const calls = stub(svc, () => 'ответ');
    await svc.chat([{ role: 'user', content: 'привет' }], '', 'gpt-4.1-mini', false, false, null, 16384);
    expect(calls[0]!.max_tokens).toBe(16384);
  });

  test('обрыв по лимиту больше не проходит молча', async () => {
    const svc = new ClaudeService();
    stub(svc, () => 'оборванный текст', 'length');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await svc.chat([{ role: 'user', content: 'привет' }]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/обрезан лимитом вывода/));
    warn.mockRestore();
  });
});

describe('generateProSummaries покрывает встречу целиком', () => {
  /** ~час русской речи. */
  const hourTranscript = 'Обсудили план на квартал и сроки поставки. '.repeat(1400);

  test('конспект и Q&A запрашиваются с поднятым лимитом вывода', async () => {
    const svc = new ClaudeService();
    const calls = stub(svc, () => 'конспект');
    await svc.generateProSummaries(hourTranscript, 'Встреча', ['Максим']);

    expect(calls[0]!.max_tokens).toBe(16384);
    expect(calls[1]!.max_tokens).toBe(16384);
  });

  test('транскрипт часовой встречи доезжает до модели целиком', async () => {
    const svc = new ClaudeService();
    const calls = stub(svc, () => 'конспект');
    expect(hourTranscript.length).toBeGreaterThan(50000); // час речи и правда столько

    await svc.generateProSummaries(hourTranscript, 'Встреча', []);

    const sent = calls[0]!.messages.at(-1)!.content;
    expect(sent).toContain(hourTranscript.slice(-200)); // хвост записи на месте
  });

  test('задачи извлекаются из полного конспекта, а не из первых 10 000 символов', async () => {
    const svc = new ClaudeService();
    // Конспект длиннее прежнего лимита, с маркером в самом конце
    const longNotes = 'Пункт конспекта про сроки. '.repeat(1200) + 'ФИНАЛЬНАЯ_ЗАДАЧА_В_КОНЦЕ';
    const calls = stub(svc, (_c, i) => (i < 2 ? longNotes : '- [ ] задача'));

    const out = await svc.generateProSummaries(hourTranscript, 'Встреча', []);

    expect(longNotes.length).toBeGreaterThan(10000); // прежний лимит бы сработал
    const actionsPrompt = calls[2]!.messages.at(-1)!.content;
    expect(actionsPrompt).toContain('ФИНАЛЬНАЯ_ЗАДАЧА_В_КОНЦЕ');
    expect(out.actions).toBe('- [ ] задача');
  });

  test('извлечение задач тоже не упирается в 8192 токена', async () => {
    const svc = new ClaudeService();
    const calls = stub(svc, () => 'текст');
    await svc.generateProSummaries(hourTranscript, 'Встреча', []);
    expect(calls[2]!.max_tokens).toBe(16384);
  });
});
