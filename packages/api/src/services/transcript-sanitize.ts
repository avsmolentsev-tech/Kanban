/**
 * Чистка расшифровок от галлюцинаций Whisper.
 *
 * Whisper (и API, и whisper.cpp) на нераспознаваемом участке скатывается в петлю:
 * начинает бесконечно повторять «Музыка», «Продолжение следует...» или последнюю
 * реальную фразу — и делает это до конца файла. В whisper.cpp петля самоподдерживается
 * через контекст предыдущего окна, поэтому одного `--max-context 0` мало: мусор,
 * который уже успел накопиться, надо вычистить постобработкой.
 */

/** Известные заглушки Whisper: субтитровые артефакты и метки не-речи. */
const ARTIFACT_PATTERNS: RegExp[] = [
  /^музыка$/,
  /^муз[иы]ка играет$/,
  /^играет музыка$/,
  /^аплодисменты$/,
  // «Смех.» отдельной репликой в протоколе встречи смысла не несёт, поэтому убираем.
  // А вот «Тишина.» — вполне возможная живая реплика, её оставляем.
  /^смех$/,
  /^продолжение следует$/,
  /^спасибо за просмотр$/,
  // Хвост обязателен: иначе «Корректор нужен на следующей неделе» или
  // «Субтитры мы закажем позже» молча пропадут из протокола встречи.
  // Границу слова пишем как (\s.*)?$, а не \b: в JS \b работает по ASCII
  // и после кириллической буквы не срабатывает вообще.
  /^субтитры (сделал|создавал|подготовил|редактировал|by)(\s.*)?$/,
  /^редактор субтитров(\s.*)?$/,
  /^корректор (субтитров|текста)(\s.*)?$/,
  /^music$/,
  /^applause$/,
  /^laughter$/,
  /^silence$/,
  /^thanks for watching$/,
  /^subtitles by.*$/,
  /^amara org community$/,
];

/** Длиннее этого артефактом не считаем — иначе выбросим живую речь про субтитры. */
const MAX_ARTIFACT_CHARS = 60;

/** Столько одинаковых фраз подряд — это уже петля, оставляем одну. */
const RUN_COLLAPSE_AT = 3;

/** Такая длина серии (или столько артефактов) — считаем расшифровку сломанной. */
const LOOP_RUN_AT = 5;
const LOOP_ARTIFACTS_AT = 3;

/** Ниже этой плотности речь за минуту не бывает — значит, распознавание провалилось. */
const MIN_CHARS_PER_MINUTE = 250;

export interface SanitizeResult {
  text: string;
  /** Сколько фрагментов выброшено (артефакты + схлопнутые повторы). */
  removedUnits: number;
  /** Расшифровка выродилась в петлю — результату верить нельзя. */
  loopDetected: boolean;
}

export interface QualityResult {
  chars: number;
  durationSec: number | null;
  charsPerMinute: number | null;
  suspicious: boolean;
}

/**
 * Режет текст на фрагменты по границам предложений и строк.
 * Хвостовые пробелы и перевод строки остаются внутри фрагмента, поэтому
 * units.join('') === исходный текст.
 */
function splitUnits(text: string): string[] {
  const units: string[] = [];
  const SENTENCE_END = '.!?…';
  let buf = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    buf += ch;

    if (SENTENCE_END.includes(ch)) {
      while (i + 1 < text.length && SENTENCE_END.includes(text[i + 1]!)) buf += text[++i]!;
      while (i + 1 < text.length && (text[i + 1] === ' ' || text[i + 1] === '\t')) buf += text[++i]!;
      if (i + 1 < text.length && text[i + 1] === '\n') buf += text[++i]!;
      units.push(buf);
      buf = '';
    } else if (ch === '\n') {
      units.push(buf);
      buf = '';
    }
  }
  if (buf) units.push(buf);
  return units;
}

/** Приводит фрагмент к виду, по которому сравниваем повторы и ищем артефакты. */
function normalizeUnit(unit: string): string {
  return unit
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[[\](){}<>«»"'`]/g, ' ')
    .replace(/[.,!?…:;—–\-*_#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isArtifact(normalized: string): boolean {
  if (!normalized || normalized.length > MAX_ARTIFACT_CHARS) return false;
  return ARTIFACT_PATTERNS.some((re) => re.test(normalized));
}

export function sanitizeTranscript(raw: string): SanitizeResult {
  if (!raw.trim()) return { text: '', removedUnits: 0, loopDetected: false };

  const units = splitUnits(raw);
  const normalized = units.map(normalizeUnit);
  const dropped = new Array<boolean>(units.length).fill(false);

  // 1. Выбрасываем известные заглушки.
  let artifactCount = 0;
  for (let i = 0; i < units.length; i++) {
    if (isArtifact(normalized[i]!)) {
      dropped[i] = true;
      artifactCount++;
    }
  }

  // 2. Схлопываем серии одинаковых фраз. Пустые фрагменты (чистые пробелы)
  //    серию не разрывают и не удаляются.
  const meaningful: number[] = [];
  for (let i = 0; i < units.length; i++) {
    if (!dropped[i] && normalized[i]) meaningful.push(i);
  }

  let collapsed = 0;
  let maxRun = 0;
  let runStart = 0;
  while (runStart < meaningful.length) {
    let runEnd = runStart + 1;
    while (
      runEnd < meaningful.length &&
      normalized[meaningful[runEnd]!] === normalized[meaningful[runStart]!]
    ) {
      runEnd++;
    }
    const runLength = runEnd - runStart;
    maxRun = Math.max(maxRun, runLength);
    if (runLength >= RUN_COLLAPSE_AT) {
      // оставляем первое вхождение — оно могло быть настоящей репликой
      for (let k = runStart + 1; k < runEnd; k++) {
        dropped[meaningful[k]!] = true;
        collapsed++;
      }
    }
    runStart = runEnd;
  }

  const text = units.filter((_, i) => !dropped[i]).join('').trim();

  return {
    text,
    removedUnits: artifactCount + collapsed,
    loopDetected: maxRun >= LOOP_RUN_AT || artifactCount >= LOOP_ARTIFACTS_AT,
  };
}

/**
 * Плотность речи: если на минуту аудио пришлось подозрительно мало символов,
 * распознавание провалилось, даже когда петли в тексте уже нет.
 */
export function transcriptQuality(text: string, durationSec: number | null): QualityResult {
  const chars = text.trim().length;
  if (!durationSec || durationSec < 60) {
    return { chars, durationSec, charsPerMinute: null, suspicious: false };
  }
  const charsPerMinute = Math.round(chars / (durationSec / 60));
  return { chars, durationSec, charsPerMinute, suspicious: charsPerMinute < MIN_CHARS_PER_MINUTE };
}
