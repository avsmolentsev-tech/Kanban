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
      className={`group relative rounded-xl border-2 px-4 py-3 bg-white dark:bg-gray-800 shadow-md transition-all hover:shadow-lg ${isBhag ? 'min-w-[300px] max-w-[360px]' : 'min-w-[240px] max-w-[300px]'}`}
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Right} className="!bg-indigo-400 !w-4 !h-4 !border-2 !border-white dark:!border-gray-800 hover:!bg-indigo-600 !transition-colors" />
      <div className="flex items-start gap-2">
        <Icon size={isBhag ? 22 : 18} style={{ color, flexShrink: 0, marginTop: 2 }} />
        <span className={`${isBhag ? 'font-bold text-base leading-tight' : 'text-sm leading-tight'} text-gray-900 dark:text-white`}>
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
      <Handle type="source" position={Position.Left} className="!bg-indigo-400 !w-4 !h-4 !border-2 !border-white dark:!border-gray-800 hover:!bg-indigo-600 !transition-colors" />
    </div>
  );
}

export const MindMapNode = memo(MindMapNodeComponent);
export const nodeTypes = { bhag: MindMapNode, milestone: MindMapNode, task: MindMapNode, meeting: MindMapNode };
