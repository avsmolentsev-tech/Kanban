import {
  redactPii, restorePii, findResidualPiiTokens,
  joinForRedaction, splitRedacted, restorePiiDeep, restorePiiDeepAndWarn, restorePiiAndWarn,
} from '../services/pii-redact';

describe('обезличивание перед отправкой в модель', () => {
  test('телефон в любом формате заменяется на токен', () => {
    const r = redactPii('Позвони на +7 916 123-45-67 после шести');
    expect(r.text).not.toContain('916');
    expect(r.text).toMatch(/\[ТЕЛЕФОН_\d+\]/);
  });

  test('email заменяется на токен', () => {
    const r = redactPii('Пиши на ivan.petrov@example.com');
    expect(r.text).not.toContain('ivan.petrov@example.com');
    expect(r.text).toMatch(/\[EMAIL_\d+\]/);
  });

  test('одинаковые значения получают один и тот же токен', () => {
    const r = redactPii('Звонить на +79161234567. Ещё раз: +79161234567');
    const tokens = [...r.text.matchAll(/\[ТЕЛЕФОН_(\d+)\]/g)].map((m) => m[1]);
    expect(new Set(tokens).size).toBe(1);
  });

  test('таблица соответствия позволяет восстановить исходный текст', () => {
    const original = 'Иван Петров, +7 916 123-45-67, ivan@example.com';
    const r = redactPii(original);
    expect(restorePii(r.text, r.map)).toBe(original);
  });

  test('обычная речь без ПД не меняется', () => {
    const original = 'Обсудили бюджет на третий квартал и сроки релиза.';
    expect(redactPii(original).text).toBe(original);
  });

  test('ФИО из двух слов с заглавных заменяется на Участника', () => {
    const r = redactPii('Иван Петров сказал, что успеет');
    expect(r.text).not.toContain('Иван Петров');
    expect(r.text).toMatch(/\[УЧАСТНИК_\d+\]/);
  });

  // Компромисс (подробно — в комментарии у FULLNAME в pii-redact.ts и в отчёте задачи):
  // брифовый вариант регулярки отсекал капитализацию в начале предложения, но на
  // синтетической проверке это оказалось причиной реальной утечки — в транскриптах
  // встреч реплики почти всегда оформлены как «Имя Фамилия: текст» с новой строки,
  // то есть ровно там, где такое исключение срабатывает. Поэтому тест из брифа
  // («начало предложения не принимается за ФИО») сознательно ослаблен: пропуск
  // настоящего имени — утечка, лишняя замена в служебной фразе — нет.
  test('капитализация в начале предложения — известный компромисс, тоже редактируется', () => {
    // Раньше это был кейс "не должно измениться". Проверка перевёрнута намеренно:
    // защита от утечки ФИО важнее точности на этом крае случаев.
    const original = 'Сроки Горят потому что подрядчик молчит';
    const r = redactPii(original);
    expect(r.text).not.toBe(original);
    expect(r.text).toMatch(/\[УЧАСТНИК_\d+\]/);
  });

  test('ФИО в роли метки спикера («Имя Фамилия: реплика») тоже обезличивается', () => {
    // Ровно тот кейс, который сломало прежнее исключение по границе предложения:
    // метка спикера стоит после переноса строки, то есть формально «в начале предложения».
    const r = redactPii('Встреча началась.\nИван Петров: добрый день, все на связи?');
    expect(r.text).not.toContain('Иван Петров');
    expect(r.text).toMatch(/\[УЧАСТНИК_\d+\]/);
  });
});

/**
 * Найдено ревью Задачи 4: регулярка из брифа при тройном ФИО оставляла фамилию —
 * самый идентифицирующий компонент — в открытом виде, а одиночные имена и латиница
 * не покрывались вовсе. Разбор по каждому пункту таблицы ревью — ниже.
 */
describe('ФИО: тройная форма, латиница, сокращения, одиночные упоминания', () => {
  test('тройное ФИО «Имя Отчество Фамилия» обезличивается целиком, фамилия не утекает', () => {
    const r = redactPii('Иван Петрович Сидоров подтвердил договор');
    expect(r.text).not.toContain('Сидоров');
    expect(r.text).not.toContain('Иван');
    expect(r.text).not.toContain('Петрович');
    expect(r.text).toBe('[УЧАСТНИК_1] подтвердил договор');
  });

  test('тройное ФИО в порядке «Фамилия Имя Отчество» тоже обезличивается целиком', () => {
    const r = redactPii('Петров Иван Петрович, паспорт 4510 123456');
    expect(r.text).not.toContain('Петров');
    expect(r.text).not.toContain('Петрович');
    expect(r.text).toMatch(/^\[УЧАСТНИК_\d+\], паспорт/);
  });

  test('латинские имена («John Smith») обезличиваются', () => {
    const r = redactPii('Созвон с John Smith и Anna Lee завтра');
    expect(r.text).not.toContain('John Smith');
    expect(r.text).not.toContain('Anna Lee');
    expect(r.text).toMatch(/\[УЧАСТНИК_\d+\] и \[УЧАСТНИК_\d+\]/);
  });

  test('форма «Имя И.» (один-два инициала после) обезличивается', () => {
    const r = redactPii('Ольга К. была на связи');
    expect(r.text).not.toContain('Ольга К.');
    expect(r.text).toMatch(/\[УЧАСТНИК_\d+\] была на связи/);
  });

  test('форма «И. Фамилия» (инициал перед фамилией) обезличивается', () => {
    const r = redactPii('А. Смирнов подтвердил встречу');
    expect(r.text).not.toContain('А. Смирнов');
    expect(r.text).toMatch(/\[УЧАСТНИК_\d+\] подтвердил встречу/);
  });

  test('форма «И.О. Фамилия» (два инициала) тоже обезличивается', () => {
    const r = redactPii('Как договорились с И.О. Петровым');
    expect(r.text).not.toContain('Петровым');
  });

  test('одиночное имя, встреченное ранее как компонент найденного ФИО, тоже обезличивается', () => {
    // Ровно та реальная утечка, которую я поймал на синтетическом транскрипте:
    // спикер представлен полным именем один раз («Иван Петров:»), дальше по
    // тексту к нему обращаются по имени. Без этого прохода «Иван» оставался
    // в открытом виде на каждом следующем упоминании.
    const r = redactPii('Иван Петров: добрый день. Иван, расскажи про бюджет.');
    expect(r.text).not.toContain('Иван');
  });

  // Найдено вторым ревью (Important 2): раньше одиночное упоминание получало ТОТ ЖЕ
  // токен, что и полное имя, и restorePii подставляло обратно ВСЮ фразу — удобно
  // выглядело для настоящих имён, но ломалось на ложных срабатываниях ФИО (см.
  // describe ниже «второй проход не путает обычные слова»). Починка — отдельный
  // токен на каждое слово, круговой прогон обязан возвращать исходный текст.
  test('круговой прогон одиночного упоминания восстанавливает исходный текст дословно', () => {
    const original = 'Иван Петров: добрый день. Иван, расскажи про бюджет.';
    const r = redactPii(original);
    expect(restorePii(r.text, r.map)).toBe(original);
  });

  // Известная и осознанная граница метода (см. комментарий у redactPii): полностью
  // изолированное упоминание имени без единого другого упоминания того же человека
  // во всём тексте нечем связать — регулярка без словаря имён этого не решает.
  // Компромисс тот же принцип, что и раньше: пропуск связанного имени — утечка,
  // изолированное совпадающее слово без единого якоря в тексте — задокументированный
  // остаточный пробел метода "без словаря", а не тихая недоработка.
  test('документированная граница: полностью изолированное имя без якоря в тексте не ловится', () => {
    const original = 'Иван, ты успеешь? — Да, Маша всё сделает.';
    expect(redactPii(original).text).toBe(original);
  });
});

/**
 * Найдено вторым ревью (Critical 2): жадное необязательное третье слово в FULLNAME
 * съедало имя СЛЕДУЮЩЕГО человека, оставляя его фамилию в открытом виде —
 * ровно та утечка, от которой должна защищать сама тройная форма.
 */
describe('ФИО: два имени подряд не сливаются в одно (Critical 2)', () => {
  test('«Имя Фамилия Имя Фамилия» — два отдельных участника, вторая фамилия не утекает', () => {
    const r = redactPii('Иван Петров Мария Соколова подтвердили бюджет');
    expect(r.text).not.toContain('Соколова');
    expect(r.text).not.toContain('Мария');
    expect(r.text).not.toContain('Петров');
    expect(r.text).not.toContain('Иван');
    expect(r.text).toBe('[УЧАСТНИК_1] [УЧАСТНИК_2] подтвердили бюджет');
    expect(r.map['[УЧАСТНИК_1]']).toBe('Иван Петров');
    expect(r.map['[УЧАСТНИК_2]']).toBe('Мария Соколова');
  });

  test('три имени подряд («А Б», «В Г» и «Д Е») — три отдельных участника, ни одна фамилия не утекает', () => {
    const r = redactPii('На связи Иван Петров Сергей Кузнецов и Анна Лебедева');
    expect(r.text).not.toContain('Кузнецов');
    expect(r.text).not.toContain('Лебедева');
    expect(r.text).toMatch(/На связи \[УЧАСТНИК_\d+\] \[УЧАСТНИК_\d+\] и \[УЧАСТНИК_\d+\]/);
  });

  test('настоящая тройная форма «Имя Отчество Фамилия» по-прежнему не ломается этой правкой', () => {
    const r = redactPii('Иван Петрович Сидоров подтвердил договор');
    expect(r.text).toBe('[УЧАСТНИК_1] подтвердил договор');
  });
});

/**
 * Найдено вторым ревью (Important 2): второй проход по одиночным словам портил
 * СОХРАНЯЕМЫЙ текст на обычных повторяющихся словах, случайно зарегистрированных
 * как компонент ложно распознанного «ФИО» где-то раньше в тексте.
 */
describe('второй проход не путает обычные слова с частями имени (Important 2)', () => {
  test('«Сроки Горят … Сроки сдвинули на май» — второе «Сроки» не тянет за собой «Горят»', () => {
    const original = 'Сроки Горят потому что подрядчик молчит. Сроки сдвинули на май.';
    const r = redactPii(original);
    expect(restorePii(r.text, r.map)).toBe(original);
  });

  test('«Москва Сити … Москва потом обсудим» — второе «Москва» не тянет за собой «Сити»', () => {
    const original = 'Встреча в Москва Сити. Москва потом обсудим.';
    const r = redactPii(original);
    expect(restorePii(r.text, r.map)).toBe(original);
  });

  test('«Совет Директоров … Директоров вызвали» — второе слово (не первое) тоже не тянет фразу целиком', () => {
    const original = 'Совет Директоров утвердил. Директоров вызвали.';
    const r = redactPii(original);
    expect(restorePii(r.text, r.map)).toBe(original);
  });
});

describe('телефоны: границы и дополнительные форматы (найдено ревью)', () => {
  test('мобильный без кода страны, продиктованный вслух («916 123-45-67»), ловится', () => {
    const r = redactPii('Мой номер 916 123-45-67, звоните');
    expect(r.text).not.toContain('916');
    expect(r.text).toMatch(/\[ТЕЛЕФОН_\d+\]/);
  });

  test('международный номер не-RU кода («+375 29 1234567») ловится', () => {
    const r = redactPii('Партнёр из Минска: +375 29 1234567');
    expect(r.text).not.toContain('1234567');
    expect(r.text).toMatch(/\[ТЕЛЕФОН_\d+\]/);
  });

  test('длинное число, начинающееся как телефон («Заказ 89161234567890»), не матчится частично', () => {
    // Раньше матчились первые 11 цифр, а "890" утекало наружу — обрывок числа
    // выглядел как обезличивание, но им не был.
    const original = 'Заказ 89161234567890 в обработке';
    const r = redactPii(original);
    expect(r.text).toBe(original);
  });
});

describe('restorePii: терпимость к регистру/разделителю и остаточные токены (найдено ревью)', () => {
  const map = { '[УЧАСТНИК_1]': 'Иван Петров' };

  test('разный регистр токена от модели восстанавливается', () => {
    expect(restorePii('[Участник_1] подтвердил.', map)).toBe('Иван Петров подтвердил.');
  });

  test('пробел вместо подчёркивания в токене восстанавливается', () => {
    expect(restorePii('[УЧАСТНИК 1] подтвердил.', map)).toBe('Иван Петров подтвердил.');
  });

  test('несуществующий номер токена остаётся как есть, не обрушивает текст', () => {
    const text = 'Резюме: [УЧАСТНИК_99] встретился.';
    expect(restorePii(text, map)).toBe(text);
  });

  test('findResidualPiiTokens находит нераспознанный токен и не содержит значений из карты', () => {
    const restored = restorePii('Резюме: [УЧАСТНИК_99] встретился.', map);
    const residual = findResidualPiiTokens(restored);
    expect(residual).toEqual(['[УЧАСТНИК_99]']);
    expect(residual.join(' ')).not.toContain('Иван Петров');
  });

  test('findResidualPiiTokens пуст, когда всё успешно восстановлено', () => {
    const restored = restorePii('[участник_1] подтвердил.', map);
    expect(findResidualPiiTokens(restored)).toEqual([]);
  });

  /**
   * Регресс: без-скобочный вариант ловил только ASCII-`\b`, которая не видит
   * границу пробел/кириллица — «Участник 1» никогда не находился, хотя это
   * ровно тот случай, ради которого без-скобочная ветка была добавлена.
   */
  test('findResidualPiiTokens находит токен, пересказанный словами без скобок («Участник 1»)', () => {
    expect(findResidualPiiTokens('Участник 1 подтвердил встречу')).toEqual(['Участник 1']);
  });

  test('findResidualPiiTokens без скобок нечувствителен к регистру и разделителю', () => {
    expect(findResidualPiiTokens('см. участник_2 и ТЕЛЕФОН 3')).toEqual(
      expect.arrayContaining(['участник_2', 'ТЕЛЕФОН 3'])
    );
  });

  test('findResidualPiiTokens без скобок не путает обычное слово, слитое с числом', () => {
    // "Участник1" без разделителя и "НЕучастник 5" (слово приклеено) — не токены.
    expect(findResidualPiiTokens('НЕучастник 5 пришёл, Участник1 тоже')).toEqual([]);
  });

  test('findResidualPiiTokens: обычный текст без искажённых токенов остаётся пустым', () => {
    expect(findResidualPiiTokens('Обсудили бюджет и сроки, всё как обычно.')).toEqual([]);
  });
});

/**
 * joinForRedaction/splitRedacted/restorePiiDeep(AndWarn)/restorePiiAndWarn — вспомогательные
 * функции, которыми пользуются все места, где транскрипт отправляется в модель вместе с
 * отдельными полями (заголовок, список участников): routes/meetings.ts (резюме и
 * regenerate-summaries), services/telegram.service.ts (захват встречи из Telegram),
 * services/search.service.ts (синхронизация из vault). До этой задачи они не были покрыты
 * тестами вовсе, хотя уже использовались в routes/meetings.ts.
 */
describe('joinForRedaction/splitRedacted: склейка нескольких полей в один вызов redactPii', () => {
  test('одно и то же имя (буквально та же строка) в двух разных полях получает один и тот же токен', () => {
    // redactPii не лемматизирует — совпадение строгое по подстроке. Реалистичный
    // случай единого токена — когда оба поля используют одну и ту же форму имени,
    // например транскрипт и `people`, взятый как есть из таблицы `people`.
    const combined = joinForRedaction(['Утром звонил Иван Петров, обсуждали дела', 'Иван Петров']);
    const { text, map } = redactPii(combined);
    const parts = splitRedacted(text, 2);
    const tokenInTranscript = parts[0]!.match(/\[УЧАСТНИК_\d+\]/)![0];
    const tokenInTitle = parts[1]!.trim();
    expect(tokenInTranscript).toBe(tokenInTitle);
    expect(map[tokenInTranscript]).toBe('Иван Петров');
  });

  test('splitRedacted восстанавливает ровно count частей даже для пустых полей', () => {
    const combined = joinForRedaction(['транскрипт', '', 'Иван, Мария']);
    const { text } = redactPii(combined);
    const parts = splitRedacted(text, 3);
    expect(parts).toHaveLength(3);
    expect(parts[1]).toBe('');
  });

  test('round-trip: join → redact → split → restore на каждой части даёт исходные поля', () => {
    const fields = ['Позвони Ивану Петрову', 'Иван Петров', 'нет темы'];
    const { text, map } = redactPii(joinForRedaction(fields));
    const parts = splitRedacted(text, 3);
    const restored = parts.map((p) => restorePii(p, map));
    expect(restored).toEqual(fields);
  });
});

describe('restorePiiDeep(AndWarn): восстановление ПД в структурированном JSON-ответе модели', () => {
  const original = 'Иван Петров, его телефон +7 916 123-45-67';
  const { text: redacted, map } = redactPii(original);

  test('восстанавливает ПД во вложенных строковых полях объекта и массивов', () => {
    const modelResponse = {
      title: redacted,
      people: [redacted.match(/\[УЧАСТНИК_\d+\]/)![0]],
      nested: { note: redacted },
    };
    const restored = restorePiiDeep(modelResponse, map);
    expect(restored.title).toBe(original);
    expect(restored.people[0]).toBe('Иван Петров');
    expect(restored.nested.note).toBe(original);
  });

  test('не трогает числа/булевы/null внутри объекта', () => {
    const restored = restorePiiDeep({ ok: true, count: 3, note: null as string | null }, map);
    expect(restored).toEqual({ ok: true, count: 3, note: null });
  });

  test('restorePiiDeepAndWarn логирует остаточный токен, пересказанный словами, и не бросает исключение', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mangled = { summary: 'Обсудили с Участник 1 планы' };
    const restored = restorePiiDeepAndWarn(mangled, map, 'test-context');
    expect(restored.summary).toBe('Обсудили с Участник 1 планы'); // не восстановлено — не найдено в карте
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('test-context'), expect.arrayContaining(['Участник 1']));
    warnSpy.mockRestore();
  });
});

describe('restorePiiAndWarn: восстановление плоского текста + предупреждение об остатках', () => {
  test('восстанавливает без предупреждения, когда всё сошлось', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { text, map } = redactPii('Звонил Иван Петров');
    const restored = restorePiiAndWarn(text, map, 'ctx');
    expect(restored).toBe('Звонил Иван Петров');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('предупреждает и не роняет вызывающий код при искажённом токене', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { map } = redactPii('Звонил Иван Петров');
    expect(() => restorePiiAndWarn('Звонил [УЧАСТНИК_99]', map, 'ctx')).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
