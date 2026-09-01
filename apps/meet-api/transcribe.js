/**
 * Расшифровка записей встречи и сборка их в диалог.
 *
 * Каждый участник пишется отдельной дорожкой, поэтому «кто сказал» известно
 * из самого файла — диаризация не нужна. Задача этого модуля: распознать
 * каждую дорожку, а потом разложить все реплики по общей временной шкале.
 *
 * Времена приходят от сервиса расшифровки в исходной шкале дорожки (VAD
 * вырезает молчание при распознавании, но таймкоды не сдвигает), поэтому
 * реплики разных участников сопоставимы напрямую.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const os = require('node:os');
const комнаты = require('./rooms');

const КАТАЛОГ = process.env.MEET_RECORDINGS_DIR || '/opt/clarity-meet/recordings';
const СЕРВИС = process.env.TRANSCRIBE_SERVICE_URL || 'http://127.0.0.1:8091';
const ЯЗЫК = process.env.MEET_TRANSCRIBE_LANG || 'ru';

/**
 * Длинные дорожки режутся на куски по пять минут.
 *
 * Причина ровно та же, что уже описана в Clarity Space
 * (`packages/api/src/services/whisper-local.service.ts`): глобальный fetch
 * построен на undici, у которого свой `headersTimeout` в 300 секунд, снаружи
 * не настраиваемый без пакета `undici`. Сервис расшифровки держит
 * MAX_CONCURRENCY=2 и делится с Clarity Space, поэтому дорожка может ждать
 * очереди дольше пяти минут — и запрос умирает с безликим «fetch failed»,
 * унося с собой всю расшифровку. Здесь используется node:http, где временем
 * управляем мы.
 */
const КУСОК_СЕКУНД = 300;
const ПОРОГ_НАРЕЗКИ_СЕКУНД = 480;
const ТАЙМАУТ_КУСКА_МС = 20 * 60 * 1000;

/**
 * В имени файла записи — только идентификатор участника, безопасный для
 * файловой системы. Живое имя лежит в хранилище комнат: кодировать его в имя
 * файла нельзя, там вычищается всё, кроме латиницы, и «Иван Петров»
 * превращается в подчёркивания, а два русских имени — в одного «Участника».
 */
function имяУчастника(файл, комнатаId) {
  const без = path.basename(файл, path.extname(файл));
  const identity = без.startsWith(`${комнатаId}-`) ? без.slice(комнатаId.length + 1) : без;
  const изРеестра = комнаты.участник(комнатаId, identity);
  if (изРеестра) return изРеестра;

  // Записи, сделанные до появления реестра: имя было закодировано в файл.
  const запасной = identity.replace(/-[0-9a-f]{8}$/i, '').replace(/_/g, ' ').trim();
  return запасной || 'Участник';
}

/** Файлы записи этой комнаты, по одному на участника. */
function дорожкиКомнаты(комнатаId) {
  let файлы;
  try {
    файлы = fs.readdirSync(КАТАЛОГ);
  } catch {
    return [];
  }
  return файлы
    .filter((ф) => ф.startsWith(`${комнатаId}-`) && /\.(ogg|opus|mp4|m4a|webm|wav)$/i.test(ф))
    .map((ф) => ({ путь: path.join(КАТАЛОГ, ф), участник: имяУчастника(ф, комнатаId) }))
    .sort((a, b) => a.участник.localeCompare(b.участник, 'ru'));
}

/** POST multipart через node:http — со своим таймаутом, без скрытого предела undici. */
function отправитьФайл(буфер, имяФайла, таймаутМс) {
  return new Promise((resolve, reject) => {
    const адрес = new URL(`${СЕРВИС}/transcribe`);
    const граница = '----meet' + crypto.randomBytes(16).toString('hex');

    const голова = [
      Buffer.from(`--${граница}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${ЯЗЫК}\r\n`),
      Buffer.from(
        `--${граница}\r\nContent-Disposition: form-data; name="file"; filename="${имяФайла}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
      ),
    ];
    const тело = Buffer.concat([...голова, буфер, Buffer.from(`\r\n--${граница}--\r\n`)]);

    const запрос = http.request({
      hostname: адрес.hostname,
      port: адрес.port || 80,
      path: адрес.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${граница}`,
        'Content-Length': тело.length,
      },
    }, (ответ) => {
      const куски = [];
      ответ.on('data', (к) => куски.push(к));
      ответ.on('end', () => {
        const текст = Buffer.concat(куски).toString('utf-8');
        if ((ответ.statusCode ?? 0) < 200 || (ответ.statusCode ?? 0) >= 300) {
          reject(new Error(`сервис расшифровки: HTTP ${ответ.statusCode} ${текст.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(текст)); } catch (e) { reject(e); }
      });
    });

    запрос.setTimeout(таймаутМс, () => {
      запрос.destroy(new Error(`сервис расшифровки не ответил за ${Math.round(таймаутМс / 1000)} с`));
    });
    запрос.on('error', reject);
    запрос.end(тело);
  });
}

function выполнить(команда, аргументы, таймаутМс = 300000) {
  return new Promise((resolve, reject) => {
    const п = spawn(команда, аргументы);
    const таймер = setTimeout(() => п.kill('SIGKILL'), таймаутМс);
    let ошибки = '';
    п.stderr?.on('data', (д) => { ошибки += д.toString(); });
    п.on('error', (e) => { clearTimeout(таймер); reject(e); });
    п.on('close', (код) => {
      clearTimeout(таймер);
      код === 0 ? resolve() : reject(new Error(`${команда} завершился с кодом ${код}: ${ошибки.slice(0, 200)}`));
    });
  });
}

function длительность(путь) {
  return new Promise((resolve) => {
    const п = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', путь]);
    let вывод = '';
    п.stdout?.on('data', (д) => { вывод += д.toString(); });
    п.on('error', () => resolve(0));
    п.on('close', () => resolve(parseFloat(вывод.trim()) || 0));
  });
}

/**
 * Расшифровать дорожку. Короткую — одним запросом, длинную — кусками по пять
 * минут, со сдвигом таймкодов каждого куска на его позицию в оригинале, чтобы
 * общая шкала осталась верной.
 */
async function расшифроватьДорожку(путь) {
  const секунд = await длительность(путь);

  if (секунд <= ПОРОГ_НАРЕЗКИ_СЕКУНД) {
    return отправитьФайл(fs.readFileSync(путь), path.basename(путь), ТАЙМАУТ_КУСКА_МС);
  }

  const рабочий = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-tr-'));
  try {
    await выполнить('ffmpeg', [
      '-v', 'error', '-i', путь, '-f', 'segment',
      '-segment_time', String(КУСОК_СЕКУНД), '-c', 'copy',
      path.join(рабочий, 'часть-%03d' + path.extname(путь)), '-y',
    ]);

    const куски = fs.readdirSync(рабочий).sort();
    const сегменты = [];
    let текст = [];
    let речь = 0;

    for (let i = 0; i < куски.length; i++) {
      const сдвиг = i * КУСОК_СЕКУНД;
      const кусок = path.join(рабочий, куски[i]);
      const результат = await отправитьФайл(fs.readFileSync(кусок), куски[i], ТАЙМАУТ_КУСКА_МС);
      for (const с of результат.segments ?? []) {
        сегменты.push({ start: с.start + сдвиг, end: с.end + сдвиг, text: с.text });
      }
      if (результат.text) текст.push(результат.text);
      речь += Number(результат.speech_duration ?? 0);
    }

    return {
      text: текст.join(' ').trim(),
      segments: сегменты,
      duration: секунд,
      speech_duration: речь,
      no_speech: сегменты.length === 0,
    };
  } finally {
    try { fs.rmSync(рабочий, { recursive: true, force: true }); } catch {}
  }
}

/** Секунды в формат «мм:сс» для читаемой стенограммы. */
function времяСтрокой(секунды) {
  const с = Math.max(0, Math.floor(секунды));
  return `${String(Math.floor(с / 60)).padStart(2, '0')}:${String(с % 60).padStart(2, '0')}`;
}

/**
 * Расшифровать все дорожки комнаты и собрать диалог.
 *
 * Отдельно различаются два исхода: «речи не нашлось» и «расшифровать не
 * удалось». Первое — нормальный результат (микрофон был выключен), второе —
 * отказ, о котором вызывающий обязан узнать, а не получить пустую стенограмму
 * с кодом 200.
 */
async function расшифроватьВстречу(комнатаId) {
  const дорожки = дорожкиКомнаты(комнатаId);
  if (дорожки.length === 0) {
    return { участники: [], реплики: [], стенограмма: '', безРечи: true, всёУпало: false, причина: 'записей не найдено' };
  }

  const участники = [];
  const реплики = [];
  let упало = 0;

  for (const { путь, участник } of дорожки) {
    let результат;
    try {
      результат = await расшифроватьДорожку(путь);
    } catch (ошибка) {
      упало += 1;
      участники.push({ имя: участник, ошибка: String(ошибка.message ?? ошибка), реплик: 0, речиСекунд: 0 });
      continue;
    }

    const сегменты = Array.isArray(результат.segments) ? результат.segments : [];
    for (const с of сегменты) {
      реплики.push({ начало: с.start, конец: с.end, участник, текст: с.text });
    }

    участники.push({
      имя: участник,
      реплик: сегменты.length,
      речиСекунд: Number(результат.speech_duration ?? 0),
      длительностьСекунд: Number(результат.duration ?? 0),
      безРечи: Boolean(результат.no_speech),
    });
  }

  // Общая шкала: реплики всех участников по времени начала. Перебивки при
  // этом не путаются — дорожки независимы, и наложение речи сохраняется как
  // две соседние реплики, а не как испорченная строка.
  реплики.sort((a, b) => a.начало - b.начало);

  const стенограмма = реплики
    .map((р) => `[${времяСтрокой(р.начало)}] ${р.участник}: ${р.текст}`)
    .join('\n');

  const всёУпало = упало === дорожки.length;

  return {
    участники,
    реплики,
    стенограмма,
    безРечи: реплики.length === 0,
    всёУпало,
    причина: всёУпало
      ? 'ни одну дорожку не удалось расшифровать'
      : реплики.length === 0 ? 'ни на одной дорожке не найдено речи' : undefined,
  };
}

module.exports = { расшифроватьВстречу, дорожкиКомнаты, времяСтрокой, имяУчастника };
