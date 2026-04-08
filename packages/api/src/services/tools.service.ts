/** External tools for AI assistant — weather, web search, etc. */

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

/** Tool definitions for OpenAI function calling */
export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Получить текущую погоду в городе. Используй когда пользователь спрашивает про погоду.',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'Название города, например "Москва" или "Saint Petersburg"' },
        },
        required: ['city'],
      },
    },
  },
];

/** Execute a tool call and return result */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_weather':
      return await getWeather(args['city'] as string);
    default:
      return `Неизвестный инструмент: ${name}`;
  }
}
