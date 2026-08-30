# Notion-like Documents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Documents page into a Notion-like editor with project tree sidebar, Tiptap rich-text, nested documents, and bidirectional Obsidian sync with full frontmatter.

**Architecture:** Replace current Kanban-style DocumentsPage with a two-pane layout: left sidebar (280px) with collapsible project tree containing documents/meetings/ideas, right pane with Tiptap editor. Backend gets `parent_id` on documents, tree endpoint, and a new `obsidian-sync.service.ts` with chokidar file watcher + turndown/marked converters.

**Tech Stack:** Tiptap (rich-text), turndown (HTML→MD), marked (MD→HTML), gray-matter (frontmatter), chokidar (file watcher), Zustand (state), Tailwind (styling), lucide-react (icons)

**Design:** Dark theme matching PIS style — `bg-gray-900` base, `bg-gray-800` sidebar, `bg-gray-850` editor. Indigo accents (`#6366f1`). Notion-like clean layout with subtle borders, no heavy decorations. Inter font. Gradient spheres from existing PIS pages as background.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/src/pages/NotionDocumentsPage.tsx` | Main layout: sidebar + editor area |
| `apps/web/src/components/documents/DocumentsSidebar.tsx` | Left sidebar with project tree |
| `apps/web/src/components/documents/ProjectTreeItem.tsx` | Collapsible project node with docs/meetings/ideas |
| `apps/web/src/components/documents/DocumentTreeItem.tsx` | Document node in tree (recursive for nesting) |
| `apps/web/src/components/documents/TiptapEditor.tsx` | Tiptap editor wrapper + toolbar |
| `apps/web/src/components/documents/EditorToolbar.tsx` | Formatting toolbar buttons |
| `apps/web/src/components/documents/Breadcrumbs.tsx` | Breadcrumb navigation |
| `apps/web/src/components/documents/MeetingReadonly.tsx` | Read-only meeting view in editor area |
| `apps/web/src/components/documents/IdeaReadonly.tsx` | Read-only idea view in editor area |
| `apps/web/src/store/documents.store.ts` | Zustand store for documents page state |
| `apps/web/src/api/documents.api.ts` | API wrapper for documents endpoints |
| `packages/api/src/services/obsidian-sync.service.ts` | Bidirectional Obsidian sync with frontmatter |

### Modified Files

| File | Changes |
|------|---------|
| `packages/api/src/db/db.ts` | Add `parent_id` migration for documents |
| `packages/api/src/routes/documents.ts` | Add `parent_id` to schemas, add `tree=true` endpoint |
| `packages/api/src/services/obsidian.service.ts` | Add `writeDocument()` method with full frontmatter |
| `apps/web/src/App.tsx` | Replace DocumentsPage route with NotionDocumentsPage |
| `apps/web/package.json` | Add tiptap dependencies |
| `packages/api/package.json` | Add turndown, marked, gray-matter, chokidar |

---

## Task 1: Database — add parent_id to documents

**Files:**
- Modify: `packages/api/src/db/db.ts` (add migration after line ~111)
- Modify: `packages/api/src/routes/documents.ts` (lines 22-38: update schemas)

- [ ] **Step 1: Add parent_id migration in db.ts**

Open `packages/api/src/db/db.ts`. Find the line (around line 111):
```typescript
  // Documents: status column
  try { _db.exec("ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'"); } catch {}
```

Add directly after it:
```typescript
  // Documents: parent_id for nested documents (Notion-like)
  try { _db.exec("ALTER TABLE documents ADD COLUMN parent_id INTEGER REFERENCES documents(id)"); } catch {}
```

- [ ] **Step 2: Update CreateSchema in documents.ts**

Open `packages/api/src/routes/documents.ts`. Replace the `CreateSchema` (lines 22-29):

```typescript
const CreateSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional().default(''),
  project_id: z.number().int().nullable().optional(),
  parent_id: z.number().int().nullable().optional(),
  category: z.enum(['note', 'reference', 'template', 'archive']).optional().default('note'),
  vault_path: z.string().nullable().optional(),
  status: z.enum(DOC_STATUSES).optional().default('draft'),
});
```

- [ ] **Step 3: Update UpdateSchema in documents.ts**

Replace the `UpdateSchema` (lines 31-38):

```typescript
const UpdateSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  project_id: z.number().int().nullable().optional(),
  parent_id: z.number().int().nullable().optional(),
  category: z.enum(['note', 'reference', 'template', 'archive']).optional(),
  vault_path: z.string().nullable().optional(),
  status: z.enum(DOC_STATUSES).optional(),
});
```

- [ ] **Step 4: Update INSERT to include parent_id**

In `documents.ts`, replace the POST handler's INSERT (lines 55-57):

```typescript
  const { title, body, project_id, parent_id, category, vault_path } = parsed.data;
  const userId = getUserId(req);
  const result = getDb()
    .prepare('INSERT INTO documents (title, body, project_id, parent_id, category, vault_path, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(title, body, project_id ?? null, parent_id ?? null, category, vault_path ?? null, userId);
```

- [ ] **Step 5: Add tree query endpoint**

In `documents.ts`, replace the GET `/` handler (lines 40-48) with:

```typescript
documentsRouter.get('/', (req: AuthRequest, res: Response) => {
  const scope = userScopeWhere(req);
  let query = `SELECT * FROM documents WHERE ${scope.sql}`;
  const params: unknown[] = [...scope.params];
  if (req.query['project']) { query += ' AND project_id = ?'; params.push(Number(req.query['project'])); }
  if (req.query['category']) { query += ' AND category = ?'; params.push(req.query['category']); }
  query += ' ORDER BY updated_at DESC';
  const docs = getDb().prepare(query).all(...params) as Array<Record<string, unknown>>;

  // Build tree if requested
  if (req.query['tree'] === 'true') {
    const map = new Map<number, Record<string, unknown> & { children: unknown[] }>();
    const roots: Array<Record<string, unknown> & { children: unknown[] }> = [];
    for (const d of docs) {
      const node = { ...d, children: [] as unknown[] };
      map.set(d['id'] as number, node);
    }
    for (const node of map.values()) {
      const parentId = node['parent_id'] as number | null;
      if (parentId && map.has(parentId)) {
        map.get(parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    res.json(ok(roots));
    return;
  }

  res.json(ok(docs));
});
```

- [ ] **Step 6: Restart dev server and test**

Run:
```bash
cd /c/Users/smolentsev/.claude/NewProject/Kanban && pnpm dev
```

Test with curl:
```bash
curl -s http://localhost:3000/v1/documents?tree=true -H "Authorization: Bearer <token>" | head -c 500
```
Expected: JSON array with nested `children` arrays.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/db/db.ts packages/api/src/routes/documents.ts
git commit -m "feat(documents): add parent_id for nested documents + tree endpoint"
```

---

## Task 2: Install frontend dependencies (Tiptap)

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install tiptap packages**

```bash
cd /c/Users/smolentsev/.claude/NewProject/Kanban/apps/web
pnpm add @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-placeholder @tiptap/extension-underline
```

- [ ] **Step 2: Verify installation**

```bash
ls node_modules/@tiptap/react/package.json
```
Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml ../../pnpm-lock.yaml
git commit -m "chore: install tiptap rich-text editor dependencies"
```

---

## Task 3: Install backend dependencies (sync)

**Files:**
- Modify: `packages/api/package.json`

- [ ] **Step 1: Install sync packages**

```bash
cd /c/Users/smolentsev/.claude/NewProject/Kanban/packages/api
pnpm add turndown marked gray-matter chokidar
pnpm add -D @types/turndown
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('turndown'); require('marked'); require('gray-matter'); require('chokidar'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add packages/api/package.json ../../pnpm-lock.yaml
git commit -m "chore: install obsidian sync dependencies (turndown, marked, gray-matter, chokidar)"
```

---

## Task 4: Documents API wrapper

**Files:**
- Create: `apps/web/src/api/documents.api.ts`

- [ ] **Step 1: Create documents.api.ts**

Create `apps/web/src/api/documents.api.ts`:

```typescript
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface DocumentNode {
  id: number;
  title: string;
  body: string;
  project_id: number | null;
  parent_id: number | null;
  category: 'note' | 'reference' | 'template' | 'archive';
  status: string;
  vault_path: string | null;
  created_at: string;
  updated_at: string;
  children?: DocumentNode[];
}

export interface CreateDocumentDto {
  title: string;
  body?: string;
  project_id?: number | null;
  parent_id?: number | null;
  category?: string;
}

export interface UpdateDocumentDto {
  title?: string;
  body?: string;
  project_id?: number | null;
  parent_id?: number | null;
  category?: string;
  status?: string;
}

export const documentsApi = {
  tree: (projectId?: number) =>
    apiGet<DocumentNode[]>('/documents', { project: projectId, tree: 'true' }),

  list: (projectId?: number) =>
    apiGet<DocumentNode[]>('/documents', projectId ? { project: projectId } : undefined),

  get: (id: number) =>
    apiGet<DocumentNode>(`/documents/${id}`),

  create: (dto: CreateDocumentDto) =>
    apiPost<DocumentNode>('/documents', dto),

  update: (id: number, dto: UpdateDocumentDto) =>
    apiPatch<DocumentNode>(`/documents/${id}`, dto),

  delete: (id: number) =>
    apiDelete<{ deleted: boolean }>(`/documents/${id}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/api/documents.api.ts
git commit -m "feat: add documents API wrapper"
```

---

## Task 5: Documents Zustand store

**Files:**
- Create: `apps/web/src/store/documents.store.ts`

- [ ] **Step 1: Create documents store**

Create `apps/web/src/store/documents.store.ts`:

```typescript
import { create } from 'zustand';
import { documentsApi } from '../api/documents.api';
import type { DocumentNode, CreateDocumentDto, UpdateDocumentDto } from '../api/documents.api';
import { apiGet } from '../api/client';

interface Meeting {
  id: number;
  title: string;
  date: string;
  project_id: number | null;
  summary_raw: string;
  summary_structured: string | null;
}

interface Idea {
  id: number;
  title: string;
  body: string;
  category: string;
  project_id: number | null;
  source_meeting_id: number | null;
  status: string;
}

type SidebarItemType = 'document' | 'meeting' | 'idea';

interface ActiveItem {
  type: SidebarItemType;
  id: number;
}

interface ProjectData {
  documents: DocumentNode[];
  meetings: Meeting[];
  ideas: Idea[];
}

interface DocumentsState {
  // Sidebar data per project
  projectData: Map<number | null, ProjectData>;
  expandedProjects: Set<number | null>;

  // Active item in editor
  activeItem: ActiveItem | null;
  activeDocument: DocumentNode | null;
  activeMeeting: Meeting | null;
  activeIdea: Idea | null;

  // Save state
  saving: boolean;
  lastSaved: string | null;

  // Actions
  loadProjectData: (projectId: number | null) => Promise<void>;
  toggleProject: (projectId: number | null) => void;

  setActiveDocument: (doc: DocumentNode) => void;
  setActiveMeeting: (meeting: Meeting) => void;
  setActiveIdea: (idea: Idea) => void;
  clearActive: () => void;

  createDocument: (dto: CreateDocumentDto) => Promise<DocumentNode>;
  updateDocument: (id: number, dto: UpdateDocumentDto) => Promise<void>;
  deleteDocument: (id: number) => Promise<void>;

  setSaving: (saving: boolean) => void;
  setLastSaved: (ts: string) => void;
}

export const useDocumentsStore = create<DocumentsState>((set, get) => ({
  projectData: new Map(),
  expandedProjects: new Set(),

  activeItem: null,
  activeDocument: null,
  activeMeeting: null,
  activeIdea: null,

  saving: false,
  lastSaved: null,

  loadProjectData: async (projectId) => {
    const params = projectId !== null ? { project: projectId } : {};
    const [documents, meetings, ideas] = await Promise.all([
      documentsApi.tree(projectId ?? undefined),
      apiGet<Meeting[]>('/meetings', projectId !== null ? { project: projectId } : undefined),
      apiGet<Idea[]>('/ideas', projectId !== null ? { project: projectId } : undefined),
    ]);
    set((state) => {
      const newMap = new Map(state.projectData);
      newMap.set(projectId, { documents, meetings, ideas });
      return { projectData: newMap };
    });
  },

  toggleProject: (projectId) => {
    set((state) => {
      const next = new Set(state.expandedProjects);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        // Load data on first expand
        if (!state.projectData.has(projectId)) {
          get().loadProjectData(projectId);
        }
      }
      return { expandedProjects: next };
    });
  },

  setActiveDocument: (doc) => {
    set({
      activeItem: { type: 'document', id: doc.id },
      activeDocument: doc,
      activeMeeting: null,
      activeIdea: null,
    });
  },

  setActiveMeeting: (meeting) => {
    set({
      activeItem: { type: 'meeting', id: meeting.id },
      activeDocument: null,
      activeMeeting: meeting,
      activeIdea: null,
    });
  },

  setActiveIdea: (idea) => {
    set({
      activeItem: { type: 'idea', id: idea.id },
      activeDocument: null,
      activeMeeting: null,
      activeIdea: idea,
    });
  },

  clearActive: () => {
    set({ activeItem: null, activeDocument: null, activeMeeting: null, activeIdea: null });
  },

  createDocument: async (dto) => {
    const doc = await documentsApi.create(dto);
    // Reload project data
    await get().loadProjectData(dto.project_id ?? null);
    return doc;
  },

  updateDocument: async (id, dto) => {
    set({ saving: true });
    const updated = await documentsApi.update(id, dto);
    set({ saving: false, lastSaved: new Date().toISOString(), activeDocument: updated });
    // Reload if project changed
    const projId = dto.project_id !== undefined ? dto.project_id : get().activeDocument?.project_id ?? null;
    await get().loadProjectData(projId);
  },

  deleteDocument: async (id) => {
    const doc = get().activeDocument;
    await documentsApi.delete(id);
    if (get().activeItem?.id === id) get().clearActive();
    if (doc) await get().loadProjectData(doc.project_id);
  },

  setSaving: (saving) => set({ saving }),
  setLastSaved: (ts) => set({ lastSaved: ts }),
}));

export type { Meeting as SidebarMeeting, Idea as SidebarIdea };
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/store/documents.store.ts
git commit -m "feat: add documents Zustand store with sidebar + editor state"
```

---

## Task 6: Tiptap Editor + Toolbar

**Files:**
- Create: `apps/web/src/components/documents/EditorToolbar.tsx`
- Create: `apps/web/src/components/documents/TiptapEditor.tsx`

- [ ] **Step 1: Create EditorToolbar.tsx**

Create `apps/web/src/components/documents/EditorToolbar.tsx`:

```tsx
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, Quote, Code2, Minus, Link2, Undo2, Redo2,
} from 'lucide-react';

interface Props {
  editor: Editor | null;
}

function Btn({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors cursor-pointer ${
        active
          ? 'bg-indigo-600/20 text-indigo-400'
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-5 bg-gray-700 mx-1" />;
}

export function EditorToolbar({ editor }: Props) {
  if (!editor) return null;

  const addLink = () => {
    const url = window.prompt('URL:');
    if (!url) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-700/50 bg-gray-800/50 flex-wrap">
      <Btn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)">
        <Bold size={16} />
      </Btn>
      <Btn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)">
        <Italic size={16} />
      </Btn>
      <Btn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
        <Strikethrough size={16} />
      </Btn>
      <Sep />
      <Btn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
        <Heading1 size={16} />
      </Btn>
      <Btn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
        <Heading2 size={16} />
      </Btn>
      <Btn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
        <Heading3 size={16} />
      </Btn>
      <Sep />
      <Btn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">
        <List size={16} />
      </Btn>
      <Btn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List">
        <ListOrdered size={16} />
      </Btn>
      <Btn active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Checklist">
        <CheckSquare size={16} />
      </Btn>
      <Sep />
      <Btn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote">
        <Quote size={16} />
      </Btn>
      <Btn active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code Block">
        <Code2 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
        <Minus size={16} />
      </Btn>
      <Sep />
      <Btn active={editor.isActive('link')} onClick={addLink} title="Link (Ctrl+K)">
        <Link2 size={16} />
      </Btn>
      <Sep />
      <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo (Ctrl+Z)">
        <Undo2 size={16} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={16} />
      </Btn>
    </div>
  );
}
```

- [ ] **Step 2: Create TiptapEditor.tsx**

Create `apps/web/src/components/documents/TiptapEditor.tsx`:

```tsx
import { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorToolbar } from './EditorToolbar';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';

interface Props {
  documentId: number;
  initialContent: string;
  title: string;
  onTitleChange: (title: string) => void;
}

export function TiptapEditor({ documentId, initialContent, title, onTitleChange }: Props) {
  const { t } = useLangStore();
  const { updateDocument, setSaving, setLastSaved } = useDocumentsStore();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docIdRef = useRef(documentId);

  // Track current doc ID to prevent stale saves
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

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Link.configure({
          openOnClick: true,
          HTMLAttributes: { class: 'text-indigo-400 underline hover:text-indigo-300 cursor-pointer' },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({
          placeholder: t('Начните писать...', 'Start writing...'),
        }),
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[400px] px-8 py-4',
        },
      },
      onUpdate: ({ editor: ed }) => {
        saveContent(ed.getHTML());
      },
    },
    [documentId],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Title */}
      <input
        className="text-2xl font-bold bg-transparent text-gray-100 px-8 pt-6 pb-2 focus:outline-none placeholder-gray-600 w-full"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={t('Без названия', 'Untitled')}
      />

      {/* Toolbar */}
      <EditorToolbar editor={editor} />

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/documents/EditorToolbar.tsx apps/web/src/components/documents/TiptapEditor.tsx
git commit -m "feat: add Tiptap editor with toolbar, autosave, and markdown shortcuts"
```

---

## Task 7: Breadcrumbs component

**Files:**
- Create: `apps/web/src/components/documents/Breadcrumbs.tsx`

- [ ] **Step 1: Create Breadcrumbs.tsx**

Create `apps/web/src/components/documents/Breadcrumbs.tsx`:

```tsx
import { ChevronRight } from 'lucide-react';
import { useDocumentsStore } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import type { Project } from '@pis/shared';

interface Props {
  project: Project | null;
  saving: boolean;
  lastSaved: string | null;
}

export function Breadcrumbs({ project, saving, lastSaved }: Props) {
  const { t } = useLangStore();
  const { activeItem, activeDocument, activeMeeting, activeIdea } = useDocumentsStore();

  if (!activeItem) return null;

  const crumbs: string[] = [];
  if (project) crumbs.push(project.name);
  else crumbs.push(t('Без проекта', 'No project'));

  if (activeDocument) {
    // TODO: if parent_id, show parent chain — for now just the doc title
    crumbs.push(activeDocument.title);
  } else if (activeMeeting) {
    crumbs.push(t('Встречи', 'Meetings'));
    crumbs.push(activeMeeting.title);
  } else if (activeIdea) {
    crumbs.push(t('Идеи', 'Ideas'));
    crumbs.push(activeIdea.title);
  }

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-400 border-b border-gray-700/50 bg-gray-800/30">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={12} className="text-gray-600" />}
          <span className={i === crumbs.length - 1 ? 'text-gray-200' : ''}>{c}</span>
        </span>
      ))}
      <span className="ml-auto text-[10px] text-gray-500">
        {saving ? t('Сохранение...', 'Saving...') : lastSaved ? t('Сохранено', 'Saved') : ''}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/documents/Breadcrumbs.tsx
git commit -m "feat: add breadcrumbs with save status indicator"
```

---

## Task 8: Readonly views for meetings and ideas

**Files:**
- Create: `apps/web/src/components/documents/MeetingReadonly.tsx`
- Create: `apps/web/src/components/documents/IdeaReadonly.tsx`

- [ ] **Step 1: Create MeetingReadonly.tsx**

Create `apps/web/src/components/documents/MeetingReadonly.tsx`:

```tsx
import { Calendar, Users } from 'lucide-react';
import type { SidebarMeeting } from '../../store/documents.store';
import { useLangStore } from '../../store/lang.store';
import { useEffect, useState } from 'react';
import { apiGet } from '../../api/client';

interface Person {
  id: number;
  name: string;
}

interface Agreement {
  id: number;
  description: string;
  status: string;
  due_date: string | null;
  person_id: number | null;
}

interface Props {
  meeting: SidebarMeeting;
}

export function MeetingReadonly({ meeting }: Props) {
  const { t } = useLangStore();
  const [people, setPeople] = useState<Person[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);

  useEffect(() => {
    apiGet<Person[]>(`/meetings/${meeting.id}/people`).then(setPeople).catch(() => {});
    apiGet<Agreement[]>(`/meetings/${meeting.id}/agreements`).then(setAgreements).catch(() => {});
  }, [meeting.id]);

  return (
    <div className="px-8 py-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-100 mb-4">{meeting.title}</h1>

      <div className="flex items-center gap-4 text-sm text-gray-400 mb-6">
        <span className="flex items-center gap-1.5">
          <Calendar size={14} />
          {meeting.date}
        </span>
        {people.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Users size={14} />
            {people.map((p) => p.name).join(', ')}
          </span>
        )}
      </div>

      {meeting.summary_structured && (
        <div className="prose prose-invert prose-sm max-w-none mb-6">
          <div dangerouslySetInnerHTML={{ __html: meeting.summary_structured }} />
        </div>
      )}

      {!meeting.summary_structured && meeting.summary_raw && (
        <div className="text-sm text-gray-300 whitespace-pre-wrap mb-6">{meeting.summary_raw}</div>
      )}

      {agreements.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('Договорённости', 'Agreements')}</h3>
          <ul className="space-y-2">
            {agreements.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                  a.status === 'done' ? 'bg-green-600/20 border-green-600 text-green-400' : 'border-gray-600'
                }`}>
                  {a.status === 'done' && '✓'}
                </span>
                <span className={a.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-300'}>
                  {a.description}
                  {a.due_date && <span className="text-gray-500 ml-2">· {a.due_date}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create IdeaReadonly.tsx**

Create `apps/web/src/components/documents/IdeaReadonly.tsx`:

```tsx
import { Lightbulb } from 'lucide-react';
import type { SidebarIdea } from '../../store/documents.store';

const CAT_COLORS: Record<string, string> = {
  business: 'bg-blue-600/20 text-blue-400',
  product: 'bg-purple-600/20 text-purple-400',
  personal: 'bg-emerald-600/20 text-emerald-400',
  growth: 'bg-amber-600/20 text-amber-400',
};

interface Props {
  idea: SidebarIdea;
}

export function IdeaReadonly({ idea }: Props) {
  return (
    <div className="px-8 py-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center">
          <Lightbulb size={16} className="text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold text-gray-100">{idea.title}</h1>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${CAT_COLORS[idea.category] ?? 'bg-gray-600/20 text-gray-400'}`}>
          {idea.category}
        </span>
        <span className="text-xs px-2.5 py-1 rounded-full bg-gray-700/50 text-gray-400">
          {idea.status}
        </span>
      </div>

      {idea.body && (
        <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
          {idea.body}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/documents/MeetingReadonly.tsx apps/web/src/components/documents/IdeaReadonly.tsx
git commit -m "feat: add read-only views for meetings and ideas in editor area"
```

---

## Task 9: Sidebar — project tree

**Files:**
- Create: `apps/web/src/components/documents/DocumentTreeItem.tsx`
- Create: `apps/web/src/components/documents/ProjectTreeItem.tsx`
- Create: `apps/web/src/components/documents/DocumentsSidebar.tsx`

- [ ] **Step 1: Create DocumentTreeItem.tsx**

Create `apps/web/src/components/documents/DocumentTreeItem.tsx`:

```tsx
import { useState } from 'react';
import { FileText, ChevronRight } from 'lucide-react';
import type { DocumentNode } from '../../api/documents.api';
import { useDocumentsStore } from '../../store/documents.store';

interface Props {
  doc: DocumentNode;
  depth: number;
}

export function DocumentTreeItem({ doc, depth }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { activeItem, setActiveDocument } = useDocumentsStore();
  const isActive = activeItem?.type === 'document' && activeItem.id === doc.id;
  const hasChildren = doc.children && doc.children.length > 0;

  return (
    <div>
      <button
        onClick={() => setActiveDocument(doc)}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left text-sm transition-colors cursor-pointer group ${
          isActive
            ? 'bg-indigo-600/20 text-indigo-300'
            : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="p-0.5 cursor-pointer"
          >
            <ChevronRight
              size={12}
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span className="w-4" />
        )}
        <FileText size={14} className="flex-shrink-0 opacity-60" />
        <span className="truncate">{doc.title}</span>
      </button>
      {expanded && hasChildren && (
        <div>
          {doc.children!.map((child) => (
            <DocumentTreeItem key={(child as DocumentNode).id} doc={child as DocumentNode} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ProjectTreeItem.tsx**

Create `apps/web/src/components/documents/ProjectTreeItem.tsx`:

```tsx
import { ChevronRight, Calendar, Lightbulb } from 'lucide-react';
import type { Project } from '@pis/shared';
import { useDocumentsStore } from '../../store/documents.store';
import { DocumentTreeItem } from './DocumentTreeItem';
import { useLangStore } from '../../store/lang.store';
import { useState } from 'react';

interface Props {
  project: Project | null;
}

export function ProjectTreeItem({ project }: Props) {
  const { t } = useLangStore();
  const {
    expandedProjects, toggleProject, projectData,
    activeItem, setActiveMeeting, setActiveIdea,
  } = useDocumentsStore();
  const projectId = project?.id ?? null;
  const isExpanded = expandedProjects.has(projectId);
  const data = projectData.get(projectId);

  const [meetingsCollapsed, setMeetingsCollapsed] = useState(false);
  const [ideasCollapsed, setIdeasCollapsed] = useState(false);

  return (
    <div className="mb-1">
      {/* Project header */}
      <button
        onClick={() => toggleProject(projectId)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-gray-700/50 transition-colors cursor-pointer"
      >
        <ChevronRight
          size={14}
          className={`text-gray-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: project?.color ?? '#9ca3af' }}
        />
        <span className="text-sm font-medium text-gray-200 truncate">
          {project?.name ?? t('Без проекта', 'No project')}
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && data && (
        <div className="ml-2 mt-0.5">
          {/* Documents section */}
          {data.documents.length > 0 && (
            <div className="mb-1">
              <div className="text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium">
                {t('Документы', 'Documents')}
              </div>
              {data.documents.map((doc) => (
                <DocumentTreeItem key={doc.id} doc={doc} depth={0} />
              ))}
            </div>
          )}

          {/* Meetings section */}
          {data.meetings.length > 0 && (
            <div className="mb-1">
              <button
                onClick={() => setMeetingsCollapsed(!meetingsCollapsed)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium cursor-pointer hover:text-gray-400"
              >
                <ChevronRight size={10} className={`transition-transform ${!meetingsCollapsed ? 'rotate-90' : ''}`} />
                {t('Встречи', 'Meetings')} ({data.meetings.length})
              </button>
              {!meetingsCollapsed && data.meetings.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setActiveMeeting(m)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left text-sm transition-colors cursor-pointer ${
                    activeItem?.type === 'meeting' && activeItem.id === m.id
                      ? 'bg-indigo-600/20 text-indigo-300'
                      : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                  }`}
                  style={{ paddingLeft: '24px' }}
                >
                  <Calendar size={13} className="flex-shrink-0 opacity-60" />
                  <span className="truncate flex-1">{m.title}</span>
                  <span className="text-[10px] text-gray-600 flex-shrink-0">
                    {m.date.split('T')[0]?.slice(5)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Ideas section */}
          {data.ideas.length > 0 && (
            <div className="mb-1">
              <button
                onClick={() => setIdeasCollapsed(!ideasCollapsed)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-600 px-2 py-1 font-medium cursor-pointer hover:text-gray-400"
              >
                <ChevronRight size={10} className={`transition-transform ${!ideasCollapsed ? 'rotate-90' : ''}`} />
                {t('Идеи', 'Ideas')} ({data.ideas.length})
              </button>
              {!ideasCollapsed && data.ideas.map((idea) => (
                <button
                  key={idea.id}
                  onClick={() => setActiveIdea(idea)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left text-sm transition-colors cursor-pointer ${
                    activeItem?.type === 'idea' && activeItem.id === idea.id
                      ? 'bg-indigo-600/20 text-indigo-300'
                      : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                  }`}
                  style={{ paddingLeft: '24px' }}
                >
                  <Lightbulb size={13} className="flex-shrink-0 opacity-60" />
                  <span className="truncate">{idea.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {data.documents.length === 0 && data.meetings.length === 0 && data.ideas.length === 0 && (
            <div className="text-xs text-gray-600 px-4 py-2">{t('Пусто', 'Empty')}</div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create DocumentsSidebar.tsx**

Create `apps/web/src/components/documents/DocumentsSidebar.tsx`:

```tsx
import { useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useProjectsStore } from '../../store';
import { useDocumentsStore } from '../../store/documents.store';
import { ProjectTreeItem } from './ProjectTreeItem';
import { useLangStore } from '../../store/lang.store';

export function DocumentsSidebar() {
  const { t } = useLangStore();
  const { projects, fetchProjects } = useProjectsStore();
  const { createDocument, setActiveDocument, expandedProjects } = useDocumentsStore();
  const activeProjects = projects.filter((p) => !p.archived);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleNewDoc = async () => {
    // Create in first expanded project, or without project
    const expandedArr = Array.from(expandedProjects);
    const projectId = expandedArr.length > 0 ? expandedArr[0] : null;
    const doc = await createDocument({ title: t('Новый документ', 'New document'), project_id: projectId });
    setActiveDocument(doc);
  };

  return (
    <div className="w-[280px] min-w-[280px] bg-gray-800/50 border-r border-gray-700/50 flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-gray-700/50">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {t('Проекты', 'Projects')}
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-1 py-2">
        {activeProjects.map((p) => (
          <ProjectTreeItem key={p.id} project={p} />
        ))}
        <ProjectTreeItem project={null} />
      </div>

      {/* New document button */}
      <div className="p-2 border-t border-gray-700/50">
        <button
          onClick={handleNewDoc}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors cursor-pointer"
        >
          <Plus size={16} />
          {t('Новый документ', 'New document')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/documents/DocumentTreeItem.tsx apps/web/src/components/documents/ProjectTreeItem.tsx apps/web/src/components/documents/DocumentsSidebar.tsx
git commit -m "feat: add sidebar with project tree, document nesting, meetings, ideas"
```

---

## Task 10: Main page — NotionDocumentsPage

**Files:**
- Create: `apps/web/src/pages/NotionDocumentsPage.tsx`
- Modify: `apps/web/src/App.tsx` (line ~280: swap route)

- [ ] **Step 1: Create NotionDocumentsPage.tsx**

Create `apps/web/src/pages/NotionDocumentsPage.tsx`:

```tsx
import { useCallback, useRef } from 'react';
import { DocumentsSidebar } from '../components/documents/DocumentsSidebar';
import { TiptapEditor } from '../components/documents/TiptapEditor';
import { Breadcrumbs } from '../components/documents/Breadcrumbs';
import { MeetingReadonly } from '../components/documents/MeetingReadonly';
import { IdeaReadonly } from '../components/documents/IdeaReadonly';
import { useDocumentsStore } from '../store/documents.store';
import { useProjectsStore } from '../store';
import { useLangStore } from '../store/lang.store';
import { FileText } from 'lucide-react';

export function NotionDocumentsPage() {
  const { t } = useLangStore();
  const { projects } = useProjectsStore();
  const {
    activeItem, activeDocument, activeMeeting, activeIdea,
    saving, lastSaved, updateDocument,
  } = useDocumentsStore();

  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!activeDocument) return;
      // Update local state immediately via store
      useDocumentsStore.setState((state) => ({
        activeDocument: state.activeDocument ? { ...state.activeDocument, title } : null,
      }));
      // Debounce save
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        updateDocument(activeDocument.id, { title });
      }, 2000);
    },
    [activeDocument, updateDocument],
  );

  const activeProject = activeDocument
    ? projects.find((p) => p.id === activeDocument.project_id) ?? null
    : activeMeeting
      ? projects.find((p) => p.id === activeMeeting.project_id) ?? null
      : activeIdea
        ? projects.find((p) => p.id === activeIdea.project_id) ?? null
        : null;

  return (
    <div className="relative flex h-full overflow-hidden bg-gray-900">
      {/* Background spheres — PIS style */}
      <div className="pointer-events-none absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-indigo-400/[0.08]" style={{ animation: 'circleLeft 30s cubic-bezier(0.45,0,0.55,1) infinite' }} />
      <div className="pointer-events-none absolute bottom-20 -left-40 w-[500px] h-[500px] rounded-full bg-violet-400/[0.06] blur-[80px]" style={{ animation: 'circleRight 34s cubic-bezier(0.45,0,0.55,1) infinite' }} />

      {/* Sidebar */}
      <DocumentsSidebar />

      {/* Editor area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {activeItem ? (
          <>
            <Breadcrumbs project={activeProject} saving={saving} lastSaved={lastSaved} />

            {activeItem.type === 'document' && activeDocument && (
              <TiptapEditor
                key={activeDocument.id}
                documentId={activeDocument.id}
                initialContent={activeDocument.body}
                title={activeDocument.title}
                onTitleChange={handleTitleChange}
              />
            )}

            {activeItem.type === 'meeting' && activeMeeting && (
              <MeetingReadonly meeting={activeMeeting} />
            )}

            {activeItem.type === 'idea' && activeIdea && (
              <IdeaReadonly idea={activeIdea} />
            )}
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center mx-auto mb-4">
                <FileText size={28} className="text-gray-500" />
              </div>
              <p className="text-gray-500 text-sm">
                {t('Выберите документ или создайте новый', 'Select a document or create a new one')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx route**

In `apps/web/src/App.tsx`, add the import at the top (near other page imports):

```typescript
import { NotionDocumentsPage } from './pages/NotionDocumentsPage';
```

Then find the line (around line 280):
```typescript
<Route path="/documents" element={<AnimatedPage><DocumentsPage /></AnimatedPage>} />
```

Replace with:
```typescript
<Route path="/documents" element={<AnimatedPage><NotionDocumentsPage /></AnimatedPage>} />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/NotionDocumentsPage.tsx apps/web/src/App.tsx
git commit -m "feat: add NotionDocumentsPage with sidebar + editor layout, wire to /documents route"
```

---

## Task 11: Add Tiptap editor styles

**Files:**
- Modify: `apps/web/src/index.css` (or global styles file)

- [ ] **Step 1: Find the global CSS file**

```bash
ls /c/Users/smolentsev/.claude/NewProject/Kanban/apps/web/src/index.css
```

- [ ] **Step 2: Add Tiptap styles**

Add these styles at the end of the CSS file:

```css
/* Tiptap editor styles */
.tiptap {
  outline: none;
}

.tiptap h1 { font-size: 1.75rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.75rem; color: #f1f5f9; }
.tiptap h2 { font-size: 1.35rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.5rem; color: #e2e8f0; }
.tiptap h3 { font-size: 1.1rem; font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem; color: #cbd5e1; }
.tiptap p { margin-bottom: 0.5rem; color: #cbd5e1; line-height: 1.7; }
.tiptap ul, .tiptap ol { padding-left: 1.5rem; margin-bottom: 0.5rem; color: #cbd5e1; }
.tiptap li { margin-bottom: 0.25rem; }
.tiptap blockquote { border-left: 3px solid #6366f1; padding-left: 1rem; margin: 0.75rem 0; color: #94a3b8; font-style: italic; }
.tiptap pre { background: #1e293b; border-radius: 0.5rem; padding: 1rem; margin: 0.75rem 0; overflow-x: auto; }
.tiptap code { font-family: 'JetBrains Mono', monospace; font-size: 0.85em; }
.tiptap hr { border: none; border-top: 1px solid #334155; margin: 1.5rem 0; }
.tiptap a { color: #818cf8; text-decoration: underline; }
.tiptap a:hover { color: #a5b4fc; }

/* Task list (checkboxes) */
.tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0; }
.tiptap ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; }
.tiptap ul[data-type="taskList"] li label { margin-top: 0.15rem; }
.tiptap ul[data-type="taskList"] li label input[type="checkbox"] {
  appearance: none; width: 1rem; height: 1rem; border: 2px solid #6366f1; border-radius: 0.25rem;
  cursor: pointer; background: transparent; position: relative;
}
.tiptap ul[data-type="taskList"] li label input[type="checkbox"]:checked {
  background: #6366f1;
}
.tiptap ul[data-type="taskList"] li label input[type="checkbox"]:checked::after {
  content: '✓'; position: absolute; top: -2px; left: 1px; color: white; font-size: 0.7rem;
}
.tiptap ul[data-type="taskList"] li[data-checked="true"] > div > p { text-decoration: line-through; color: #64748b; }

/* Placeholder */
.tiptap p.is-editor-empty:first-child::before {
  color: #475569; content: attr(data-placeholder); float: left; height: 0; pointer-events: none;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/index.css
git commit -m "style: add Tiptap editor dark theme styles with task lists and placeholder"
```

---

## Task 12: Obsidian sync service — writeDocument method

**Files:**
- Modify: `packages/api/src/services/obsidian.service.ts` (add writeDocument method)

- [ ] **Step 1: Add writeDocument to ObsidianService**

Open `packages/api/src/services/obsidian.service.ts`. Add this interface before the class (after line 58):

```typescript
interface WriteDocumentParams {
  title: string;
  body: string;
  category: string;
  status: string;
  project?: string;
  parentTitle?: string;
  people?: string[];
  tags?: string[];
}
```

Add this method inside the `ObsidianService` class (before the `writeInboxItem` method, around line 220):

```typescript
  async writeDocument(params: WriteDocumentParams): Promise<string> {
    const filename = `${this.toSlug(params.title)}.md`;
    let dir: string;
    let relativeParts: string[];

    if (params.project) {
      if (params.parentTitle) {
        dir = this.userPath('Projects', params.project, params.parentTitle);
        relativeParts = ['Projects', params.project, params.parentTitle, filename];
      } else {
        dir = this.userPath('Projects', params.project);
        relativeParts = ['Projects', params.project, filename];
      }
    } else {
      dir = this.userPath('Materials');
      relativeParts = ['Materials', filename];
    }
    this.ensureDir(dir);

    const people = (params.people ?? []).map((p) => this.wikiLink(p));
    const tags = params.tags ?? [];
    if (params.project) tags.push(`project/${params.project}`);

    const frontmatter = [
      '---',
      'type: document',
      `title: "${params.title}"`,
      `category: ${params.category}`,
      `status: ${params.status}`,
      `project: ${this.wikiOrNull(params.project)}`,
      `people: [${people.join(', ')}]`,
      `tags: [${tags.join(', ')}]`,
      `created_at: ${this.now()}`,
      `modified_at: ${this.now()}`,
      '---',
    ].join('\n');

    fs.writeFileSync(path.join(dir, filename), `${frontmatter}\n\n${params.body}\n`, 'utf-8');
    return this.userRelative(...relativeParts);
  }
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/services/obsidian.service.ts
git commit -m "feat: add writeDocument method to ObsidianService with frontmatter"
```

---

## Task 13: Bidirectional Obsidian sync service

**Files:**
- Create: `packages/api/src/services/obsidian-sync.service.ts`

- [ ] **Step 1: Create obsidian-sync.service.ts**

Create `packages/api/src/services/obsidian-sync.service.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import matter from 'gray-matter';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { getDb } from '../db/db';
import { config } from '../config';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Add task list support to turndown
turndown.addRule('taskListItem', {
  filter: (node) => {
    return node.nodeName === 'LI' && node.parentElement?.getAttribute('data-type') === 'taskList';
  },
  replacement: (content, node) => {
    const checked = (node as Element).getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.trim()}\n`;
  },
});

/** Convert HTML (from Tiptap) to Markdown for Obsidian */
export function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return '';
  return turndown.turndown(html).trim();
}

/** Convert Markdown (from Obsidian) to HTML for Tiptap */
export function markdownToHtml(md: string): string {
  if (!md) return '';
  return marked.parse(md, { async: false }) as string;
}

/** Sync a document from PIS to Obsidian vault */
export function syncDocToVault(docId: number, userId: number | null): void {
  const doc = getDb().prepare('SELECT * FROM documents WHERE id = ?').get(docId) as Record<string, unknown> | undefined;
  if (!doc) return;

  const title = doc['title'] as string;
  const body = doc['body'] as string;
  const category = doc['category'] as string;
  const status = doc['status'] as string;
  const projectId = doc['project_id'] as number | null;
  const parentId = doc['parent_id'] as number | null;

  // Get project name
  let projectName: string | undefined;
  if (projectId) {
    const proj = getDb().prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string } | undefined;
    projectName = proj?.name;
  }

  // Get parent doc title for nested path
  let parentTitle: string | undefined;
  if (parentId) {
    const parent = getDb().prepare('SELECT title FROM documents WHERE id = ?').get(parentId) as { title: string } | undefined;
    parentTitle = parent?.title;
  }

  // Build file path
  const userPrefix = userId ? `user_${userId}` : '';
  const slug = title.replace(/[<>:"/\\|?*]/g, '').trim();
  const filename = `${slug}.md`;

  let relParts: string[];
  if (projectName) {
    if (parentTitle) {
      const parentSlug = parentTitle.replace(/[<>:"/\\|?*]/g, '').trim();
      relParts = [userPrefix, 'Projects', projectName, parentSlug, filename].filter(Boolean);
    } else {
      relParts = [userPrefix, 'Projects', projectName, filename].filter(Boolean);
    }
  } else {
    relParts = [userPrefix, 'Materials', filename].filter(Boolean);
  }

  const fullDir = path.join(config.vaultPath, ...relParts.slice(0, -1));
  if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });

  // Convert HTML to Markdown
  const mdBody = htmlToMarkdown(body);

  // Build frontmatter
  const fm: Record<string, unknown> = {
    type: 'document',
    title,
    category,
    status,
    project: projectName ?? null,
    created_at: doc['created_at'],
    modified_at: new Date().toISOString(),
  };

  const content = matter.stringify(`\n${mdBody}\n`, fm);
  const fullPath = path.join(config.vaultPath, ...relParts);
  fs.writeFileSync(fullPath, content, 'utf-8');

  // Update vault_path in DB
  const vaultPath = relParts.join('/');
  getDb().prepare('UPDATE documents SET vault_path = ? WHERE id = ?').run(vaultPath, docId);
  console.log(`[obsidian-sync] PIS→Vault: doc #${docId} → ${vaultPath}`);
}

/** Sync a file from Obsidian vault to PIS */
export function syncVaultToDoc(filePath: string, userId: number | null): void {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data: fm, content } = matter(raw);

  // Only handle document types
  if (fm.type && fm.type !== 'document') return;

  const title = (fm.title as string) ?? path.basename(filePath, '.md');
  const htmlBody = markdownToHtml(content.trim());

  // Find by vault_path
  const vaultRelative = path.relative(config.vaultPath, filePath).replace(/\\/g, '/');
  const existing = getDb().prepare('SELECT id FROM documents WHERE vault_path = ?').get(vaultRelative) as { id: number } | undefined;

  if (existing) {
    getDb().prepare('UPDATE documents SET title = ?, body = ?, updated_at = ? WHERE id = ?')
      .run(title, htmlBody, new Date().toISOString(), existing.id);
    console.log(`[obsidian-sync] Vault→PIS: updated doc #${existing.id}`);
  } else {
    // Create new document
    const category = (fm.category as string) ?? 'note';
    const projectName = fm.project as string | null;
    let projectId: number | null = null;
    if (projectName) {
      const proj = getDb().prepare('SELECT id FROM projects WHERE name = ?').get(projectName) as { id: number } | undefined;
      projectId = proj?.id ?? null;
    }
    const result = getDb()
      .prepare('INSERT INTO documents (title, body, project_id, category, vault_path, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(title, htmlBody, projectId, category, vaultRelative, userId);
    console.log(`[obsidian-sync] Vault→PIS: created doc #${result.lastInsertRowid}`);
  }
}

/** Start file watcher for bidirectional sync */
export function startVaultWatcher(userId: number | null): chokidar.FSWatcher | null {
  const watchDir = userId
    ? path.join(config.vaultPath, `user_${userId}`, 'Projects')
    : path.join(config.vaultPath, 'Projects');

  if (!fs.existsSync(watchDir)) {
    fs.mkdirSync(watchDir, { recursive: true });
  }

  // Debounce per-file
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = chokidar.watch(watchDir, {
    ignored: /(^|[/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
  });

  watcher.on('change', (filePath) => {
    if (!filePath.endsWith('.md')) return;
    const existing = debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        try { syncVaultToDoc(filePath, userId); } catch (err) {
          console.warn('[obsidian-sync] watcher error:', err);
        }
      }, 1000),
    );
  });

  watcher.on('add', (filePath) => {
    if (!filePath.endsWith('.md')) return;
    setTimeout(() => {
      try { syncVaultToDoc(filePath, userId); } catch (err) {
        console.warn('[obsidian-sync] watcher add error:', err);
      }
    }, 1500);
  });

  console.log(`[obsidian-sync] watching ${watchDir}`);
  return watcher;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/services/obsidian-sync.service.ts
git commit -m "feat: bidirectional Obsidian sync with frontmatter, chokidar watcher, HTML↔MD conversion"
```

---

## Task 14: Wire sync into documents route

**Files:**
- Modify: `packages/api/src/routes/documents.ts` (add sync call on save)

- [ ] **Step 1: Import sync service**

At the top of `packages/api/src/routes/documents.ts`, add after the existing imports (line 12):

```typescript
import { syncDocToVault } from '../services/obsidian-sync.service';
```

- [ ] **Step 2: Add sync on document update**

In the PATCH handler, after the line `res.json(ok(updatedDoc));` (line 121), insert sync logic. Replace the entire Obsidian sync block (lines 89-119) with:

```typescript
  // Sync to Obsidian vault
  if (updatedDoc) {
    const docStatus = updatedDoc['status'] as string;
    if (docStatus === 'in_obsidian' || docStatus === 'active') {
      try {
        syncDocToVault(docId, userId);
      } catch (err) {
        console.warn('[documents] vault sync failed:', err);
      }
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/documents.ts
git commit -m "feat: auto-sync documents to Obsidian vault on save"
```

---

## Task 15: Start vault watcher on server boot

**Files:**
- Modify: `packages/api/src/index.ts` (or main server file)

- [ ] **Step 1: Find the server entry file**

```bash
grep -l "app.listen" /c/Users/smolentsev/.claude/NewProject/Kanban/packages/api/src/*.ts
```

- [ ] **Step 2: Import and start watcher**

In the server entry file, add after existing imports:

```typescript
import { startVaultWatcher } from './services/obsidian-sync.service';
```

Then after the `app.listen(...)` call, add:

```typescript
// Start Obsidian vault watcher for bidirectional sync
startVaultWatcher(null);
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat: start Obsidian vault watcher on server boot"
```

---

## Task 16: Test end-to-end

- [ ] **Step 1: Start dev server**

```bash
cd /c/Users/smolentsev/.claude/NewProject/Kanban && pnpm dev
```

- [ ] **Step 2: Open browser and verify**

Open `http://localhost:5173/documents` and verify:
1. Sidebar shows projects with chevron expand
2. Expand a project → documents, meetings, ideas load
3. Click document → opens in Tiptap editor
4. Type text → toolbar works (bold, italic, headings, lists, checkboxes, links)
5. Autosave works (2s debounce, "Saved" indicator)
6. Click meeting → opens read-only summary
7. Click idea → opens read-only view
8. "+ New document" creates and opens a blank doc
9. Breadcrumbs show correct path

- [ ] **Step 3: Test Obsidian sync**

1. Create a document in a project
2. Check vault folder — .md file created with frontmatter
3. Edit the .md in Obsidian (or text editor)
4. Verify changes reflect in PIS on next load

- [ ] **Step 4: Fix any issues found**

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Notion-like Documents page — complete implementation"
```
