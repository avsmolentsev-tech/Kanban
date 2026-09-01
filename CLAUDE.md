# Clarity Space (Personal Intelligence System)

## Что это

Персональная система управления жизнью и проектами. Obsidian vault — единственный источник правды, PostgreSQL — рабочая база и индекс (схема накатывается на старте автоматически). Задачи, проекты, привычки, цели, дневник, встречи, документы, AI-чат.

## Стек

- **Монорепо:** pnpm workspace
- **Frontend:** React 18 + Vite + Tailwind + Framer Motion + Tiptap (rich text)
- **Backend:** Express + PostgreSQL (`pg`) + TypeScript
- **AI:** OpenAI-совместимый LLM через SDK `openai`, модель по умолчанию `gpt-4.1-mini` + локальный Whisper / сервис транскрипции
- **Бот:** Telegram @MyBestKanban_bot (ops bot в `apps/claude-ops-bot`)
- **Деплой:** clarity-space.ru / 31.128.43.174, PM2, nginx

> **AI-провайдер — важно для демо.** Класс называется `ClaudeService`, но Anthropic SDK в коде не используется ни разу — только `new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiBaseUrl })`. `ANTHROPIC_API_KEY` читается в конфиге, но ни один клиент от него не зависит (см. `services/claude.service.ts`, `isAiClientConfigured()`). Смена провайдера (например, на Yandex Cloud) — одна переменная `OPENAI_BASE_URL`, без правок кода. Не называть это заказчику «Claude API» — при вскрытии кода это будет выглядеть как обман.
>
> **База данных — тоже важно.** Раньше был SQLite (`better-sqlite3`, файл `db.sqlite.ts`), сейчас `packages/api/src/index.ts` стартует исключительно через `initPg(config.databaseUrl)` (PostgreSQL). `db.sqlite.ts` и его `initDb()`/`initTestDb()` не вызываются НИГДЕ в рабочем коде — ни в проде, ни в текущих тестах (все обращения к нему в `__tests__/*.test.ts` закомментированы, актуальны только для миграционного скрипта `scripts/migrate-sqlite-to-pg.ts`, которым когда-то перенесли данные в Postgres). Переменная `DATABASE_PATH` при этом не мёртвая: её каталог (`path.dirname`) используется сервисом `pending-jobs.ts` как место на диске для аудио незавершённых расшифровок — сама БД по этому пути не создаётся.

## Структура

```
apps/web/              — React SPA (порт 5173 dev)
apps/claude-ops-bot/   — Telegram ops bot
packages/api/          — Express API (порт 3001 dev, compiled JS in dist/)
packages/shared/       — Общие TypeScript типы
vault/                 — Obsidian vault (source of truth)
data/                  — рабочие файлы на диске (на проде: data/pending-jobs — аудио незавершённых расшифровок). Сама БД — PostgreSQL, не файл в этой директории
```

## Команды

```bash
pnpm dev           # Запуск API + фронтенд
pnpm install       # Установка зависимостей
```

### Сборка и деплой

**`/var/www/kanban-app/` на сервере — НЕ git-репозиторий** (проверено: `.git` там нет). `git pull` на сервере не сработает — код нужно доставить на сервер файловой синхронизацией (rsync/scp), а не git-командой.

```bash
# API (TypeScript → JS)
cd packages/api && npx tsc

# Frontend
cd apps/web && npx vite build

# Доставить код на сервер (rsync, не git pull — там не git-репозиторий)
rsync -az --exclude node_modules packages/api/src packages/api/package.json \
  root@31.128.43.174:/var/www/kanban-app/packages/api/

# dist/ ОБЯЗАТЕЛЬНО пересобрать на сервере перед рестартом — устаревший dist/
# уже один раз унёс на прод код, которого в src/ больше нет; pm2 restart
# без пересборки этот риск не убирает.
ssh root@31.128.43.174 "cd /var/www/kanban-app/packages/api && npx tsc && \
  pm2 delete kanban-api && pm2 start dist/index.js --name kanban-api && pm2 save"
```

## Серверные пути

- Приложение: `/var/www/kanban-app/` (не git-репозиторий — деплой файловой синхронизацией, не `git pull`)
- API запускается из: `/var/www/kanban-app/packages/api/dist/index.js`
- PM2 процесс: `kanban-api`
- Vault на сервере: `/var/www/kanban-app/vault/`
- PostgreSQL: строка подключения в `DATABASE_URL` (см. `/var/www/kanban-app/packages/api/.env`), не файл в `data/`

## API Routes (27 групп маршрутов под `/v1`, плюс `/health` и `/mcp` вне `/v1`)

Полный список регистрируется в `packages/api/src/routes/index.ts`; ниже — актуальный срез по группам, сверенный построчно с каждым `router.use`.

### Аутентификация
- `/v1/auth` — login, register, profile, verify-email, forgot/reset-password, `/plan`, `/users`

### Основные
- `/v1/tasks` — задачи (CRUD, статусы, приоритеты, проекты)
- `/v1/projects` — проекты (CRUD, цвета)
- `/v1/habits` — привычки
- `/v1/goals` — цели
- `/v1/journal` — дневник
- `/v1/ideas` — идеи
- `/v1/meetings` — встречи
- `/v1/people` — контакты
- `/v1/documents` — документы (с файлами)

### AI и обработка
- `/v1/ai/chat` — AI-чат (с контекстом из vault; см. предупреждение про AI-провайдера в разделе «Стек»)
- `/v1/ingest` — загрузка файлов (до 50MB)
- `/v1/claude-notes` — AI-генерация заметок
- `/v1/search` — полнотекстовый поиск по vault
- `/v1/advisors` — Совет директоров (AI-персоны): анализ ситуации, чат, синтез консенсуса
- `/v1/commitments` — обязательства, извлечённые AI из встреч
- `/v1/transcribe` — расшифровка аудио: загрузка, статус, саммари

### Интеграции
- `/v1/todoist` — Todoist (токен-based, двусторонняя синхронизация)
  - `POST /connect-token` — подключение по API токену
  - `POST /sync` — полная синхронизация (pull + push + auto-create проектов)
  - `POST /disconnect` — отключение
  - `GET /status` — статус подключения
  - `GET /projects` — проекты Todoist
  - `GET /mapping` — маппинг проектов
- `/v1/google-calendar` — Google Calendar (OAuth)
- `/v1/yandex-calendar` — Yandex Calendar (OAuth)
- `/v1/email-webhook` — входящие email
- `/v1/widget` — виджет (iPhone Shortcut)

### Служебные
- `/v1/api-tokens` — выпуск/список/отзыв персональных API-токенов (`cs_...`); требуют полноценной сессии по паролю, другим токеном их не выпустить
- `/v1/docs`, `/v1/openapi.yaml` — Swagger UI и спецификация OpenAPI 3.1, без авторизации

### Админ
- `/v1/tags` — теги
- `/v1/templates` — шаблоны
- `/v1/export` — экспорт данных
- `/v1/admin` — панель админа: статистика, управление пользователями

### Вне `/v1`
- `/health` — без авторизации. Проверяет зависимости: PostgreSQL (критичная — при отказе весь эндпоинт отвечает `503`), vault на диске, Whisper/сервис транскрипции, LLM-клиент, политику 152-ФЗ по облачному фолбэку расшифровки. Если все некритичные проверки в порядке — `200` со статусом `ok`; если что-то из некритичного отказало — `200` со статусом `degraded`; если недоступен Postgres — `503` со статусом `down`.
- `/mcp` — Model Context Protocol (JSON-RPC 2.0), не REST-конверт `{ success, data }`. Тот же Bearer `cs_...` токен, что и у остального API.

## Todoist интеграция

Двусторонняя синхронизация задач и проектов:
- **API v1** (Todoist deprecated v2 в 2026)
- Подключение по API-токену (без OAuth)
- Автоматическое создание проектов в Todoist по названию из Clarity Space
- Pull: задачи из Todoist → Clarity Space (с привязкой к проектам)
- Push: задачи из Clarity Space → Todoist (по проектам)
- Sync completion: завершённые у нас → закрываются в Todoist и наоборот
- Маппинг хранится в таблице `settings` (todoist_project_map_*, todoist_task_*, clarity_task_todoist_*)

## Env переменные

Сверено построчно с `packages/api/src/config/index.ts` (единственный модуль, который парсит `process.env` для API).

```
PORT, NODE_ENV
DATABASE_URL                        — строка подключения PostgreSQL — реальная рабочая БД
DATABASE_PATH                       — НЕ путь к активной БД (SQLite по нему не создаётся). Каталог
                                       (dirname) используется как место на диске для аудио
                                       незавершённых расшифровок (services/pending-jobs.ts)
VAULT_PATH                          — путь к Obsidian vault
OPENAI_API_KEY                      — ключ для AI-чата/AI-функций; без него AI-роуты отвечают 501,
                                       остальной API работает
OPENAI_BASE_URL                     — опционально: смена LLM-провайдера (например, Yandex Cloud)
                                       одной переменной, без правок кода. Обязательно со схемой
                                       (http:// или https://)
ANTHROPIC_API_KEY                   — зарезервирован в конфиге, НЕ используется НИ ОДНИМ клиентом —
                                       в коде нет Anthropic SDK, только OpenAI-совместимый (см. «Стек»)
ADVISOR_OPENAI_API_KEY              — опционально: отдельный ключ для Совета директоров (/v1/advisors),
                                       фолбэк на OPENAI_API_KEY
ADVISOR_MODEL                       — опционально: модель для Совета директоров (по умолчанию gpt-4.1-mini)
TRANSCRIPTION_ALLOW_CLOUD_FALLBACK  — 152-ФЗ: разрешён ли откат расшифровки на облачный OpenAI
                                       whisper-1, если недоступны локальные бэкенды (по умолчанию —
                                       разрешён, т.е. не задано или не false/0/no/off)
TRANSCRIBE_SERVICE_URL              — адрес микросервиса faster-whisper (по умолчанию
                                       http://127.0.0.1:8091)
MAX_FILE_SIZE_MB                    — лимит загрузки (50MB)
TELEGRAM_BOT_TOKEN                  — бот @MyBestKanban_bot
TELEGRAM_USER_ID                    — ID пользователя для бота
WEBAPP_URL                          — опционально: URL веб-приложения для ссылок из бота
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   — Google Calendar OAuth
TODOIST_CLIENT_ID, TODOIST_CLIENT_SECRET — опционально (для OAuth, не обязательно — основной путь
                                       подключения Todoist — по токену, без OAuth)
YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET   — Yandex Calendar OAuth
JWT_SECRET                          — обязателен в production: без него процесс отказывается
                                       стартовать (см. config/index.ts)
RESEND_API_KEY                      — отправка email
EMAIL_FROM                          — адрес отправителя писем
```

Читаются напрямую через `process.env` в отдельных модулях, а не через `config/index.ts` (найдено при сверке, не полный список): `WEBHOOK_SECRET`, `WEBHOOK_DEFAULT_USER_ID` (`routes/email-webhook.ts`).

## Архитектура

- **Obsidian = Source of Truth**: все записи хранятся как .md файлы с WikiLinks
- **PostgreSQL = рабочая база и индекс**: схема (`schema-pg.sql`) накатывается автоматически при старте (`runSchema()`); SQLite (`db.sqlite.ts`) — не задействован ни в проде, ни в дев-режиме, остался только как след миграции (`scripts/migrate-sqlite-to-pg.ts`)
- **Multi-user**: данные привязаны к user_id
- **Dark mode**: полная поддержка через `class` toggle
- **Mobile-first**: свайп-интерфейс, Telegram Web App, responsive layout
- **Шрифт**: Onest (кастомный)

## Важно

- **Todoist API v1** (не v2!) — v2 deprecated, возвращает 410
- API v1 возвращает `{ results: [...] }` вместо plain array
- При сборке API: `npx tsc` (компилирует в dist/), запуск через `pm2 start dist/index.js`
- PM2: после обновления — `pm2 delete` + `pm2 start` (не restart)
- Сервер — НЕ git-репозиторий: код доставляется rsync/scp, не `git pull`. `dist/` обязательно пересобирается на сервере (`npx tsc`) перед рестартом — устаревший `dist/` уже один раз унёс на прод код, которого в `src/` больше не было
- Vault файлы никогда не удаляются, используется `archived: true`

## Роутинг задач

Задачи в этом проекте распределяются между субагентами из `.claude/agents/`. Оркестратор выбирает агента по типу задачи:

| Тип задачи | Агент | Когда вызывается |
|---|---|---|
| «Спланируй», «спроектируй», архитектурное решение | architect | До написания кода: план реализации фичи или рефакторинга, без единой строки кода |
| «Напиши функцию / фичу с тестами», багфикс | tester | Новая функциональность или багфикс: сначала падающий тест, потом реализация до зелёного |
| Любое изменение кода перед завершением | code-reviewer | После любого изменения кода, перед коммитом или мержем: независимое ревью диффа |
| «Подготовь КП / письмо клиенту / follow-up» | sales-assistant | Коммерческое предложение, деловое письмо, follow-up после встречи или переписки |
| «Разбери тендер», запрос на участие в закупке | tender-specialist | Пришла тендерная документация: разбор требований и решение об участии |
| «Разбери транскрипт / протокол встречи» | meeting-analyst | Есть транскрипт или заметки созвона: превращение в протокол с решениями и задачами |
| «Пост / лендинг / кейс», маркетинговый текст | content-writer | Нужен текст для соцсетей, лендинга или кейс |
| «Изучи рынок / конкурентов», проверка гипотезы | market-researcher | Анализ конкурентов, рынка, ниши или рыночной гипотезы |
| «Посчитай юнит-экономику / финмодель» | unit-economist | Расчёт юнит-экономики, финмодель, оценка окупаемости продукта, канала, направления |
| «Оцени сделку / входящее предложение» | deal-analyst | Входящее предложение о сотрудничестве, сделке, партнёрстве или инвестиции: due diligence и рекомендация да/нет |
| Проверка документа перед выдачей | fact-checker | Перед выдачей любого бизнес-документа (КП, отчёт, презентация, письмо с цифрами): проверка фактов и цифр |
| «Оформи отчёт / документацию / регламент» | doc-writer | Документация, отчёт, регламент или структурированная записка на русском |
| «Создай нового агента» | meta-agent | Создание нового субагента из словесного описания процесса |

## Обязательный цикл для изменений кода

1. Нетривиальные задачи начинаются с плана (plan mode); исполнение идёт после подтверждения плана.
2. Новая функциональность начинается с теста, затем пишется реализация (агент tester, TDD).
3. Любое изменение кода перед завершением проходит code-reviewer.
4. Замечания уровня critical и major устраняются до завершения; замечания minor фиксируются в ответе.

**Важно:** `TEST_COMMAND` в `.claude/hooks/config.env` (локальный, не в git — см. `.gitignore`) прописан на `jest` для `packages/api`, stop-gate блокирует завершение при регрессии. Из общего прогона намеренно исключены 6 давно сломанных сьютов (`api`, `db`, `projects`, `search` — тесты под старый SQLite, закомментированы; `critical-paths` — написан под vitest, а не jest; `parsers` — один тест бьётся о реальный вызов OpenAI без валидного ключа в тестовом окружении). Это не наш долг, они были такими до этой задачи — но без исключения `TEST_COMMAND` был бы красным всегда, а не только при новой регрессии, и гейт был бы бесполезен. Если эти сьюты почините — уберите их из `--testPathIgnorePatterns`.

## Прозрачность

В конце работы кратко перечисляются привлечённые агенты и использованные skills. Пример: «разбор сделал meeting-analyst, ревью — code-reviewer».
