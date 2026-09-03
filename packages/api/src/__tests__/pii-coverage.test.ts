/**
 * 152-ФЗ: обезличивание на путях, которые не тестируются напрямую (упираются в
 * БД/Telegraf/сеть и не мокаются в проекте без большого объёма инфраструктуры —
 * тот же принцип, что уже принят в transcribe-routing.test.ts и whisper-fallback.test.ts).
 * Поведение самих pii-redact.ts функций (redactPii/restorePii/joinForRedaction/...)
 * уже проверено поведенчески в pii-redact.test.ts; здесь проверяется, что три
 * конкретных места ДЕЙСТВИТЕЛЬНО зовут их, а не молча шлют сырой текст.
 */
import * as fs from 'fs';
import * as path from 'path';

const MEETINGS_SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'meetings.ts'), 'utf-8');
const TELEGRAM_SRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'telegram.service.ts'), 'utf-8');
const SEARCH_SRC = fs.readFileSync(path.join(__dirname, '..', 'services', 'search.service.ts'), 'utf-8');

describe('routes/meetings.ts: заголовок встречи обезличивается вместе с транскриптом (regenerate-summaries)', () => {
  const handler = MEETINGS_SRC.slice(
    MEETINGS_SRC.indexOf("regenerate-summaries', async"),
    MEETINGS_SRC.indexOf('// Download meeting file'),
  );

  test('заголовок попадает в тот же вызов redactPii, что и транскрипт/участники (через joinForRedaction)', () => {
    expect(handler).toMatch(/redactPii\(joinForRedaction\(\[transcript, title, people\.join\('\\n'\)\]\)\)/);
  });

  test('generateProSummaries вызывается уже обезличенным заголовком, а не сырым meeting.title', () => {
    const callAt = handler.indexOf('claudeSvc.generateProSummaries(');
    const call = handler.slice(callAt, handler.indexOf(')', callAt) + 1);
    expect(call).toContain('redactedTitle');
    expect(call).not.toContain("meeting['title']");
  });
});

describe('services/telegram.service.ts: захват встречи (главный канал продукта) обезличивается на обоих вызовах модели', () => {
  test('extractDraft (первичное распознавание драфта) зовётся с обезличенным транскриптом', () => {
    const fn = TELEGRAM_SRC.slice(
      TELEGRAM_SRC.indexOf('private async buildAndSendDraft'),
      TELEGRAM_SRC.indexOf('const card = this.drafts.create'),
    );
    const redactAt = fn.indexOf('redactPii(transcript)');
    const callAt = fn.indexOf('claude.extractDraft(');
    expect(redactAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(redactAt);
    expect(fn.slice(callAt, callAt + 60)).toContain('redactedTranscript');
    // результат восстанавливается ПОЛНОСТЬЮ (все поля), а не только summary
    expect(fn).toMatch(/restorePiiDeepAndWarn\(rawExtraction, piiMap/);
  });

  test('generateProSummaries (сохранение драфта) зовётся с обезличенными transcript+title+people', () => {
    const fn = TELEGRAM_SRC.slice(
      TELEGRAM_SRC.indexOf('private async saveDraftAsIs'),
      TELEGRAM_SRC.indexOf('} else if (draft.type ==='),
    );
    const redactAt = fn.indexOf("redactPii(joinForRedaction([draft.transcript, draft.title, draft.people.join('\\n')]))");
    const callAt = fn.indexOf('claude.generateProSummaries(');
    expect(redactAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(redactAt);
    const call = fn.slice(callAt, fn.indexOf(')', callAt) + 1);
    expect(call).toContain('redactedTranscript');
    expect(call).toContain('redactedTitle');
    expect(call).toContain('redactedPeople');
    expect(call).not.toContain('draft.transcript');
    expect(call).not.toContain('draft.title');
    // notes/qa/actions восстанавливаются перед сохранением в БД/vault
    expect(fn).toMatch(/restorePiiAndWarn\(rawSummaries\.notes, piiMap/);
    expect(fn).toMatch(/restorePiiAndWarn\(rawSummaries\.qa, piiMap/);
  });
});

describe('services/search.service.ts: синхронизация из vault обезличивает тело встречи перед extractActionItems', () => {
  // Якорь без слова private: метод стал публичным, когда извлечение
  // обязательств подключили к созданию встречи через API. Модификатор
  // доступа к обезличиванию отношения не имеет, поэтому в якорь не входит —
  // иначе безобидная правка сигнатуры молча выключает эту проверку.
  const fn = SEARCH_SRC.slice(
    SEARCH_SRC.indexOf('async extractTasksFromMeeting'),
    SEARCH_SRC.indexOf('/** Archive DB records'),
  );

  test('body/title/peopleNames обезличиваются одним вызовом redactPii перед extractActionItems', () => {
    const redactAt = fn.indexOf("redactPii(joinForRedaction([body, title, peopleNames.join('\\n')]))");
    const callAt = fn.indexOf('claude.extractActionItems(');
    expect(redactAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(redactAt);
    const call = fn.slice(callAt, fn.indexOf(')', callAt) + 1);
    expect(call).toContain('redactedBody');
    expect(call).toContain('redactedTitle');
    expect(call).toContain('redactedPeopleNames');
  });

  test('результат восстанавливается через restorePiiDeepAndWarn ДО использования owner/quote (поиск person по имени, текст задачи)', () => {
    const restoreAt = fn.indexOf('restorePiiDeepAndWarn(rawItems, piiMap');
    const ownerUseAt = fn.indexOf('it.owner');
    expect(restoreAt).toBeGreaterThan(-1);
    expect(ownerUseAt).toBeGreaterThan(restoreAt);
  });
});
