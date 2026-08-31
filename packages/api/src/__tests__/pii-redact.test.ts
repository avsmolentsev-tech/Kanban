import {
  redactPii, restorePii, findResidualPiiTokens,
  joinForRedaction, splitRedacted, restorePiiDeep, restorePiiDeepAndWarn, restorePiiAndWarn,
} from '../services/pii-redact';

/** Достаём все console.warn'ы, поданные как один текстовый аргумент — формат formatResidualWarning. */
const warnLines = (spy: jest.SpyInstance): string[] => spy.mock.calls.map((args) => String(args[0]));

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
 * Найдено третьим ревью (Critical): лукэхед из Critical-2 сравнивал слово ПОСЛЕ
 * тройного ФИО только по одной заглавной букве, а не по тому, похож ли этот токен
 * САМ на слово-имя. Акронимы, формы собственности и короткие капитализированные
 * слова ошибочно распознавались как «начало следующего имени», третья группа
 * (фамилия) выбрасывалась целиком и утекала в модель в открытом виде.
 */
describe('ФИО: тройная форма перед акронимом/коротким словом не теряет фамилию (регресс третьего ревью)', () => {
  test('тройное ФИО перед акронимом компании («МТС») не теряет фамилию', () => {
    const r = redactPii('Иван Петрович Сидоров МТС подтвердил контракт');
    expect(r.text).not.toContain('Сидоров');
    expect(r.text).toBe('[УЧАСТНИК_1] МТС подтвердил контракт');
  });

  test('тройное ФИО перед организационно-правовой формой («ООО Ромашка») не теряет фамилию', () => {
    const r = redactPii('Иван Петрович Сидоров ООО Ромашка');
    expect(r.text).not.toContain('Сидоров');
    expect(r.text).toBe('[УЧАСТНИК_1] ООО Ромашка');
  });

  test('тройное ФИО в середине предложения перед акронимом («РЖД») не теряет фамилию', () => {
    const r = redactPii('Договор подписали Мария Ивановна Соколова РЖД и мы');
    expect(r.text).not.toContain('Соколова');
    expect(r.text).toBe('Договор подписали [УЧАСТНИК_1] РЖД и мы');
  });

  test('тройное ФИО перед коротким капитализированным словом («Ян») не теряет фамилию', () => {
    const r = redactPii('Иван Петрович Сидоров Ян уехали');
    expect(r.text).not.toContain('Сидоров');
    expect(r.text).toBe('[УЧАСТНИК_1] Ян уехали');
  });

  test('двухсловное ФИО перед коротким капитализированным словом («Ян Ли») не теряет фамилию', () => {
    const r = redactPii('Клиент Мария Соколова Ян Ли');
    expect(r.text).not.toContain('Соколова');
    expect(r.text).toBe('[УЧАСТНИК_1] Ян Ли');
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

  // Найдено четвёртым ревью: раньше findResidualPiiTokens возвращала сам совпавший
  // текст, теперь — только класс и позицию (см. ResidualPiiToken в pii-redact.ts).
  // Тест переписан под новый контракт: старая форма (`residual` — массив строк)
  // структурно больше не существует.
  test('findResidualPiiTokens находит нераспознанный токен как {kind, index}, без текста совпадения', () => {
    const restored = restorePii('Резюме: [УЧАСТНИК_99] встретился.', map);
    const residual = findResidualPiiTokens(restored);
    expect(residual).toEqual([{ kind: 'УЧАСТНИК', index: 8 }]);
    expect(JSON.stringify(residual)).not.toContain('Иван Петров');
  });

  test('findResidualPiiTokens пуст, когда всё успешно восстановлено', () => {
    const restored = restorePii('[участник_1] подтвердил.', map);
    expect(findResidualPiiTokens(restored)).toEqual([]);
  });

  /**
   * Регресс: без-скобочный вариант ловил только ASCII-`\b`, которая не видит
   * границу пробел/кириллица — «Участник 1» никогда не находился, хотя это
   * ровно тот случай, ради которого без-скобочная ветка была добавлена.
   *
   * Переписано под контракт четвёртого ревью (см. ResidualPiiToken в
   * pii-redact.ts): проверяем класс и позицию, а не совпавший текст.
   */
  test('findResidualPiiTokens находит токен, пересказанный словами без скобок («Участник 1»)', () => {
    expect(findResidualPiiTokens('Участник 1 подтвердил встречу')).toEqual([{ kind: 'УЧАСТНИК', index: 0 }]);
  });

  test('findResidualPiiTokens без скобок нечувствителен к регистру и разделителю', () => {
    expect(findResidualPiiTokens('см. участник_2 и ТЕЛЕФОН 3')).toEqual(
      expect.arrayContaining([
        { kind: 'УЧАСТНИК', index: 4 },
        { kind: 'ТЕЛЕФОН', index: 17 },
      ])
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
 * Найдено третьим ревью (Important): без-скобочная ветка была нацелена ловить
 * искажённые моделью токены («Участник 1», «участник_2», «ТЕЛЕФОН 3»), но
 * ловила и обычные русские фразы «телефон 89161234567» / «участник 2 предложил»,
 * где слово перед числом — не искажённый токен, а бытовое слово. Сканирование
 * идёт ПОСЛЕ restorePii, поэтому такое совпадение утекало в console.warn
 * буквальным восстановленным значением из карты (реальным номером телефона) —
 * то, что док-комментарии функции прямо запрещают.
 */
describe('findResidualPiiTokens: не путает обычную фразу с искажённым токеном (регресс третьего ревью)', () => {
  test('«телефон» строчными + пробел + настоящий номер — не токен', () => {
    expect(findResidualPiiTokens('оставила телефон 89161234567')).toEqual([]);
  });

  test('«Телефон» с заглавной, номер продиктован по группам через пробел — не токен', () => {
    expect(findResidualPiiTokens('Телефон 8 916 123 45 67')).toEqual([]);
  });

  // Четвёртым ревью это ограничение снято намеренно (см. комментарий у
  // findResidualPiiTokens в pii-redact.ts): раньше строчная форма с пробелом
  // была ЕДИНСТВЕННОЙ защитой от утечки настоящего восстановленного значения —
  // теперь эту роль играет сам возврат {kind, index} без текста совпадения,
  // а строчная форма с пробелом («участник 2 предложил», «телефон 3 не
  // отвечает», «email 2 отправлен») снова считается искажённым токеном, как и
  // до третьего ревью. Тест перевёрнут: раньше проверял отсутствие совпадения,
  // теперь — что оно снова находится.
  test('«участник» строчными + пробел + число — снова находится как искажённый токен', () => {
    expect(findResidualPiiTokens('участник 2 предложил перенести')).toEqual([{ kind: 'УЧАСТНИК', index: 0 }]);
  });

  test('restorePiiAndWarn не логирует значение из карты на обычной фразе «телефон + слитный номер»', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { text, map } = redactPii('Мария Соколова оставила телефон 89161234567');
    const restored = restorePiiAndWarn(text, map, 'ctx-test');
    expect(restored).toBe('Мария Соколова оставила телефон 89161234567');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // Убедиться, что настоящие искажённые формы по-прежнему ловятся этой же правкой —
  // переписано под {kind, index} вместо совпавшего текста (четвёртое ревью).
  test('genuine-формы искажения по-прежнему ловятся: «Участник 1», «участник_2», «ТЕЛЕФОН 3»', () => {
    expect(findResidualPiiTokens('Участник 1 подтвердил встречу')).toEqual([{ kind: 'УЧАСТНИК', index: 0 }]);
    expect(findResidualPiiTokens('участник_2 подтвердил')).toEqual([{ kind: 'УЧАСТНИК', index: 0 }]);
    expect(findResidualPiiTokens('см. ТЕЛЕФОН 3')).toEqual([{ kind: 'ТЕЛЕФОН', index: 4 }]);
  });
});

/**
 * Четвёртое ревью (задача 4): findResidualPiiTokens возвращала совпавший текст, и
 * restorePiiAndWarn/restorePiiDeepAndWarn логировали его как есть. На проде это
 * означало, что обычная фраза «Телефон 89161234567» (бытовое слово + РЕАЛЬНЫЙ
 * восстановленный номер) распознавалась как искажённый токен, и настоящий номер
 * телефона клиента уходил в PM2-лог. Ниже — точные репродуксы из отчёта ревью и
 * проверка, что новый структурный результат в принципе не может содержать текст
 * входа, независимо от того, что именно совпало под капотом регулярки.
 */
describe('findResidualPiiTokens/restorePiiAndWarn: структурный результат не может утечь текстом (четвёртое ревью)', () => {
  const phoneRepros = [
    'Мария Соколова: контакт клиента — Телефон 89161234567',
    'Мария Соколова: контакт клиента — ТЕЛЕФОН 89161234567',
    'Контакты. Телефон 79161234567',
    'Телефон 8 916 123 45 67', // диктованная форма
  ];

  test.each(phoneRepros)('репродукс из отчёта: "%s" — результат не содержит обрывка настоящего номера', (input) => {
    const residual = findResidualPiiTokens(input);
    const serialized = JSON.stringify(residual);
    // index — это позиция в тексте (небольшое число), а не значение из номера,
    // поэтому в сериализованном результате в принципе не может быть цифрового
    // прогона длиннее 3 знаков — сам телефон 10-11-значный.
    expect(serialized).not.toMatch(/\d{4,}/);
  });

  test('репродукс из отчёта сквозь весь путь restorePiiAndWarn: реальный номер не появляется в тексте предупреждения', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { text, map } = redactPii('Мария Соколова: контакт клиента — Телефон 89161234567');
    restorePiiAndWarn(text, map, 'meeting #42 auto-summary');
    for (const line of warnLines(warnSpy)) {
      expect(line).not.toContain('89161234567');
      expect(line).not.toMatch(/\d{4,}/);
    }
    warnSpy.mockRestore();
  });

  test('репродукс сквозь restorePiiDeepAndWarn: реальный номер не появляется в тексте предупреждения', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { text, map } = redactPii('Мария Соколова: контакт клиента — Телефон 89161234567');
    restorePiiDeepAndWarn({ summary: text }, map, 'meeting #42 deep');
    for (const line of warnLines(warnSpy)) {
      expect(line).not.toContain('89161234567');
      expect(line).not.toMatch(/\d{4,}/);
    }
    warnSpy.mockRestore();
  });

  test('структурная гарантия: результат не содержит ни одной цифры реального телефона и ни одного символа локальной части email', () => {
    const { text, map } = redactPii('Мария Соколова, +7 916 123-45-67, ivan.petrov@example.com рассказала про телефон 89161234567 и email 2 не пришёл');
    const restored = restorePii(text, map);
    const residual = findResidualPiiTokens(restored);
    const serialized = JSON.stringify(residual);
    expect(serialized).not.toContain('916');
    expect(serialized).not.toContain('89161234567');
    expect(serialized).not.toContain('ivan.petrov');
    // Единственные допустимые поля — kind (константа из TOKEN_KINDS) и index (число).
    for (const item of residual) {
      expect(['ТЕЛЕФОН', 'EMAIL', 'УЧАСТНИК']).toContain(item.kind);
      expect(typeof item.index).toBe('number');
      expect(Object.keys(item).sort()).toEqual(['index', 'kind']);
    }
  });

  // Восстановленная чувствительность (список из отчёта ревью): строчная форма с
  // пробелом для всех трёх классов — раньше требовала подчёркивания или вовсе не
  // ловилась, теперь ловится, потому что найденное больше не может утечь текстом.
  describe('восстановленная чувствительность: строчная форма с пробелом', () => {
    test('«участник 1 подтвердил встречу»', () => {
      expect(findResidualPiiTokens('участник 1 подтвердил встречу')).toEqual([{ kind: 'УЧАСТНИК', index: 0 }]);
    });

    test('«телефон 3 не отвечает»', () => {
      expect(findResidualPiiTokens('телефон 3 не отвечает')).toEqual([{ kind: 'ТЕЛЕФОН', index: 0 }]);
    });

    test('«email 2 отправлен»', () => {
      expect(findResidualPiiTokens('email 2 отправлен')).toEqual([{ kind: 'EMAIL', index: 0 }]);
    });
  });

  // Восстановленная чувствительность: цифро-продолжение (номер пункта списка или
  // второе число подряд) больше не подавляет совпадение.
  describe('восстановленная чувствительность: токены внутри нумерованных списков', () => {
    test('оба пункта нумерованного списка находятся, а не только второй', () => {
      const residual = findResidualPiiTokens('1. Участник 1\n2. Участник 2 согласился');
      expect(residual).toHaveLength(2);
      expect(residual.map((r) => r.kind)).toEqual(['УЧАСТНИК', 'УЧАСТНИК']);
    });

    test('«Участник 1 2 вопроса» — находится, а не подавляется соседней цифрой', () => {
      expect(findResidualPiiTokens('Участник 1 2 вопроса')).toEqual([{ kind: 'УЧАСТНИК', index: 0 }]);
    });
  });

  // Genuine-искажения из брифа — все должны находиться (dup-check по классам).
  describe('genuine мангл-формы по-прежнему находятся', () => {
    test.each([
      ['Участник 1', 'УЧАСТНИК'],
      ['Участник_1', 'УЧАСТНИК'],
      ['УЧАСТНИК 1', 'УЧАСТНИК'],
      ['участник_3', 'УЧАСТНИК'],
      ['[УЧАСТНИК_1]', 'УЧАСТНИК'],
    ])('"%s" находится как %s', (input, kind) => {
      const residual = findResidualPiiTokens(input);
      expect(residual).toHaveLength(1);
      expect(residual[0]!.kind).toBe(kind);
    });
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

  // Переписано под контракт четвёртого ревью: console.warn теперь получает ОДНУ
  // строку с классом и позицией остатка (formatResidualWarning), а не (сообщение,
  // массив-с-текстом-совпадения) — именно двухаргументный вызов с текстом и был
  // источником утечки, который чинит эта задача.
  test('restorePiiDeepAndWarn логирует остаточный токен, пересказанный словами, и не бросает исключение', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mangled = { summary: 'Обсудили с Участник 1 планы' };
    const restored = restorePiiDeepAndWarn(mangled, map, 'test-context');
    expect(restored.summary).toBe('Обсудили с Участник 1 планы'); // не восстановлено — не найдено в карте
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [line] = warnLines(warnSpy);
    expect(line).toContain('test-context');
    expect(line).toContain('УЧАСТНИК@');
    expect(line).not.toContain('Участник 1'); // сам совпавший текст в лог не попадает
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
