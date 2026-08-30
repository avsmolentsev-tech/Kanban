# Clarity Space (Personal Intelligence System)

## Что это

Персональная система управления жизнью и проектами. Obsidian vault — единственный источник правды, SQLite — только индекс (перестраиваемый). Задачи, проекты, привычки, цели, дневник, встречи, документы, AI-чат с Claude.

## Стек

- **Монорепо:** pnpm workspace
- **Frontend:** React 18 + Vite + Tailwind + Framer Motion + Tiptap (rich text)
- **Backend:** Express + SQLite (better-sqlite3) + TypeScript
- **AI:** Claude API (Anthropic) с prompt caching + локальный Whisper
- **Бот:** Telegram @MyBestKanban_bot (ops bot в `apps/claude-ops-bot`)
- **Деплой:** clarity-space.ru / 31.128.43.174, PM2, nginx

## Структура

```
apps/web/              — React SPA (порт 5173 dev)
apps/claude-ops-bot/   — Telegram ops bot
packages/api/          — Express API (порт 3001 dev, compiled JS in dist/)
packages/shared/       — Общие TypeScript типы
vault/                 — Obsidian vault (source of truth)
data/                  — SQLite database (index only)
```

## Команды

```bash
pnpm dev           # Запуск API + фронтенд
pnpm install       # Установка зависимостей
```

### Сборка и деплой

```bash
# API (TypeScript → JS)
cd packages/api && npx tsc

# Frontend
cd apps/web && npx vite build

# Перезапуск на сервере
ssh root@31.128.43.174 "pm2 delete kanban-api && cd /var/www/kanban-app/packages/api && pm2 start dist/index.js --name kanban-api && pm2 save"
```

## Серверные пути

- Приложение: `/var/www/kanban-app/`
- API запускается из: `/var/www/kanban-app/packages/api/dist/index.js`
- PM2 процесс: `kanban-api`
- Vault на сервере: `/var/www/kanban-app/vault/`
- SQLite: `/var/www/kanban-app/data/`

## API Routes (24 эндпоинта)

### Аутентификация
- `/v1/auth` — login, register, profile

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
- `/v1/ai/chat` — Claude AI чат (с контекстом из vault)
- `/v1/ingest` — загрузка файлов (до 50MB)
- `/v1/claude-notes` — AI-генерация заметок
- `/v1/search` — полнотекстовый поиск по vault

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

### Админ
- `/v1/tags` — теги
- `/v1/templates` — шаблоны
- `/v1/export` — экспорт данных
- `/v1/admin` — панель админа

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

```
PORT, NODE_ENV
ANTHROPIC_API_KEY       — Claude API
OPENAI_API_KEY          — опционально
VAULT_PATH              — путь к Obsidian vault
DATABASE_PATH           — путь к SQLite
TELEGRAM_BOT_TOKEN      — бот @MyBestKanban_bot
TELEGRAM_USER_ID        — ID пользователя для бота
MAX_FILE_SIZE_MB        — лимит загрузки (50MB)
TODOIST_CLIENT_ID       — опционально (для OAuth, не обязательно)
TODOIST_CLIENT_SECRET   — опционально (для OAuth, не обязательно)
```

## Архитектура

- **Obsidian = Source of Truth**: все записи хранятся как .md файлы с WikiLinks
- **SQLite = Index**: перестраиваемый индекс, не мастер-данные
- **Multi-user**: данные привязаны к user_id
- **Dark mode**: полная поддержка через `class` toggle
- **Mobile-first**: свайп-интерфейс, Telegram Web App, responsive layout
- **Шрифт**: Onest (кастомный)

## Важно

- **Todoist API v1** (не v2!) — v2 deprecated, возвращает 410
- API v1 возвращает `{ results: [...] }` вместо plain array
- При сборке API: `npx tsc` (компилирует в dist/), запуск через `pm2 start dist/index.js`
- PM2: после обновления — `pm2 delete` + `pm2 start` (не restart)
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

**Важно:** тестовый фреймворк для этого проекта не проверен автоматически — `TEST_COMMAND` в `.claude/hooks/config.env` пуст, stop-gate не блокирует завершение работы, пока команда явно не прописана под стек проекта.

## Прозрачность

В конце работы кратко перечисляются привлечённые агенты и использованные skills. Пример: «разбор сделал meeting-analyst, ревью — code-reviewer».
