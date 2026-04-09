/** External tools for AI assistant — weather, vault search, file ops */

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { getDb } from '../db/db';

interface GeocodingResult {
  results?: Array<{ latitude: number; longitude: number; name: string; country: string }>;
}

interface WeatherResult {
  current?: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
    relative_humidity_2m: number;
  };
}

const WEATHER_CODES: Record<number, string> = {
  0: 'ясно', 1: 'в основном ясно', 2: 'переменная облачность', 3: 'пасмурно',
  45: 'туман', 48: 'изморозь',
  51: 'лёгкая морось', 53: 'морось', 55: 'сильная морось',
  61: 'небольшой дождь', 63: 'дождь', 65: 'сильный дождь',
  66: 'ледяной дождь', 67: 'сильный ледяной дождь',
  71: 'небольшой снег', 73: 'снег', 75: 'сильный снег',
  77: 'снежные зёрна',
  80: 'небольшой ливень', 81: 'ливень', 82: 'сильный ливень',
  85: 'снегопад', 86: 'сильный снегопад',
  95: 'гроза', 96: 'гроза с градом', 99: 'сильная гроза с градом',
};

/** Get current weather for a city via free Open-Meteo API (no key needed) */
export async function getWeather(city: string): Promise<string> {
  try {
    // 1. Geocode
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`;
    const geoRes = await fetch(geoUrl);
    const geo = await geoRes.json() as GeocodingResult;
    if (!geo.results || geo.results.length === 0) return `Город "${city}" не найден`;
    const loc = geo.results[0]!;

    // 2. Weather
    const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&timezone=auto`;
    const wRes = await fetch(wUrl);
    const w = await wRes.json() as WeatherResult;
    if (!w.current) return `Не удалось получить погоду для ${loc.name}`;

    const c = w.current;
    const desc = WEATHER_CODES[c.weather_code] ?? 'неизвестно';
    return `${loc.name}, ${loc.country}: ${desc}, ${Math.round(c.temperature_2m)}°C (ощущается ${Math.round(c.apparent_temperature)}°C), ветер ${Math.round(c.wind_speed_10m)} км/ч, влажность ${c.relative_humidity_2m}%`;
  } catch (err) {
    return `Ошибка получения погоды: ${err instanceof Error ? err.message : 'unknown'}`;
  }
}

/** Search vault via FTS5 search index */
export function searchVault(query: string, limit = 10): string {
  try {
    const { searchService } = require('./search.service');
    const results = searchService.search(query, limit) as Array<{ type: string; ref_id: number; title: string; snippet: string }>;
    if (results.length === 0) return 'Ничего не найдено';
    return results.map(r => `[${r.type}#${r.ref_id}] ${r.title}\n${r.snippet.replace(/<\/?mark>/g, '')}`).join('\n\n') +
      '\n\nЧтобы получить полное содержимое, используй get_entity_details с type и id (например, type=meeting id=5) или read_vault_file.';
  } catch (err) {
    return `Ошибка поиска: ${err instanceof Error ? err.message : 'unknown'}`;
  }
}

/** Search meetings by topic and return full content */
export function searchMeetingsFull(query: string, limit = 3): string {
  try {
    const db = getDb();
    const results = db.prepare(`
      SELECT id, title, date, summary_raw FROM meetings
      WHERE title LIKE ? OR summary_raw LIKE ?
      ORDER BY date DESC LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit) as Array<{ id: number; title: string; date: string; summary_raw: string }>;

    const maxChars = 15000; // per meeting, sufficient for full transcript
    if (results.length === 0) {
      const recent = db.prepare('SELECT id, title, date, summary_raw FROM meetings ORDER BY date DESC LIMIT ?').all(limit) as Array<{ id: number; title: string; date: string; summary_raw: string }>;
      if (recent.length === 0) return 'Встреч не найдено';
      return 'По запросу ничего не найдено. Недавние встречи:\n\n' + recent.map(m =>
        `## ${m.title} (${m.date}, id=${m.id})\n${(m.summary_raw || '').slice(0, maxChars)}`
      ).join('\n\n---\n\n');
    }

    return results.map(m =>
      `## ${m.title} (${m.date}, id=${m.id})\n${(m.summary_raw || '').slice(0, maxChars)}`
    ).join('\n\n---\n\n');
  } catch (err) {
    return `Ошибка: ${err instanceof Error ? err.message : 'unknown'}`;
  }
}

/** Read a specific vault file by relative path */
export function readVaultFile(relativePath: string): string {
  try {
    const fullPath = path.join(config.vaultPath, relativePath);
    if (!fullPath.startsWith(config.vaultPath)) return 'Ошибка: недопустимый путь';
    if (!fs.existsSync(fullPath)) return `Файл не найден: ${relativePath}`;
    const content = fs.readFileSync(fullPath, 'utf-8');
    return content.slice(0, 10000);
  } catch (err) {
    return `Ошибка чтения: ${err instanceof Error ? err.message : 'unknown'}`;
  }
}

/** List files in a vault folder */
export function listVaultFolder(folder: string): string {
  try {
    const dir = path.join(config.vaultPath, folder);
    if (!fs.existsSync(dir)) return `Папка не найдена: ${folder}`;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    return files.length > 0 ? files.join('\n') : 'Папка пуста';
  } catch (err) {
    return `Ошибка: ${err instanceof Error ? err.message : 'unknown'}`;
  }
}

/** Get detailed info about a specific task, meeting, project, or person */
export function getEntityDetails(entityType: string, entityId: number): string {
  try {
    const db = getDb();
    let result;
    switch (entityType) {
      case 'task': {
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(entityId);
        if (!task) return 'Задача не найдена';
        const people = db.prepare('SELECT p.name FROM people p JOIN task_people tp ON p.id = tp.person_id WHERE tp.task_id = ?').all(entityId);
        result = { ...task as object, people };
        break;
      }
      case 'meeting': {
        const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(entityId);
        if (!meeting) return 'Встреча не найдена';
        const people = db.prepare('SELECT p.name FROM people p JOIN meeting_people mp ON p.id = mp.person_id WHERE mp.meeting_id = ?').all(entityId);
        result = { ...meeting as object, people };
        break;
      }
      case 'project': {
        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(entityId);
        if (!project) return 'Проект не найден';
        const tasks = db.prepare('SELECT id, title, status FROM tasks WHERE project_id = ? AND archived = 0').all(entityId);
        const meetings = db.prepare('SELECT id, title, date FROM meetings WHERE project_id = ? ORDER BY date DESC LIMIT 5').all(entityId);
        result = { ...project as object, tasks, meetings };
        break;
      }
      case 'person': {
        const person = db.prepare('SELECT * FROM people WHERE id = ?').get(entityId);
        if (!person) return 'Человек не найден';
        const tasks = db.prepare('SELECT t.id, t.title FROM tasks t JOIN task_people tp ON t.id = tp.task_id WHERE tp.person_id = ?').all(entityId);
        const meetings = db.prepare('SELECT m.id, m.title, m.date FROM meetings m JOIN meeting_people mp ON m.id = mp.meeting_id WHERE mp.person_id = ?').all(entityId);
        result = { ...person as object, tasks, meetings };
        break;
      }
      default:
        return `Неизвестный тип: ${entityType}`;
    }
    return JSON.stringify(result, null, 2);
  } catch (err) {
    return `Ошибка: ${err instanceof Error ? err.message : 'unknown'}`;
  }
}

/** Tool definitions for OpenAI function calling */
export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Получить текущую погоду в городе.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'Название города, например "Москва"' },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_vault',
      description: 'Полнотекстовый поиск по всему содержимому Obsidian vault (задачи, встречи, идеи, документы, заметки). Возвращает сниппеты. Для полного содержимого используй get_entity_details или search_meetings_full.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Поисковый запрос, например "встреча с Иваном", "проект онбординг"' },
          limit: { type: 'number', description: 'Макс количество результатов (по умолчанию 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_meetings_full',
      description: 'Найти встречи по теме/ключевым словам и получить ПОЛНЫЙ текст их транскрипций. Используй когда пользователь спрашивает что обсуждали на встрече, содержание встречи, детали разговора.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Тема или ключевые слова, например "роботы", "онбординг", "стартап"' },
          limit: { type: 'number', description: 'Макс встреч (по умолчанию 3)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_vault_file',
      description: 'Прочитать полное содержимое файла из vault. Используй после поиска, чтобы изучить конкретную заметку.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Относительный путь файла в vault, например "Meetings/2026-04-07-встреча.md"' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_vault_folder',
      description: 'Показать файлы в папке vault. Используй чтобы увидеть все встречи, идеи, задачи и т.д.',
      parameters: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: 'Имя папки: Meetings, Ideas, Tasks, People, Projects, Goals, Materials' },
        },
        required: ['folder'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_entity_details',
      description: 'Получить детали конкретного объекта из БД (задача, встреча, проект, человек) со всеми связями.',
      parameters: {
        type: 'object',
        properties: {
          entity_type: { type: 'string', enum: ['task', 'meeting', 'project', 'person'] },
          entity_id: { type: 'number' },
        },
        required: ['entity_type', 'entity_id'],
      },
    },
  },
];

/** Execute a tool call and return result */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_weather':
      return await getWeather(args['city'] as string);
    case 'search_vault':
      return searchVault(args['query'] as string, (args['limit'] as number) ?? 10);
    case 'search_meetings_full':
      return searchMeetingsFull(args['query'] as string, (args['limit'] as number) ?? 3);
    case 'read_vault_file':
      return readVaultFile(args['path'] as string);
    case 'list_vault_folder':
      return listVaultFolder(args['folder'] as string);
    case 'get_entity_details':
      return getEntityDetails(args['entity_type'] as string, args['entity_id'] as number);
    default:
      return `Неизвестный инструмент: ${name}`;
  }
}
