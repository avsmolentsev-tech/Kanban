import { useState, useEffect } from 'react';
import { FileText, ChevronRight, Trash2 } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import type { DocumentNode } from '../../api/documents.api';
import { useDocumentsStore } from '../../store/documents.store';

interface Props {
  doc: DocumentNode;
  depth: number;
}

export function DocumentTreeItem({ doc, depth }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { activeItem, setActiveDocument, deleteDocument } = useDocumentsStore();

  // Auto-expand if active document is a child of this document
  useEffect(() => {
    if (!doc.children?.length) return;
    const isChildActive = (children: unknown[]): boolean =>
      children.some((c) => {
        const child = c as DocumentNode;
        return (activeItem?.type === 'document' && activeItem.id === child.id) ||
          (child.children?.length && isChildActive(child.children));
      });
    if (isChildActive(doc.children)) setExpanded(true);
  }, [activeItem, doc.children]);
  const isActive = activeItem?.type === 'document' && activeItem.id === doc.id;
  const hasChildren = doc.children && doc.children.length > 0;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: `doc-drag-${doc.id}` });

  return (
    <div>
      <button
        ref={setDragRef}
        {...attributes}
        {...listeners}
        data-drag-label={`doc-drag-${doc.id}`}
        onClick={() => setActiveDocument(doc)}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-left text-sm transition-colors cursor-pointer group ${
          isActive
            ? 'bg-indigo-600/20 text-indigo-300'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px`, opacity: isDragging ? 0.4 : 1 }}
      >
        {hasChildren ? (
          <span
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="p-0.5 cursor-pointer"
          >
            <ChevronRight
              size={12}
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </span>
        ) : (
          <span className="w-4" />
        )}
        <FileText size={14} className="flex-shrink-0 opacity-60" />
        <span className="truncate">{doc.title}</span>
        <Trash2
          size={12}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all ml-auto"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Удалить документ?')) deleteDocument(doc.id);
          }}
        />
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
