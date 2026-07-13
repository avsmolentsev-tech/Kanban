# Handoff — текущее состояние работы (для Claude-сессии на сервере или локально)

> Прочитай это в начале сессии. Секретов тут нет (они в `.env`, не в git).
> Последнее обновление: 2026-07-13.

## Где что
- **Активная ветка:** `security-fixes` (НЕ `master`). Прод работает с неё.
- ⚠️ **`origin/master` на GitHub — ЧУЖАЯ ветка (Forge/MiniApp от бота «Claude Ops»)**, местами SQLite-регрессии, БЕЗ нашей работы. **НЕ мёржить в прод, НЕ пушить в master.** Наша линия — только `security-fixes`.
- Прод: `31.128.43.174`, `/var/www/kanban-app`, API на порту **3002**, pm2 процесс `kanban-api`.
- Веб раздаётся из `apps/web/dist` (nginx), API — tsx/dist из `packages/api`.
- Транскрибация: отдельный Docker-сервис faster-whisper на `127.0.0.1:8091` (`/opt/transcribe-service`).

## Как деплоить (с сервера — проще всего)
```bash
cd /var/www/kanban-app
git fetch origin security-fixes && git reset --hard origin/security-fixes   # если правил локально — сначала commit+push в security-fixes
cd apps/web && CI=true npx vite build          # фронт → apps/web/dist
cd ../../packages/api && node build.mjs        # API → dist (esbuild)
cd /var/www/kanban-app && pm2 restart kanban-api && pm2 logs kanban-api --lines 8 --nostream
```
- `CI=true` обязателен для vite/pnpm по ssh (иначе pnpm просит TTY).
- API собирается **esbuild (`build.mjs`)**, НЕ tsc — strict-ошибки tsc это норм, прод собирается.
- Схема БД применяется идемпотентно из `schema-pg.sql` при старте API.
- **Всегда тестировать серверную логику самому** перед тем, как звать пользователя (сгенерить токен/дёрнуть эндпоинт curl'ом), UI на устройстве — просить пользователя.

## Что уже сделано и живо (см. полную историю в git log)
Совет директоров (страница `/council` + вкладка на встрече + чат с советом + аватары), Договорённости (`/commitments`), командный чат (bulk_update_tasks в voice-command), отдельная транскрибация (`/transcribe` + Telegram «транскрибация» + резюме), фото людей из Telegram, качество встреч (extractActionItems с цитатами), напоминания о привычках, интро, свайп задач (Kanban/Timeline), download-токены (короткие scoped вместо сессии в URL).

## Открытые TODO
- Виджет→Safari просит пароль каждый раз (хвост ротации JWT_SECRET + Safari отдельно от PWA-хранилища). Проверить, лечится ли одним входом в Safari; иначе — magic-link / долгоживущий вход.
- **Git-гигиена:** свести `security-fixes` в нормальный `main`, Forge вынести в отдельный репо.
- **Локальная LLM под 152-ФЗ:** саммари/поиск/Совет идут в OpenAI (перс. данные РФ за рубеж). Поднять Qwen2.5-7B (Ollama) на отдельном VPS 8 vCPU/32 ГБ; перевести саммари/поиск на неё.
- Модерн-пасс дизайна (Kanban/Люди/Совет — единый стиль).
- userbot для «контактных» фото Telegram (нужны api_id/api_hash с my.telegram.org; на сервере userbot'а НЕТ).
- Тир транскрибации free (локально) / Pro (OpenAI).

## Гочи / правила
- Deploy НЕ через push в master (там Forge) — только прямой билд на сервере из `security-fixes`.
- `ADVISOR_MODEL=gpt-4.1-mini` (проекту недоступны gpt-4.1/4o). Совет — отдельный ключ `ADVISOR_OPENAI_API_KEY`.
- Vault — git-репо `obsidian-vault`, авто-синк cron `*/15 vault-git-autosync.sh` (умирал при переезде — не трогать без нужды).
- Мультиюзер: всё скоупить по `user_id` (был класс IDOR — закрыт, не регрессировать).
