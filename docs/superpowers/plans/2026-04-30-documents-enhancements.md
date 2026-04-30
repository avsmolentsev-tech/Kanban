# Documents Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "+" creation buttons, slash-menu with inline images and child documents, sidebar search, drag-and-drop for documents/ideas, and deletion from sidebar.

**Architecture:** Extend existing Notion-like Documents page with Tiptap extensions (Image, slash commands via Suggestion API), dnd-kit for sidebar drag-and-drop, and client-side search filtering. Editable views for meetings/ideas in editor area. All new components follow existing patterns.

**Tech Stack:** Tiptap (Image extension, Suggestion API), @dnd-kit/core (already installed), React, Zustand, Tailwind, lucide-react

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/src/components/documents/SidebarSearch.tsx` | Search input with client-side filtering |
| `apps/web/src/components/documents/SlashMenu.tsx` | Slash command popup menu for "/" trigger |
| `apps/web/src/components/documents/MeetingEditable.tsx` | Editable meeting view in editor area |
| `apps/web/src/components/documents/IdeaEditable.tsx` | Editable idea view in editor area |
| `apps/web/src/extensions/slash-commands.ts` | Tiptap extension for "/" slash commands |
| `apps/web/src/extensions/child-document-node.ts` | Tiptap custom node for child document block |
| `apps/web/src/extensions/resizable-image.ts` | Tiptap image extension with resize handles |

### Modified Files

| File | Changes |
|------|---------|
| `apps/web/src/store/documents.store.ts` | Add createMeeting, createIdea, deleteIdea, updateMeeting, updateIdea, searchQuery state |
| `apps/web/src/components/documents/DocumentsSidebar.tsx` | Add SidebarSearch, wrap with DndContext |
| `apps/web/src/components/documents/ProjectTreeItem.tsx` | Add "+" buttons on section headers, droppable targets |
| `apps/web/src/components/documents/DocumentTreeItem.tsx` | Add delete icon, draggable, droppable for nesting, "+" child button |
| `apps/web/src/components/documents/TiptapEditor.tsx` | Add slash-commands extension, image extension, child-document node, image drop handler |
| `apps/web/src/pages/NotionDocumentsPage.tsx` | Add MeetingEditable/IdeaEditable views |
| `apps/web/src/components/documents/MeetingReadonly.tsx` | Add "Edit" button |
| `apps/web/src/components/documents/IdeaReadonly.tsx` | Add "Edit" button |
| `apps/web/src/index.css` | Add styles for slash menu, child doc block, image resize handles |
| `apps/web/package.json` | Add @tiptap/extension-image |

---

## Task 1: Install @tiptap/extension-image

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install**

```bash
cd /c/Users/smolentsev/.claude/NewProject/Kanban/apps/web && pnpm add @tiptap/extension-image
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/package.json ../../pnpm-lock.yaml
git commit -m "chore: install @tiptap/extension-image"
```

---

## Task 2: Store — add createMeeting, createIdea, deleteIdea, updateMeeting, updateIdea, searchQuery

**Files:**
- Modify: `apps/web/src/store/documents.store.ts`

- [ ] **Step 1: Add new imports and API calls**

At the top of `documents.store.ts`, add to imports:

```typescript
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
```

Replace the existing `import { apiGet } from '../api/client';` line.

- [ ] **Step 2: Add searchQuery to state interface**

Add to the `DocumentsState` interface (after `lastSaved: string | null;`):

```typescript
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  createMeeting: (projectId: number | null) => Promise<void>;
  createIdea: (projectId: number | null) => Promise<void>;
  deleteIdea: (id: number, projectId: number | null) => Promise<void>;
  updateMeeting: (id: number, data: Record<string, unknown>) => Promise<void>;
  updateIdea: (id: number, data: Record<string, unknown>) => Promise<void>;
  editingMeeting: boolean;
  editingIdea: boolean;
  setEditingMeeting: (editing: boolean) => void;
  setEditingIdea: (editing: boolean) => void;
```

- [ ] **Step 3: Add implementations**

Add to the store after `setLastSaved`:

```typescript
  searchQuery: '',
  editingMeeting: false,
  editingIdea: false,

  setSearchQuery: (query) => set({ searchQuery: query }),
  setEditingMeeting: (editing) => set({ editingMeeting: editing }),
  setEditingIdea: (editing) => set({ editingIdea: editing }),

  createMeeting: async (projectId) => {
    const date = new Date().toISOString().split('T')[0];
    const meeting = await apiPost<Meeting>('/meetings', {
      title: 'Новая встреча',
      date,
      project_id: projectId,
    });
    await get().loadProjectData(projectId);
    set({
      activeItem: { type: 'meeting', id: meeting.id },
      activeDocument: null,
      activeMeeting: meeting,
      activeIdea: null,
      editingMeeting: true,
    });
  },

  createIdea: async (projectId) => {
    const idea = await apiPost<Idea>('/ideas', {
      title: 'Новая идея',
      project_id: projectId,
    });
    await get().loadProjectData(projectId);
    set({
      activeItem: { type: 'idea', id: idea.id },
      activeDocument: null,
      activeMeeting: null,
      activeIdea: idea,
      editingIdea: true,
    });
  },

  deleteIdea: async (id, projectId) => {
    await apiPatch(`/ideas/${id}`, { archived: true });
    if (get().activeItem?.type === 'idea' && get().activeItem?.id === id) get().clearActive();
    await get().loadProjectData(projectId);
  },

  updateMeeting: async (id, data) => {
    set({ saving: true });
    const updated = await apiPatch<Meeting>(`/meetings/${id}`, data);
    set({ saving: false, lastSaved: new Date().toISOString(), activeMeeting: updated });
    const projId = get().activeMeeting?.project_id ?? null;
    await get().loadProjectData(projId);
  },

  updateIdea: async (id, data) => {
    set({ saving: true });
    const updated = await apiPatch<Idea>(`/ideas/${id}`, data);
    set({ saving: false, lastSaved: new Date().toISOString(), activeIdea: updated });
    const projId = get().activeIdea?.project_id ?? null;
    await get().loadProjectData(projId);
  },
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/store/documents.store.ts
git commit -m "feat: add createMeeting/createIdea/deleteIdea/updateMeeting/updateIdea + search to store"
```

---

## Task 3: SidebarSearch component

**Files:**
- Create: `apps/web/src/components/documents/SidebarSearch.tsx`
- Modify: `apps/web/src/components/documents/DocumentsSidebar.tsx`

- [ ] **Step 1: Create SidebarSearch.tsx**

```tsx
import { Search, X } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import { useRef, useEffect } from 'react';

export function SidebarSearch() {
  const { t } = useLangStore();
  const { searchQuery, setSearchQuery } = useDocumentsStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="px-2 py-2 border-b border-gray-200 dark:border-gray-700/50">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('Поиск...', 'Search...')}
          className="w-full pl-8 pr-7 py-1.5 text-sm bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-200 rounded-md border-none focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-gray-400 dark:placeholder-gray-500"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add SidebarSearch to DocumentsSidebar.tsx**

In `DocumentsSidebar.tsx`, add import:
```typescript
import { SidebarSearch } from './SidebarSearch';
```

Add `<SidebarSearch />` right after the header div (after `</div>` of the "Проекты" header, before the tree div):

```tsx
      <SidebarSearch />
```

- [ ] **Step 3: Add search filtering to ProjectTreeItem**

In `ProjectTreeItem.tsx`, add `searchQuery` to the destructured store values:
```typescript
  const {
    expandedProjects, toggleProject, projectData,
    activeItem, setActiveMeeting, setActiveIdea, searchQuery,
  } = useDocumentsStore();
```

Add filtering logic after getting `data`:
```typescript
  const query = searchQuery.toLowerCase().trim();
  const filteredData = data && query ? {
    documents: data.documents.filter(d => d.title.toLowerCase().includes(query)),
    meetings: data.meetings.filter(m => m.title.toLowerCase().includes(query)),
    ideas: data.ideas.filter(i => i.title.toLowerCase().includes(query)),
  } : data;

  // Auto-expand when searching
  const hasMatches = filteredData && (filteredData.documents.length > 0 || filteredData.meetings.length > 0 || filteredData.ideas.length > 0);
  const shouldShow = !query || hasMatches;
  const effectiveExpanded = query ? !!hasMatches : isExpanded;
```

Then use `filteredData` instead of `data` and `effectiveExpanded` instead of `isExpanded` in the render. Hide the project if `!shouldShow`:

Wrap the return in: `if (!shouldShow) return null;` at the top.

Replace `{isExpanded && data && (` with `{effectiveExpanded && filteredData && (`.

Replace all `data.documents`, `data.meetings`, `data.ideas` with `filteredData.documents`, etc.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/documents/SidebarSearch.tsx apps/web/src/components/documents/DocumentsSidebar.tsx apps/web/src/components/documents/ProjectTreeItem.tsx
git commit -m "feat: add sidebar search with client-side filtering"
```

---

## Task 4: "+" buttons on section headers in ProjectTreeItem

**Files:**
- Modify: `apps/web/src/components/documents/ProjectTreeItem.tsx`

- [ ] **Step 1: Add imports and store actions**

Add `Plus` to lucide imports:
```typescript
import { ChevronRight, Calendar, Lightbulb, Plus } from 'lucide-react';
```

Add to store destructuring:
```typescript
  const {
    expandedProjects, toggleProject, projectData,
    activeItem, setActiveMeeting, setActiveIdea, searchQuery,
    createDocument, setActiveDocument, createMeeting, createIdea,
  } = useDocumentsStore();
```

- [ ] **Step 2: Replace Documents section header**

Replace the documents section header div:
```tsx
              <div className="text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium">
                {t('Документы', 'Documents')}
              </div>
```
With:
```tsx
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium group/docs">
                <span>{t('Документы', 'Documents')}</span>
                <button
                  onClick={async (e) => { e.stopPropagation(); const doc = await createDocument({ title: t('Новый документ', 'New document'), project_id: projectId }); setActiveDocument(doc); }}
                  className="opacity-0 group-hover/docs:opacity-100 text-gray-400 hover:text-indigo-500 transition-all cursor-pointer"
                  title={t('Новый документ', 'New document')}
                >
                  <Plus size={14} />
                </button>
              </div>
```

- [ ] **Step 3: Replace Meetings section header**

Replace the meetings collapse button:
```tsx
              <button
                onClick={() => setMeetingsCollapsed(!meetingsCollapsed)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium cursor-pointer hover:text-gray-400"
              >
                <ChevronRight size={10} className={`transition-transform ${!meetingsCollapsed ? 'rotate-90' : ''}`} />
                {t('Встречи', 'Meetings')} ({data.meetings.length})
              </button>
```
With:
```tsx
              <div className="flex items-center justify-between px-2 py-1 group/meetings">
                <button
                  onClick={() => setMeetingsCollapsed(!meetingsCollapsed)}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-600 font-medium cursor-pointer hover:text-gray-400"
                >
                  <ChevronRight size={10} className={`transition-transform ${!meetingsCollapsed ? 'rotate-90' : ''}`} />
                  {t('Встречи', 'Meetings')} ({filteredData.meetings.length})
                </button>
                <button
                  onClick={async (e) => { e.stopPropagation(); await createMeeting(projectId); }}
                  className="opacity-0 group-hover/meetings:opacity-100 text-gray-400 hover:text-indigo-500 transition-all cursor-pointer"
                  title={t('Новая встреча', 'New meeting')}
                >
                  <Plus size={14} />
                </button>
              </div>
```

- [ ] **Step 4: Replace Ideas section header (same pattern)**

Replace the ideas collapse button with:
```tsx
              <div className="flex items-center justify-between px-2 py-1 group/ideas">
                <button
                  onClick={() => setIdeasCollapsed(!ideasCollapsed)}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-600 font-medium cursor-pointer hover:text-gray-400"
                >
                  <ChevronRight size={10} className={`transition-transform ${!ideasCollapsed ? 'rotate-90' : ''}`} />
                  {t('Идеи', 'Ideas')} ({filteredData.ideas.length})
                </button>
                <button
                  onClick={async (e) => { e.stopPropagation(); await createIdea(projectId); }}
                  className="opacity-0 group-hover/ideas:opacity-100 text-gray-400 hover:text-indigo-500 transition-all cursor-pointer"
                  title={t('Новая идея', 'New idea')}
                >
                  <Plus size={14} />
                </button>
              </div>
```

- [ ] **Step 5: Show section headers even when empty (so "+" is always available)**

Replace the condition `{data.documents.length > 0 && (` with `{(` (always show Documents section).

Replace `{data.meetings.length > 0 && (` with `{(` (always show Meetings section).

Replace `{data.ideas.length > 0 && (` with `{(` (always show Ideas section).

Remove the empty state block at the bottom (the one with "Пусто").

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/documents/ProjectTreeItem.tsx
git commit -m "feat: add + buttons on section headers for documents, meetings, ideas"
```

---

## Task 5: Delete icon on documents and ideas in sidebar

**Files:**
- Modify: `apps/web/src/components/documents/DocumentTreeItem.tsx`
- Modify: `apps/web/src/components/documents/ProjectTreeItem.tsx` (idea items)

- [ ] **Step 1: Add delete to DocumentTreeItem**

Add `Trash2` to imports:
```typescript
import { FileText, ChevronRight, Trash2 } from 'lucide-react';
```

Add `deleteDocument` to store destructuring:
```typescript
  const { activeItem, setActiveDocument, deleteDocument } = useDocumentsStore();
```

Add delete button inside the button, after `<span className="truncate">{doc.title}</span>`:
```tsx
        <Trash2
          size={12}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all ml-auto"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Удалить документ?')) deleteDocument(doc.id);
          }}
        />
```

- [ ] **Step 2: Add delete to idea items in ProjectTreeItem**

In `ProjectTreeItem.tsx`, add `deleteIdea` to store destructuring.

Add `Trash2` to lucide imports:
```typescript
import { ChevronRight, Calendar, Lightbulb, Plus, Trash2 } from 'lucide-react';
```

In the idea button, add after `<span className="truncate">{idea.title}</span>`:
```tsx
                  <Trash2
                    size={12}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all ml-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Удалить идею?')) deleteIdea(idea.id, projectId);
                    }}
                  />
```

Add `group` class to each idea button (so group-hover works):
Change the idea button className to include `group` — add `group` at the end of the className string.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/documents/DocumentTreeItem.tsx apps/web/src/components/documents/ProjectTreeItem.tsx
git commit -m "feat: add delete icons on hover for documents and ideas in sidebar"
```

---

## Task 6: MeetingEditable and IdeaEditable components

**Files:**
- Create: `apps/web/src/components/documents/MeetingEditable.tsx`
- Create: `apps/web/src/components/documents/IdeaEditable.tsx`
- Modify: `apps/web/src/components/documents/MeetingReadonly.tsx` (add Edit button)
- Modify: `apps/web/src/components/documents/IdeaReadonly.tsx` (add Edit button)
- Modify: `apps/web/src/pages/NotionDocumentsPage.tsx` (wire editable views)

- [ ] **Step 1: Create MeetingEditable.tsx**

Create `apps/web/src/components/documents/MeetingEditable.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import { Calendar, Save } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import type { SidebarMeeting } from '../../store/documents.store';

interface Props {
  meeting: SidebarMeeting;
}

export function MeetingEditable({ meeting }: Props) {
  const { t } = useLangStore();
  const { updateMeeting, setEditingMeeting } = useDocumentsStore();
  const [title, setTitle] = useState(meeting.title);
  const [date, setDate] = useState(meeting.date.split('T')[0]);
  const [summary, setSummary] = useState(meeting.summary_raw);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(meeting.title);
    setDate(meeting.date.split('T')[0]);
    setSummary(meeting.summary_raw);
  }, [meeting.id]);

  const autoSave = (field: string, value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateMeeting(meeting.id, { [field]: value });
    }, 2000);
  };

  return (
    <div className="px-8 py-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <input
          className="text-2xl font-bold bg-transparent text-gray-800 dark:text-gray-100 focus:outline-none placeholder-gray-400 w-full"
          value={title}
          onChange={(e) => { setTitle(e.target.value); autoSave('title', e.target.value); }}
          placeholder={t('Название встречи', 'Meeting title')}
        />
        <button
          onClick={() => setEditingMeeting(false)}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-4 cursor-pointer flex-shrink-0"
        >
          {t('Готово', 'Done')}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <Calendar size={14} className="text-gray-400" />
        <input
          type="date"
          className="text-sm bg-transparent text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
          value={date}
          onChange={(e) => { setDate(e.target.value); autoSave('date', e.target.value); }}
        />
      </div>

      <div>
        <div className="text-xs text-gray-500 mb-2">{t('Содержание', 'Content')}</div>
        <textarea
          className="w-full text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 resize-y min-h-[300px]"
          rows={15}
          value={summary}
          onChange={(e) => { setSummary(e.target.value); autoSave('summary_raw', e.target.value); }}
          placeholder={t('Заметки встречи...', 'Meeting notes...')}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create IdeaEditable.tsx**

Create `apps/web/src/components/documents/IdeaEditable.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import { Lightbulb } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import type { SidebarIdea } from '../../store/documents.store';

const CATEGORIES = ['business', 'product', 'personal', 'growth'] as const;

interface Props {
  idea: SidebarIdea;
}

export function IdeaEditable({ idea }: Props) {
  const { t } = useLangStore();
  const { updateIdea, setEditingIdea } = useDocumentsStore();
  const [title, setTitle] = useState(idea.title);
  const [body, setBody] = useState(idea.body);
  const [category, setCategory] = useState(idea.category);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTitle(idea.title);
    setBody(idea.body);
    setCategory(idea.category);
  }, [idea.id]);

  const autoSave = (field: string, value: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updateIdea(idea.id, { [field]: value });
    }, 2000);
  };

  return (
    <div className="px-8 py-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center flex-shrink-0">
            <Lightbulb size={16} className="text-amber-400" />
          </div>
          <input
            className="text-2xl font-bold bg-transparent text-gray-800 dark:text-gray-100 focus:outline-none placeholder-gray-400 w-full"
            value={title}
            onChange={(e) => { setTitle(e.target.value); autoSave('title', e.target.value); }}
            placeholder={t('Название идеи', 'Idea title')}
          />
        </div>
        <button
          onClick={() => setEditingIdea(false)}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 ml-4 cursor-pointer flex-shrink-0"
        >
          {t('Готово', 'Done')}
        </button>
      </div>

      <div className="flex items-center gap-1.5 mb-6">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => { setCategory(c); updateIdea(idea.id, { category: c }); }}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize cursor-pointer ${
              category === c ? 'bg-indigo-600 text-white border-transparent' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div>
        <textarea
          className="w-full text-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 resize-y min-h-[200px]"
          rows={10}
          value={body}
          onChange={(e) => { setBody(e.target.value); autoSave('body', e.target.value); }}
          placeholder={t('Описание идеи...', 'Describe your idea...')}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add Edit button to MeetingReadonly**

In `MeetingReadonly.tsx`, add import:
```typescript
import { Calendar, Users, Download, FileText, ScrollText, Pencil } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
```

Add after the download buttons div:
```tsx
      {/* Edit button */}
      <button
        onClick={() => useDocumentsStore.getState().setEditingMeeting(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer mb-6"
      >
        <Pencil size={14} />
        {t('Редактировать', 'Edit')}
      </button>
```

- [ ] **Step 4: Add Edit button to IdeaReadonly**

In `IdeaReadonly.tsx`, add imports:
```typescript
import { Lightbulb, Pencil } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
```

Add after the category/status badges div:
```tsx
      <button
        onClick={() => useDocumentsStore.getState().setEditingIdea(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer mb-6"
      >
        <Pencil size={14} />
        {t('Редактировать', 'Edit')}
      </button>
```

- [ ] **Step 5: Wire editable views in NotionDocumentsPage**

In `NotionDocumentsPage.tsx`, add imports:
```typescript
import { MeetingEditable } from '../components/documents/MeetingEditable';
import { IdeaEditable } from '../components/documents/IdeaEditable';
```

Add `editingMeeting, editingIdea` to store destructuring:
```typescript
  const {
    activeItem, activeDocument, activeMeeting, activeIdea,
    saving, lastSaved, updateDocument, editingMeeting, editingIdea,
  } = useDocumentsStore();
```

Replace the meeting section:
```tsx
            {activeItem.type === 'meeting' && activeMeeting && (
              <div className="flex-1 overflow-y-auto">
                {editingMeeting ? (
                  <MeetingEditable meeting={activeMeeting} />
                ) : (
                  <MeetingReadonly meeting={activeMeeting} />
                )}
              </div>
            )}
```

Replace the idea section:
```tsx
            {activeItem.type === 'idea' && activeIdea && (
              <div className="flex-1 overflow-y-auto">
                {editingIdea ? (
                  <IdeaEditable idea={activeIdea} />
                ) : (
                  <IdeaReadonly idea={activeIdea} />
                )}
              </div>
            )}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/documents/MeetingEditable.tsx apps/web/src/components/documents/IdeaEditable.tsx apps/web/src/components/documents/MeetingReadonly.tsx apps/web/src/components/documents/IdeaReadonly.tsx apps/web/src/pages/NotionDocumentsPage.tsx
git commit -m "feat: editable meeting/idea views with autosave + edit buttons"
```

---

## Task 7: Resizable image Tiptap extension

**Files:**
- Create: `apps/web/src/extensions/resizable-image.ts`
- Modify: `apps/web/src/index.css` (add resize styles)

- [ ] **Step 1: Create resizable-image.ts**

Create `apps/web/src/extensions/resizable-image.ts`:

```typescript
import Image from '@tiptap/extension-image';

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return { style: `width: ${attributes.width}px` };
        },
        parseHTML: (element) => {
          const width = element.style.width?.replace('px', '');
          return width ? parseInt(width, 10) : null;
        },
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const container = document.createElement('div');
      container.classList.add('image-resize-container');
      container.contentEditable = 'false';

      const img = document.createElement('img');
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || '';
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
      else img.style.maxWidth = '100%';

      const handle = document.createElement('div');
      handle.classList.add('image-resize-handle');

      let startX = 0;
      let startWidth = 0;

      handle.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        startX = e.clientX;
        startWidth = img.offsetWidth;

        const onMouseMove = (ev: MouseEvent) => {
          const newWidth = Math.max(100, startWidth + (ev.clientX - startX));
          img.style.width = `${newWidth}px`;
        };

        const onMouseUp = (ev: MouseEvent) => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          const finalWidth = Math.max(100, startWidth + (ev.clientX - startX));
          if (typeof getPos === 'function') {
            editor.chain().focus().command(({ tr }) => {
              tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, width: finalWidth });
              return true;
            }).run();
          }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      container.appendChild(img);
      container.appendChild(handle);

      return {
        dom: container,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'image') return false;
          img.src = updatedNode.attrs.src;
          if (updatedNode.attrs.width) img.style.width = `${updatedNode.attrs.width}px`;
          return true;
        },
      };
    };
  },
});
```

- [ ] **Step 2: Add CSS for image resize**

Add to the end of `apps/web/src/index.css`:

```css
/* Image resize */
.image-resize-container {
  position: relative; display: inline-block; max-width: 100%; margin: 0.5rem 0; cursor: default;
}
.image-resize-container img { display: block; border-radius: 0.375rem; }
.image-resize-handle {
  position: absolute; right: -4px; bottom: -4px; width: 12px; height: 12px;
  background: #6366f1; border-radius: 2px; cursor: nwse-resize; opacity: 0; transition: opacity 0.15s;
}
.image-resize-container:hover .image-resize-handle { opacity: 1; }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/extensions/resizable-image.ts apps/web/src/index.css
git commit -m "feat: resizable image Tiptap extension with drag handle"
```

---

## Task 8: Slash commands extension + SlashMenu

**Files:**
- Create: `apps/web/src/extensions/slash-commands.ts`
- Create: `apps/web/src/components/documents/SlashMenu.tsx`

- [ ] **Step 1: Create SlashMenu.tsx**

Create `apps/web/src/components/documents/SlashMenu.tsx`:

```tsx
import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { FileText, Image, Link2, Minus, CheckSquare, Code2, Quote } from 'lucide-react';

export interface SlashMenuItem {
  title: string;
  icon: React.ReactNode;
  command: () => void;
}

interface Props {
  items: SlashMenuItem[];
}

export interface SlashMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SlashMenu = forwardRef<SlashMenuRef, Props>(({ items }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => setSelectedIndex(0), [items]);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) item.command();
    },
    [items],
  );

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden min-w-[200px]">
      {items.map((item, index) => (
        <button
          key={index}
          onClick={() => selectItem(index)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
            index === selectedIndex
              ? 'bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
        >
          <span className="text-gray-400 dark:text-gray-500">{item.icon}</span>
          {item.title}
        </button>
      ))}
    </div>
  );
});

SlashMenu.displayName = 'SlashMenu';

export function getSlashMenuItems(query: string, handlers: {
  onChildDocument: () => void;
  onImage: () => void;
  onLink: () => void;
  onDivider: () => void;
  onTaskList: () => void;
  onCodeBlock: () => void;
  onBlockquote: () => void;
}): Omit<SlashMenuItem, 'command'>[] & { command: () => void }[] {
  const all: SlashMenuItem[] = [
    { title: 'Дочерний документ', icon: <FileText size={16} />, command: handlers.onChildDocument },
    { title: 'Изображение', icon: <Image size={16} />, command: handlers.onImage },
    { title: 'Ссылка', icon: <Link2 size={16} />, command: handlers.onLink },
    { title: 'Разделитель', icon: <Minus size={16} />, command: handlers.onDivider },
    { title: 'Чекбокс', icon: <CheckSquare size={16} />, command: handlers.onTaskList },
    { title: 'Блок кода', icon: <Code2 size={16} />, command: handlers.onCodeBlock },
    { title: 'Цитата', icon: <Quote size={16} />, command: handlers.onBlockquote },
  ];
  if (!query) return all;
  const q = query.toLowerCase();
  return all.filter((item) => item.title.toLowerCase().includes(q));
}
```

- [ ] **Step 2: Create slash-commands.ts**

Create `apps/web/src/extensions/slash-commands.ts`:

```typescript
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: true,
        pluginKey: new PluginKey('slashCommands'),
        command: ({ editor, range, props }: { editor: any; range: any; props: any }) => {
          editor.chain().focus().deleteRange(range).run();
          props.command();
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
```

- [ ] **Step 3: Add slash menu CSS**

Add to end of `apps/web/src/index.css`:

```css
/* Slash menu tippy */
.tippy-box[data-theme='slash-menu'] { background: transparent; border: none; box-shadow: none; }
.tippy-box[data-theme='slash-menu'] .tippy-content { padding: 0; }
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/extensions/slash-commands.ts apps/web/src/components/documents/SlashMenu.tsx apps/web/src/index.css
git commit -m "feat: slash commands extension + menu component"
```

---

## Task 9: Wire everything into TiptapEditor

**Files:**
- Modify: `apps/web/src/components/documents/TiptapEditor.tsx`

- [ ] **Step 1: Update TiptapEditor with new extensions and slash menu**

Replace the entire `apps/web/src/components/documents/TiptapEditor.tsx`:

```tsx
import { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExt from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import { EditorToolbar } from './EditorToolbar';
import { SlashMenu, getSlashMenuItems, type SlashMenuRef } from './SlashMenu';
import { SlashCommands } from '../../extensions/slash-commands';
import { ResizableImage } from '../../extensions/resizable-image';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import { apiClient } from '../../api/client';

interface Props {
  documentId: number;
  initialContent: string;
  title: string;
  onTitleChange: (title: string) => void;
}

export function TiptapEditor({ documentId, initialContent, title, onTitleChange }: Props) {
  const { t } = useLangStore();
  const { updateDocument, setSaving, setLastSaved, createDocument, setActiveDocument } = useDocumentsStore();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docIdRef = useRef(documentId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    docIdRef.current = documentId;
  }, [documentId]);

  const saveContent = useCallback(
    (html: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(async () => {
        await updateDocument(docIdRef.current, { body: html });
        setLastSaved(new Date().toISOString());
        setSaving(false);
      }, 2000);
    },
    [updateDocument, setSaving, setLastSaved],
  );

  const uploadImage = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiClient.post(`/documents/${docIdRef.current}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    const attachment = res.data?.data;
    if (attachment?.filename) {
      return `/v1/documents/attachments/file/${attachment.filename}`;
    }
    return null;
  }, []);

  const handleImageInsert = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleChildDocument = useCallback(async () => {
    const activeDoc = useDocumentsStore.getState().activeDocument;
    if (!activeDoc) return;
    const child = await createDocument({
      title: t('Новый документ', 'New document'),
      project_id: activeDoc.project_id,
      parent_id: activeDoc.id,
    });
    // Insert a link block in the editor
    editor?.chain().focus().insertContent(
      `<p><a href="#doc-${child.id}" class="child-doc-link">📄 ${child.title}</a></p>`
    ).run();
    // Navigate to child
    setActiveDocument(child);
  }, [createDocument, setActiveDocument, t]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        LinkExt.configure({
          openOnClick: true,
          HTMLAttributes: { class: 'text-indigo-400 underline hover:text-indigo-300 cursor-pointer' },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({
          placeholder: t('Начните писать или нажмите / для команд...', 'Start writing or press / for commands...'),
        }),
        ResizableImage,
        SlashCommands.configure({
          suggestion: {
            char: '/',
            startOfLine: false,
            items: ({ query }: { query: string }) => {
              return getSlashMenuItems(query, {
                onChildDocument: () => handleChildDocument(),
                onImage: () => handleImageInsert(),
                onLink: () => {
                  const url = window.prompt('URL:');
                  if (url) editor?.chain().focus().setLink({ href: url }).run();
                },
                onDivider: () => editor?.chain().focus().setHorizontalRule().run(),
                onTaskList: () => editor?.chain().focus().toggleTaskList().run(),
                onCodeBlock: () => editor?.chain().focus().toggleCodeBlock().run(),
                onBlockquote: () => editor?.chain().focus().toggleBlockquote().run(),
              });
            },
            render: () => {
              let component: ReactRenderer<SlashMenuRef> | null = null;
              let popup: TippyInstance[] | null = null;

              return {
                onStart: (props: any) => {
                  component = new ReactRenderer(SlashMenu, { props, editor: props.editor });
                  popup = tippy('body', {
                    getReferenceClientRect: props.clientRect,
                    appendTo: () => document.body,
                    content: component.element,
                    showOnCreate: true,
                    interactive: true,
                    trigger: 'manual',
                    placement: 'bottom-start',
                    theme: 'slash-menu',
                  });
                },
                onUpdate: (props: any) => {
                  component?.updateProps(props);
                  popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect });
                },
                onKeyDown: (props: any) => {
                  if (props.event.key === 'Escape') {
                    popup?.[0]?.hide();
                    return true;
                  }
                  return component?.ref?.onKeyDown(props.event) ?? false;
                },
                onExit: () => {
                  popup?.[0]?.destroy();
                  component?.destroy();
                },
              };
            },
          },
        }),
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[400px] px-8 py-4',
        },
        handleDrop: (view, event) => {
          const files = event.dataTransfer?.files;
          if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('image/')) {
              event.preventDefault();
              uploadImage(file).then((url) => {
                if (url) {
                  editor?.chain().focus().setImage({ src: url }).run();
                }
              });
              return true;
            }
          }
          return false;
        },
        handlePaste: (view, event) => {
          const files = event.clipboardData?.files;
          if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('image/')) {
              event.preventDefault();
              uploadImage(file).then((url) => {
                if (url) {
                  editor?.chain().focus().setImage({ src: url }).run();
                }
              });
              return true;
            }
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        saveContent(ed.getHTML());
      },
    },
    [documentId],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadImage(file);
    if (url) {
      editor?.chain().focus().setImage({ src: url }).run();
    }
    e.target.value = '';
  }, [editor, uploadImage]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <input
        className="text-2xl font-bold bg-transparent text-gray-800 dark:text-gray-100 px-8 pt-6 pb-2 focus:outline-none placeholder-gray-400 dark:placeholder-gray-600 w-full"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={t('Без названия', 'Untitled')}
      />
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </div>
  );
}
```

- [ ] **Step 2: Install tippy.js for slash menu popover**

```bash
cd /c/Users/smolentsev/.claude/NewProject/Kanban/apps/web && pnpm add tippy.js @tiptap/suggestion
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/documents/TiptapEditor.tsx apps/web/package.json ../../pnpm-lock.yaml
git commit -m "feat: slash menu + inline images + drag/paste image upload in editor"
```

---

## Task 10: Drag-and-drop in sidebar

**Files:**
- Modify: `apps/web/src/components/documents/DocumentsSidebar.tsx`
- Modify: `apps/web/src/components/documents/DocumentTreeItem.tsx`
- Modify: `apps/web/src/components/documents/ProjectTreeItem.tsx`

- [ ] **Step 1: Wrap sidebar with DndContext**

In `DocumentsSidebar.tsx`, add imports:
```typescript
import { DndContext, DragOverlay, rectIntersection, type DragEndEvent, MouseSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useState } from 'react';
```

Wrap the tree div content with `DndContext`:

```tsx
export function DocumentsSidebar() {
  const { t } = useLangStore();
  const { projects, fetchProjects } = useProjectsStore();
  const { createDocument, setActiveDocument, expandedProjects, updateDocument } = useDocumentsStore();
  const activeProjects = projects.filter((p) => !p.archived);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 } });
  const sensors = useSensors(mouseSensor);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleNewDoc = async () => {
    const expandedArr = Array.from(expandedProjects);
    const projectId = expandedArr.length > 0 ? expandedArr[0] : null;
    const doc = await createDocument({ title: t('Новый документ', 'New document'), project_id: projectId });
    setActiveDocument(doc);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    // Document → Project drop
    if (activeId.startsWith('doc-drag-') && overId.startsWith('project-drop-')) {
      const docId = Number(activeId.replace('doc-drag-', ''));
      const targetProjectId = overId === 'project-drop-none' ? null : Number(overId.replace('project-drop-', ''));
      await updateDocument(docId, { project_id: targetProjectId, parent_id: null });
    }
    // Document → Document drop (nesting)
    if (activeId.startsWith('doc-drag-') && overId.startsWith('doc-drop-')) {
      const docId = Number(activeId.replace('doc-drag-', ''));
      const parentDocId = Number(overId.replace('doc-drop-', ''));
      if (docId !== parentDocId) {
        await updateDocument(docId, { parent_id: parentDocId });
      }
    }
    // Idea → Project drop
    if (activeId.startsWith('idea-drag-') && overId.startsWith('project-drop-')) {
      const ideaId = Number(activeId.replace('idea-drag-', ''));
      const targetProjectId = overId === 'project-drop-none' ? null : Number(overId.replace('project-drop-', ''));
      const { apiPatch } = await import('../../api/client');
      await apiPatch(`/ideas/${ideaId}`, { project_id: targetProjectId });
      // Reload all expanded projects
      for (const pid of expandedProjects) {
        await useDocumentsStore.getState().loadProjectData(pid);
      }
    }
  };

  return (
    <div className="w-[280px] min-w-[280px] bg-gray-50 dark:bg-gray-800/50 border-r border-gray-200 dark:border-gray-700/50 flex flex-col h-full">
      <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-700/50">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-500">
          {t('Проекты', 'Projects')}
        </span>
      </div>

      <SidebarSearch />

      <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragStart={(e) => setDraggingId(String(e.active.id))} onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-y-auto px-1 py-2">
          {activeProjects.map((p) => (
            <ProjectTreeItem key={p.id} project={p} />
          ))}
          <ProjectTreeItem project={null} />
        </div>
      </DndContext>

      <div className="p-2 border-t border-gray-200 dark:border-gray-700/50">
        <button onClick={handleNewDoc} className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer">
          <Plus size={16} />
          {t('Новый документ', 'New document')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Make DocumentTreeItem draggable + droppable**

In `DocumentTreeItem.tsx`, add imports:
```typescript
import { useDraggable, useDroppable } from '@dnd-kit/core';
```

Inside the component, add:
```typescript
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: `doc-drag-${doc.id}` });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `doc-drop-${doc.id}` });
```

Merge refs on the button and apply drag listeners. Add visual feedback for drop target:
- `opacity: isDragging ? 0.4 : 1` on the button style
- `${isOver ? 'ring-2 ring-indigo-500' : ''}` in className

- [ ] **Step 3: Make ProjectTreeItem a drop target**

In `ProjectTreeItem.tsx`, add imports:
```typescript
import { useDroppable } from '@dnd-kit/core';
```

Add inside the component:
```typescript
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `project-drop-${projectId ?? 'none'}` });
```

Apply `setDropRef` to the project header button and add visual feedback:
```
${isOver ? 'bg-indigo-100 dark:bg-indigo-600/20' : ''}
```

- [ ] **Step 4: Make idea items draggable**

Add `useDraggable` to each idea button in ProjectTreeItem, with `id: idea-drag-${idea.id}`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/documents/DocumentsSidebar.tsx apps/web/src/components/documents/DocumentTreeItem.tsx apps/web/src/components/documents/ProjectTreeItem.tsx
git commit -m "feat: drag-and-drop documents between projects + nesting, ideas between projects"
```

---

## Task 11: Build + verify + push

- [ ] **Step 1: Type-check frontend**

```bash
cd /c/Users/smolentsev/.claude/NewProject/Kanban/apps/web && npx tsc --noEmit
```

- [ ] **Step 2: Build frontend**

```bash
npx vite build
```

- [ ] **Step 3: Fix any issues**

- [ ] **Step 4: Push**

```bash
git push origin master
```
