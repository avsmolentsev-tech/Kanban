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
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
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
