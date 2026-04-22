import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Target, CheckCircle2, Circle, Clock, Users } from 'lucide-react';

interface MindMapNodeData {
  label: string;
  nodeType: 'bhag' | 'milestone' | 'task' | 'meeting';
  progress: number;
  status: string;
  due_date?: string;
  onAddChild?: (nodeId: string, nodeType: string) => void;
  nodeId?: string;
}

const statusColor: Record<string, string> = {
  done: '#22c55e',
  in_progress: '#eab308',
  not_started: '#6b7280',
  todo: '#6b7280',
  backlog: '#6b7280',
};

const typeIcon = {
  bhag: Target,
  milestone: Clock,
  task: CheckCircle2,
  meeting: Users,
};

function MindMapNodeComponent({ data }: NodeProps) {
  const d = data as unknown as MindMapNodeData;
  const color = statusColor[d.status] ?? '#6b7280';
  const Icon = typeIcon[d.nodeType] ?? Circle;
  const isBhag = d.nodeType === 'bhag';

  return (
    <div
      className={`group relative rounded-xl border-2 px-4 py-2 bg-white dark:bg-gray-800 shadow-md transition-all hover:shadow-lg ${isBhag ? 'min-w-[260px]' : 'min-w-[190px]'}`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Right} className="!bg-gray-400 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Icon size={isBhag ? 20 : 16} style={{ color }} />
        <span className={`${isBhag ? 'font-bold text-sm' : 'text-xs'} text-gray-900 dark:text-white truncate max-w-[220px]`}>
          {d.label}
        </span>
      </div>
      {(d.nodeType === 'bhag' || d.nodeType === 'milestone') && (
        <div className="mt-1">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${d.progress}%`, backgroundColor: color }} />
          </div>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">{d.progress}%</span>
        </div>
      )}
      {d.due_date && (
        <div className="text-[10px] text-gray-400 mt-0.5">{d.due_date}</div>
      )}
      {/* Add child button - visible on hover */}
      {(d.nodeType === 'bhag' || d.nodeType === 'milestone' || d.nodeType === 'task') && d.onAddChild && (
        <button
          onClick={(e) => { e.stopPropagation(); d.onAddChild!(d.nodeId!, d.nodeType); }}
          className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-indigo-600 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-indigo-700"
          title="Добавить задачу"
        >
          +
        </button>
      )}
      <Handle type="source" position={Position.Left} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
}

export const MindMapNode = memo(MindMapNodeComponent);
export const nodeTypes = { bhag: MindMapNode, milestone: MindMapNode, task: MindMapNode, meeting: MindMapNode };
