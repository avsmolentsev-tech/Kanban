/**
 * Отправка результатов встречи в Clarity Space.
 *
 * Связь односторонняя: Meet пишет в Clarity Space по её публичному API и
 * ничего от неё не ждёт взамен. Обратной зависимости нет, поэтому отказ Meet
 * никак не влияет на Clarity Space, а отказ Clarity Space не ломает звонки.
 *
 * Токен — обычный API-токен Clarity Space вида cs_..., выпущенный в кабинете
 * и отзываемый там же. Никаких особых прав интеграции не требуется.
 */
const БАЗА = process.env.CLARITY_API_URL || 'https://clarity-space.ru';
const ТОКЕН = process.env.CLARITY_API_TOKEN || '';

function настроено() {
  return Boolean(ТОКЕН);
}

/**
 * Создать карточку встречи с готовой стенограммой.
 *
 * Задачи и договорённости Clarity Space извлечёт сама: при создании встречи
 * с содержательным телом она запускает разбор и заводит задачи с указанием
 * ответственного и цитаты. Отдельно их отправлять не нужно.
 */
async function отправитьВстречу({ название, дата, стенограмма, участники }) {
  if (!настроено()) {
    throw new Error('CLARITY_API_TOKEN не задан — интеграция выключена');
  }

  // Список участников в начале тела: он попадает в разбор и помогает модели
  // правильно назначить ответственных по репликам.
  const шапка = участники?.length
    ? `Участники: ${участники.join(', ')}\n\n`
    : '';

  const ответ = await fetch(`${БАЗА}/v1/meetings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ТОКЕН}`,
    },
    body: JSON.stringify({
      title: название,
      date: дата,
      summary_raw: шапка + стенограмма,
    }),
  });

  const текст = await ответ.text();
  if (!ответ.ok) {
    throw new Error(`Clarity Space: HTTP ${ответ.status} ${текст.slice(0, 200)}`);
  }

  const тело = JSON.parse(текст);
  const встреча = тело?.data ?? тело;
  return { id: встреча?.id, url: `${БАЗА}/meetings` };
}

module.exports = { отправитьВстречу, настроено };
