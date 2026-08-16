import { sanitizeTranscript, transcriptQuality } from '../services/transcript-sanitize';

describe('sanitizeTranscript', () => {
  test('оставляет нормальную речь без изменений', () => {
    const raw = 'Давайте начнём встречу.\nПервый вопрос — сроки по проекту.\nЯ думаю, успеем к пятнице.';
    const r = sanitizeTranscript(raw);
    expect(r.text).toBe(raw);
    expect(r.removedUnits).toBe(0);
    expect(r.loopDetected).toBe(false);
  });

  test('схлопывает петлю "Музыка" в конце часовой расшифровки', () => {
    const speech = 'Обсудили бюджет на третий квартал.\nРешили перенести релиз.';
    const loop = Array(120).fill('Музыка').join('\n');
    const r = sanitizeTranscript(`${speech}\n${loop}`);

    expect(r.loopDetected).toBe(true);
    expect(r.text).toContain('Обсудили бюджет на третий квартал.');
    expect(r.text).toContain('Решили перенести релиз.');
    expect(r.text).not.toMatch(/Музыка/i);
    expect(r.removedUnits).toBe(120);
  });

  test('ловит петлю внутри одной строки (формат OpenAI — сплошной абзац)', () => {
    const r = sanitizeTranscript('Всем спасибо за встречу. Музыка. Музыка. Музыка. Музыка. Музыка. Музыка.');
    expect(r.loopDetected).toBe(true);
    expect(r.text).toContain('Всем спасибо за встречу.');
    expect(r.text).not.toMatch(/Музыка/i);
  });

  test('вычищает известные артефакты Whisper в скобках и без', () => {
    const r = sanitizeTranscript('[Музыка]\nНачинаем.\n(аплодисменты)\nПродолжение следует...\nСубтитры сделал DimaTorzok');
    expect(r.text).toBe('Начинаем.');
    expect(r.removedUnits).toBe(4);
  });

  test('схлопывает повтор любой фразы, не только известных артефактов', () => {
    const loop = Array(30).fill('Я не знаю, что сказать.').join(' ');
    const r = sanitizeTranscript(`Итог обсуждения такой. ${loop}`);
    expect(r.loopDetected).toBe(true);
    expect(r.text).toContain('Итог обсуждения такой.');
    // одно вхождение остаётся — это могла быть реальная реплика
    expect(r.text.match(/Я не знаю, что сказать\./g)).toHaveLength(1);
  });

  test('не трогает короткие законные повторы', () => {
    const raw = 'Да. Да. Хорошо, договорились.';
    const r = sanitizeTranscript(raw);
    expect(r.text).toBe(raw);
    expect(r.loopDetected).toBe(false);
  });

  test.each([
    'Корректор нужен на следующей неделе.',
    'Субтитры мы закажем позже.',
    'Тишина.',
    'Редактор ушёл в отпуск.',
  ])('не выбрасывает живую короткую реплику: %s', (line) => {
    const raw = `Начали обсуждение.\n${line}\nПошли дальше.`;
    const r = sanitizeTranscript(raw);
    expect(r.text).toContain(line);
    expect(r.removedUnits).toBe(0);
  });

  test('не считает артефактом длинную фразу, начинающуюся со слова "субтитры"', () => {
    const raw = 'Субтитры к обучающему видео мы решили заказать у подрядчика в следующем квартале.';
    const r = sanitizeTranscript(raw);
    expect(r.text).toBe(raw);
    expect(r.removedUnits).toBe(0);
  });

  test('пустой вход не ломает', () => {
    expect(sanitizeTranscript('').text).toBe('');
    expect(sanitizeTranscript('   \n  ').text).toBe('');
  });
});

describe('transcriptQuality', () => {
  test('час речи с нормальной плотностью — ok', () => {
    const text = 'а'.repeat(55000);
    const q = transcriptQuality(text, 3600);
    expect(q.suspicious).toBe(false);
  });

  test('час аудио и две страницы текста — подозрительно', () => {
    const text = 'а'.repeat(3500);
    const q = transcriptQuality(text, 3600);
    expect(q.suspicious).toBe(true);
    expect(q.charsPerMinute).toBeLessThan(100);
  });

  test('без длительности не делает выводов', () => {
    const q = transcriptQuality('короткий текст', null);
    expect(q.suspicious).toBe(false);
  });
});
