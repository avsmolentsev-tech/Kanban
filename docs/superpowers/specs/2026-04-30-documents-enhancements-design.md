# Documents Enhancements — Design Spec

**Date:** 2026-04-30
**Status:** Approved

## Overview

Расширение Notion-like Documents page: "+" кнопки для создания контента, slash-меню в редакторе, inline изображения с resize, вложенные документы через sub-pages, поиск в sidebar, drag-and-drop документов и идей, удаление из sidebar.

---

## 1. "+" кнопки в sidebar

Рядом с заголовком каждой секции внутри проекта — кнопка "+", появляется при hover:

```
▼ Проект "Стартап"
  ─── Документы ───                    +
  📄 Бизнес-план
  ─── Встречи ───                      +
  📅 Встреча с инвестором
  ─── Идеи ───                         +
  💡 Монетизация
```

### Поведение

- **Документы "+"** — создаёт документ в проекте (`POST /documents`), открывает в editor area
- **Встречи "+"** — создаёт встречу (title: "Новая встреча", date: сегодня, project_id: текущий проект), открывает в editor area для редактирования
- **Идеи "+"** — создаёт идею (title: "Новая идея", project_id: текущий проект), открывает в editor area

### Создание встреч из sidebar

Новый endpoint не нужен — используем существующий `POST /meetings` с телом:
```json
{ "title": "Новая встреча", "date": "2026-04-30", "project_id": 1 }
```

После создания — встреча открывается в editor area. Но вместо read-only нужен **editable mode** для встреч, созданных из sidebar. Добавляем inline-редактирование полей: title, date, summary_raw (textarea).

### Создание идей из sidebar

Используем существующий `POST /ideas` с телом:
```json
{ "title": "Новая идея", "project_id": 1 }
```

После создания — идея открывается в editor area. Аналогично встречам — editable mode для title и body.

---

## 2. Slash-меню (/) в редакторе

При вводе "/" в пустой строке или нажатии "+" кнопки слева от строки — всплывающее меню:

```
┌──────────────────────┐
│ 📄 Дочерний документ │
│ 🖼 Изображение       │
│ 🔗 Ссылка            │
│ ─  Разделитель       │
│ 📋 Чекбокс           │
│ 💻 Блок кода         │
│ ❝  Цитата            │
└──────────────────────┘
```

### Slash-команды

| Команда | Действие |
|---------|----------|
| Дочерний документ | Создаёт документ с `parent_id = текущий`, вставляет кликабельный блок-ссылку в текст |
| Изображение | Открывает file picker, загружает, вставляет inline `<img>` |
| Ссылка | Prompt для URL и текста, вставляет `<a>` |
| Разделитель | Вставляет `<hr>` |
| Чекбокс | Вставляет task list |
| Блок кода | Вставляет code block |
| Цитата | Вставляет blockquote |

### Реализация

- Tiptap extension: slash-команды через `@tiptap/suggestion` или кастомный plugin
- Меню появляется при "/" в начале строки
- Фильтрация по вводу: "/изо" → показывает только "Изображение"
- Escape закрывает меню
- "+" кнопка слева от строки — тот же плагин, но триггер по клику

### Блок-ссылка на дочерний документ

В тексте отображается как кликабельный блок:

```
┌─────────────────────────────────────┐
│ 📄 Финмодель                    →   │
└─────────────────────────────────────┘
```

- Кастомный Tiptap node: `childDocument`
- Атрибуты: `documentId`, `title`
- Клик → `setActiveDocument(doc)` (открывает дочерний)
- Стиль: border, padding, hover эффект, иконка документа

---

## 3. Inline изображения с resize

### Загрузка

1. Выбор через "/" меню → "Изображение" → file picker
2. Или drag-and-drop файла прямо в editor area
3. Файл загружается через `POST /documents/:id/attachments`
4. В editor вставляется `<img src="/v1/documents/attachments/file/{filename}">`

### Отображение

- Изображение inline в тексте, по умолчанию max-width: 100%
- При клике — выделяется, появляются resize handles (4 угла)
- Resize сохраняет пропорции (aspect ratio lock)
- Размер (width) сохраняется как атрибут в HTML

### Реализация

- Tiptap extension: `@tiptap/extension-image` + кастомный resize wrapper
- Или `tiptap-extension-resize-image` (готовое решение с handles)
- Drag-and-drop: обработчик `drop` event на editor → upload → insert

### Хранение

- Файлы: `vault/Attachments/{docId}-{timestamp}.{ext}`
- HTML в body: `<img src="/v1/documents/attachments/file/1-1714470000.jpg" width="600">`
- При Obsidian sync: `![](Attachments/1-1714470000.jpg)` в markdown

---

## 4. Поиск в sidebar

### UI

Строка поиска сверху sidebar, над списком проектов:

```
┌─────────────────────────┐
│ 🔍 Поиск...             │
├─────────────────────────┤
│ ▼ Стартап               │
│   📄 Бизнес-план        │
```

### Поведение

- Client-side фильтрация по title (документы, встречи, идеи)
- При вводе текста — показываются только совпадения
- Проекты с совпадениями автоматически раскрываются
- Проекты без совпадений скрываются
- Пустой запрос — обычный вид дерева
- Подсветка совпадений в названиях
- `Ctrl+F` фокусит поиск (когда sidebar видим)
- Debounce 150ms

### Данные

Поиск идёт по уже загруженным данным в `projectData` Map из store. Не нужен серверный поиск — данные уже на клиенте.

---

## 5. Drag-and-drop в sidebar

### Документы

- Перетаскивание документа на другой проект → меняет `project_id`
- Перетаскивание документа на другой документ → меняет `parent_id` (становится дочерним)
- Visual feedback: target подсвечивается при drag over
- `PATCH /documents/:id` с новым `project_id` и/или `parent_id`

### Идеи

- Перетаскивание идеи на другой проект → меняет `project_id`
- `PATCH /ideas/:id` с новым `project_id`

### Встречи

- Не перетаскиваются (привязка через junction table `meeting_projects`)

### Реализация

- `@dnd-kit` (уже установлен в проекте)
- `DndContext` оборачивает sidebar
- `useDraggable` на DocumentTreeItem и IdeaTreeItem
- `useDroppable` на ProjectTreeItem и DocumentTreeItem

---

## 6. Удаление из sidebar

### Документы

- Hover на документ → иконка корзины (Trash2) справа, opacity 0 → 1
- Клик → confirm dialog "Удалить документ?"
- При удалении дочерние документы становятся корневыми (`parent_id = null`)
- `DELETE /documents/:id`

### Идеи

- Аналогично — иконка корзины при hover
- `DELETE /ideas/:id` (или archive: `PATCH /ideas/:id { archived: true }`)

### Встречи

- Не удаляются из sidebar (удалять с отдельной страницы)

---

## 7. Editable встречи и идеи в editor area

### Встречи (editable mode)

При создании из sidebar "+" или при клике "Редактировать":
- Title — editable input
- Date — date input
- Summary — textarea (или Tiptap editor light)
- Participants — список (добавить/удалить)
- Автосохранение через PATCH

При просмотре существующих встреч — read-only как сейчас, с кнопкой "Редактировать".

### Идеи (editable mode)

- Title — editable input
- Body — textarea
- Category — select (business, product, personal, growth)
- Автосохранение через PATCH

---

## Зависимости (npm packages)

### Новые

- `@tiptap/extension-image` — inline изображения
- `tiptap-extension-resize-image` — resize handles (или кастомная реализация)

### Существующие (используем)

- `@dnd-kit/core`, `@dnd-kit/sortable` — drag-and-drop (уже установлены)
- `@tiptap/react`, `@tiptap/starter-kit` — уже установлены
- `lucide-react` — иконки

---

## Компоненты (новые/модифицированные)

```
apps/web/src/components/documents/
├── DocumentsSidebar.tsx        # MODIFY: добавить поиск
├── ProjectTreeItem.tsx         # MODIFY: "+" кнопки, drag-and-drop targets
├── DocumentTreeItem.tsx        # MODIFY: delete, draggable, "+" дочерний
├── IdeaTreeItem.tsx            # NEW: draggable идея с удалением
├── SidebarSearch.tsx           # NEW: строка поиска
├── TiptapEditor.tsx            # MODIFY: slash-меню, image drop, child doc blocks
├── SlashMenu.tsx               # NEW: "/" всплывающее меню
├── ChildDocBlock.tsx           # NEW: кликабельный блок-ссылка на дочерний документ
├── ImageResizeWrapper.tsx      # NEW: обёртка для resize изображений
├── MeetingEditable.tsx         # NEW: editable view встречи
├── IdeaEditable.tsx            # NEW: editable view идеи
├── MeetingReadonly.tsx          # KEEP: read-only с кнопкой "Редактировать"
└── IdeaReadonly.tsx             # KEEP: read-only с кнопкой "Редактировать"
```

## Не входит в scope

- Drag-and-drop встреч между проектами
- Версионирование документов
- Совместное редактирование
- Таблицы в редакторе
- Mentions (@)
- Комментарии к документам
