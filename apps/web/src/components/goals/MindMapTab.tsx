import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { nodeTypes } from './MindMapNode';
import { apiGet, apiPost } from '../../api/client';
import { Plus } from 'lucide-react';

interface MindMapNodeData {
  id: string;
  type: string;
  label: string;
  progress: number;
  status: string;
  due_date?: string;
  parent?: string;
}

interface MindMapEdgeData {
  source: string;
  target: string;
}

interface MindMapData {
  bhag: { id: number; title: string; progress: number };
  nodes: MindMapNodeData[];
  edges: MindMapEdgeData[];
}

function layoutGraph(data: MindMapData): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'RL', ranksep: 120, nodesep: 50 });

  for (const n of data.nodes) {
    const w = n.type === 'bhag' ? 280 : 220;
    const h = n.type === 'bhag' ? 90 : 60;
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of data.edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const nodes: Node[] = data.nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: n.type,
      position: { x: (pos?.x ?? 0) - (n.type === 'bhag' ? 140 : 110), y: pos?.y ?? 0 },
      data: { label: n.label, nodeType: n.type, progress: n.progress, status: n.status, due_date: n.due_date },
    };
  });
  const edges: Edge[] = data.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    style: { stroke: '#94a3b8', strokeWidth: 2 },
    animated: false,
  }));
  return { nodes, edges };
}

interface Props {
  bhagId: number | null;
  bhags: Array<{ id: number; title: string }>;
  onCreateBhag: () => void;
}

export function MindMapTab({ bhagId, bhags, onCreateBhag }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [loading, setLoading] = useState(false);
  const [selectedBhag, setSelectedBhag] = useState<number | null>(bhagId);

  const fetchMindmap = useCallback(async (id: number, applyLayout = false) => {
    setLoading(true);
    try {
      const data = await apiGet<MindMapData>(`/goals/${id}/mindmap`);
      if (applyLayout) {
        const { nodes: n, edges: e } = layoutGraph(data);
        setNodes(n);
        setEdges(e);
      } else {
        // Refresh data only, keep positions
        setNodes(prev => {
          const updatedMap = new Map(data.nodes.map(n => [n.id, n]));
          return prev.map(node => {
            const upd = updatedMap.get(node.id);
            if (upd) {
              return { ...node, data: { label: upd.label, nodeType: upd.type, progress: upd.progress, status: upd.status, due_date: upd.due_date } };
            }
            return node;
          });
        });
      }
    } catch (err) {
      console.error('Failed to fetch mindmap', err);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  // Auto-select latest BHAG when list updates
  useEffect(() => {
    if (!selectedBhag && bhags.length > 0) {
      setSelectedBhag(bhags[0]!.id);
    }
  }, [bhags, selectedBhag]);

  // Initial load with layout
  useEffect(() => {
    if (selectedBhag) fetchMindmap(selectedBhag, true);
  }, [selectedBhag]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 30s (data only, preserve positions)
  useEffect(() => {
    if (!selectedBhag) return;
    const interval = setInterval(() => fetchMindmap(selectedBhag, false), 30000);
    return () => clearInterval(interval);
  }, [selectedBhag, fetchMindmap]);

  const handleDecompose = async () => {
    if (!selectedBhag) return;
    setLoading(true);
    try {
      await apiPost(`/goals/${selectedBhag}/decompose`, {});
      await fetchMindmap(selectedBhag, true);
    } finally {
      setLoading(false);
    }
  };

  if (bhags.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-gray-500 dark:text-gray-400">
        <p className="text-lg mb-4">Нет BHAG. Создай большую цель на год!</p>
        <button onClick={onCreateBhag} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          <Plus size={18} /> Новая BHAG
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-200px)] w-full">
      {/* BHAG selector + actions */}
      <div className="flex items-center gap-3 mb-3">
        <select
          className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white border-gray-300"
          value={selectedBhag ?? ''}
          onChange={(e) => setSelectedBhag(Number(e.target.value) || null)}
        >
          {bhags.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
        <button onClick={handleDecompose} disabled={loading || !selectedBhag}
          className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
          {loading ? 'AI декомпозирует...' : 'Декомпозировать'}
        </button>
        <button onClick={onCreateBhag} className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-700 dark:text-white">
          <Plus size={14} className="inline mr-1" /> Новая BHAG
        </button>
      </div>

      {/* React Flow */}
      <div className="h-full border rounded-xl border-gray-200 dark:border-gray-700 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-left"
          className="bg-gray-50 dark:bg-gray-900"
        >
          <Background color="#94a3b8" gap={20} size={1} />
          <Controls className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-600 !shadow-lg" />
          <MiniMap nodeColor={(n) => {
            const p = (n.data as Record<string, unknown>)?.progress as number ?? 0;
            if (p === 100) return '#22c55e';
            if (p > 0) return '#eab308';
            return '#6b7280';
          }} className="!bg-white dark:!bg-gray-800 !border-gray-200 dark:!border-gray-600" />
        </ReactFlow>
      </div>
    </div>
  );
}
