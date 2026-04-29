# Notion-like Documents — Design Spec

**Date:** 2026-04-30
**Status:** Approved

## Overview

Превращаем страницу Documents в Notion-like интерфейс для заметок и ссылок. Sidebar с деревом проектов (документы, встречи, идеи), rich-text редактор на Tiptap, двусторонняя синхронизация с Obsidian через frontmatter и WikiLinks.

## Layout

Полноэкранный интерфейс с тремя зонами:

```
┌─────────────────────────────────────────────────────┐
│  Header (существующий)                              │
├──────────┬──────────────────────────────────────────┤
│ Sidebar  │  Editor Area                             │
│ 280px    │                                          │
│          │  Breadcrumbs: Project > Parent > Current  │
│ Projects │  Title (editable h1)                     │
│  tree    │  Toolbar: B I S │ H1 H2 H3 │ ...        │
│          │  Content                                  │
│          │                                          │
├──────────┤                                          │
│ + New doc│                                          │
└──────────┴──────────────────────────────────────────┘
```

## Sidebar — дерево проектов

Левая панель 280px, resizable не нужен. Содержит:

### Структура дерева

```
▼ Проект "Стартап"
  ─── Документы ───
  📄 Бизнес-план
     📄 Финмодель (вложенный)
  📄 Заметки по MVP
  ─── Встречи ───
  📅 Встреча с инвестором · 14 апр
  📅 Созвон с дизайнером · 10 апр
  ─── Идеи ───
  💡 Монетизация через API
  💡 Партнёрка с банком
▼ Проект "PIS"
  📄 Архитектура
  📅 ...
  💡 ...
📁 Без проекта
  📄 Черновик
```

### Поведение sidebar

- Проекты раскрываемые/сворачиваемые (chevron)
- Внутри проекта три секции с тонкими разделителями: Документы, Встречи, Идеи
- Секции "Встречи" и "Идеи" сворачиваемые
- Документы поддерживают вложенность до 3 уровней (parent_id)
- Клик на документ → открывает в editor area (editable)
- Клик на встречу → открывает summary в editor area (read-only)
- Клик на идею → открывает title+body в editor area (read-only)
- Текущий открытый элемент подсвечен
- Breadcrumbs сверху editor area: Проект > Родительский док > Текущий
- Кнопка "+ Новый документ" внизу sidebar (создаёт в текущем проекте)
- Документы без project_id — в секции "Без проекта"

### Данные для sidebar

Один запрос на загрузку — endpoint возвращает проекты с вложенными документами, встречами, идеями. Или параллельные запросы:
- `GET /v1/projects` — список проектов
- `GET /v1/documents?project_id=X&tree=true` — документы деревом
- `GET /v1/meetings?project_id=X` — встречи проекта
- `GET /v1/ideas?project_id=X` — идеи проекта

Данные загружаются при раскрытии проекта (lazy load).

## Rich-text редактор (Tiptap)

### Toolbar

Фиксированный сверху над контентом, компактный:

```
B  I  S  │  H1  H2  H3  │  •  1.  ☐  │  ""  <>  ─  │  🔗  │  ↩ ↪
```

- **B I S** — жирный, курсив, зачёркнутый
- **H1 H2 H3** — заголовки
- **• 1. ☐** — маркированный список, нумерованный, чекбоксы (task list)
- **"" <> ─** — цитата (blockquote), блок кода, горизонтальный разделитель
- **🔗** — вставка ссылки (текст + URL, кликабельная, без превью)
- **↩ ↪** — undo / redo

### Горячие клавиши

Стандартные:
- `Ctrl+B` — жирный
- `Ctrl+I` — курсив
- `Ctrl+K` — вставка ссылки
- `Ctrl+Shift+1/2/3` — заголовки H1/H2/H3
- `Ctrl+Z` / `Ctrl+Shift+Z` — undo/redo

Markdown-шорткаты (автозамена при вводе):
- `# ` → H1, `## ` → H2, `### ` → H3
- `- ` → маркированный список
- `1. ` → нумерованный список
- `[] ` → чекбокс
- `> ` → цитата
- `` ``` `` → блок кода

### Хранение контента

- Контент хранится как **HTML** в поле `body` таблицы `documents`
- При синхронизации с Obsidian конвертируется в Markdown
- Placeholder для пустого документа: "Начните писать..."

### Автосохранение

- Debounce 2 секунды после остановки ввода
- `PATCH /v1/documents/:id` с обновлённым `body`
- Визуальный индикатор в breadcrumbs: "Сохранено" / "Сохранение..."

## Вложенность документов

### Изменения в БД

Добавить поле в таблицу `documents`:

```sql
ALTER TABLE documents ADD COLUMN parent_id INTEGER REFERENCES documents(id);
```

### Правила вложенности

- `parent_id = NULL` — корневой документ в проекте
- `parent_id = <id>` — дочерний документ
- Максимальная глубина: 3 уровня
- При удалении родителя — дочерние становятся корневыми (parent_id = NULL)
- Перемещение документа: `PATCH /v1/documents/:id` с новым `parent_id` и/или `project_id`

### API — tree endpoint

`GET /v1/documents?project_id=X&tree=true` возвращает:

```json
[
  {
    "id": 1,
    "title": "Бизнес-план",
    "parent_id": null,
    "children": [
      {
        "id": 2,
        "title": "Финмодель",
        "parent_id": 1,
        "children": []
      }
    ]
  }
]
```

## Двусторонняя синхронизация с Obsidian

### PIS → Obsidian

При автосохранении документа:
1. HTML конвертируется в Markdown через библиотеку `turndown`
2. Добавляется YAML frontmatter (см. ниже)
3. Пишется в файл: `vault/user_N/Projects/{ProjectName}/{DocTitle}.md`
4. Вложенные документы — в подпапку: `vault/user_N/Projects/{ProjectName}/{ParentDocTitle}/{DocTitle}.md`
5. Поле `vault_path` обновляется в БД

### Obsidian → PIS

File watcher на `chokidar` следит за `vault/user_N/Projects/`:
1. При изменении .md файла — debounce 1 сек
2. Markdown конвертируется в HTML через `marked`
3. Frontmatter парсится, обновляются связи в БД (project, people, tags)
4. Документ находится по `vault_path`, обновляется `body` и `title`
5. Если файл новый (нет в БД) — создаётся документ

### Конфликты

Last-write-wins по timestamp `modified_at`. Простой подход, достаточный для single-user.

### Структура файлов в vault

```
vault/user_1/Projects/
├── Стартап/
│   ├── Бизнес-план.md
│   ├── Бизнес-план/
│   │   └── Финмодель.md
│   └── Заметки по MVP.md
└── PIS/
    └── Архитектура.md
```

## Frontmatter и WikiLinks

Все типы контента, синхронизируемые в vault, получают YAML frontmatter.

### Документы

```yaml
---
title: Бизнес-план
project: Стартап
tags:
  - project/Стартап
people:
  - "[[Иван Петров]]"
  - "[[Мария Смирнова]]"
status: active
category: note
created: 2026-04-29
modified: 2026-04-30
---
```

### Встречи

```yaml
---
title: Встреча с инвестором
date: 2026-04-14
project: Стартап
people:
  - "[[Иван Петров]]"
tags:
  - project/Стартап
  - meeting
agreements:
  - Подготовить финмодель до 20 апр
---
```

### Идеи

```yaml
---
title: Монетизация через API
project: Стартап
category: business
status: new
source_meeting: "[[Встреча с инвестором]]"
tags:
  - project/Стартап
  - idea
---
```

### Journal

```yaml
---
date: 2026-04-30
mood: 8
focus: Работа над Documents
tags:
  - journal
---
```

### Обратная синхронизация frontmatter

При изменении файла в Obsidian:
- Парсится frontmatter через `gray-matter`
- Обновляются связи: `project` → `project_id`, `people` → связи в junction-таблицах
- WikiLinks в body (`[[Имя]]`) распознаются и связываются с records в БД

## Встречи и идеи в editor area (read-only)

### Встреча (read-only view)

При клике на встречу в sidebar — editor area показывает:
- Title (h1, не editable)
- Дата, участники
- Summary (structured, если есть)
- Agreements (список с чекбоксами статуса)
- Toolbar скрыт

### Идея (read-only view)

При клике на идею:
- Title (h1, не editable)
- Category badge
- Body текст
- Source meeting link (если есть)
- Toolbar скрыт

## Зависимости (npm packages)

### Новые

- `@tiptap/react` + `@tiptap/starter-kit` — rich-text editor
- `@tiptap/extension-link` — ссылки
- `@tiptap/extension-task-list` + `@tiptap/extension-task-item` — чекбоксы
- `@tiptap/extension-placeholder` — placeholder text
- `turndown` — HTML → Markdown конвертация
- `marked` — Markdown → HTML конвертация
- `gray-matter` — парсинг YAML frontmatter
- `chokidar` — file watcher для Obsidian sync

### Существующие (используем)

- `zustand` — state management
- `react-router-dom` — роутинг
- `tailwindcss` — стили

## Компоненты (frontend)

```
apps/web/src/
├── pages/
│   └── DocumentsPage.tsx          # Главная страница (layout: sidebar + editor)
├── components/
│   └── documents/
│       ├── DocumentsSidebar.tsx    # Sidebar с деревом проектов
│       ├── ProjectTree.tsx        # Дерево одного проекта (docs, meetings, ideas)
│       ├── DocumentTreeItem.tsx   # Элемент дерева (документ, рекурсивный)
│       ├── MeetingTreeItem.tsx    # Элемент дерева (встреча)
│       ├── IdeaTreeItem.tsx       # Элемент дерева (идея)
│       ├── DocumentEditor.tsx     # Tiptap editor + toolbar + breadcrumbs
│       ├── EditorToolbar.tsx      # Toolbar с кнопками форматирования
│       ├── MeetingReadonly.tsx     # Read-only view встречи
│       ├── IdeaReadonly.tsx        # Read-only view идеи
│       └── Breadcrumbs.tsx        # Breadcrumbs навигация
├── stores/
│   └── documentsStore.ts          # Zustand store для documents page state
```

## Backend

```
packages/api/src/
├── routes/
│   └── documents.ts               # Обновить: tree endpoint, parent_id support
├── services/
│   └── obsidian-sync.service.ts   # Новый: двусторонняя синхронизация, frontmatter
```

## Не входит в scope

- Drag-and-drop документов в sidebar (можно добавить позже)
- Таблицы в редакторе
- Встроенные изображения
- Slash-команды (/)
- Mentions (@)
- Комментарии к документам
- Версионирование документов
- Совместное редактирование (multi-user realtime)
