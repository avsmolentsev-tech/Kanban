# Weekly Goals — Design

**Date:** 2026-04-21
**Status:** Approved

## Purpose

Bot proactively asks user about weekly goals on Sunday evening and Monday morning. User responds with goals via voice/text. Bot distributes by day, creates tasks. Daily evening reminder if main goal not done. Reminder time configurable via `/settings`.

## Flow

1. **Sunday 18:00 MSK** → bot sends: "Какие цели на следующую неделю? Напиши или надиктуй список."
2. **Monday 09:00 MSK** → if user hasn't responded: "Неделя началась! Расставим цели? Напиши что планируешь."
3. User responds (text or voice) → bot calls Claude to parse goals and distribute Mon-Sun.
4. Bot sends confirmation card with day-by-day breakdown + `[✅ OK] [✏️ Исправить]`.
5. On ✅ → creates tasks with `due_date` per day, tag `weekly-goal`, status `todo`.
6. **Daily at user's configured time (default 21:00 MSK)** → if today's `weekly-goal` task is not `done`: "Главная цель сегодня: <title>. Успел?"
7. User can change reminder time: `/settings reminder_time 20:00`

## Storage

- No new tables. Weekly goal tasks = regular tasks with tag `weekly-goal` in description or a marker.
- User settings: `settings` table (already exists) — key `reminder_time`, value `HH:MM`, per user_id.
- Dedup: `notification_log` table (already exists) — prevents duplicate prompts.

## Code changes

- `packages/api/src/services/notification.service.ts` — add `checkWeeklyGoalPrompt()` and `checkDailyGoalReminder()`
- `packages/api/src/services/telegram.service.ts` — add `/settings` command handler; handle weekly goal response via existing draft-card or executeCommand flow
- `packages/api/src/db/db.ts` — ensure `settings` table exists (CREATE IF NOT EXISTS)

## Key decisions

- Weekly goal tasks are REGULAR tasks (not a separate entity) — visible in Kanban board, Timeline, Calendar.
- Tag/marker: description starts with `[🎯 Цель недели]` — simple, searchable, no schema change.
- Claude prompt for distribution: receives list of goals + existing calendar events for the week → proposes balanced distribution.
- Sunday prompt sent to ALL linked users (not just Slava) — multi-user compatible.
- If user ignores both Sunday + Monday prompts → no further nagging until next Sunday.
