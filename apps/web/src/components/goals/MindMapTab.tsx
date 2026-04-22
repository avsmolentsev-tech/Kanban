import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { nodeTypes } from './MindMapNode';
import { NodeDetailPanel } from './NodeDetailPanel';
import { apiGet, apiPost } from '../../api/client';
import { Plus } from 'lucide-react';

type SelectedNodeData = { id: string; type: string; label: string; status: string; progress: number; due_date?: string };

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
  edgeType?: string;
}

interface MindMapData {
  bhag: { id: number; title: string; progress: number };
  nodes: MindMapNodeData[];
  edges: MindMapEdgeData[];
}

function layoutGraph(data: MindMapData, onAddChild?: (nodeId: string, nodeType: string) => void): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'RL', ranksep: 160, nodesep: 60 });

  for (const n of data.nodes) {
    const w = n.type === 'bhag' ? 340 : 260;
    const h = n.type === 'bhag' ? 100 : 75;
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
      data: { label: n.label, nodeType: n.type, progress: n.progress, status: n.status, due_date: n.due_date, nodeId: n.id, onAddChild },
    };
  });
  const edges: Edge[] = data.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    style: e.edgeType === 'dependency'
      ? { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '5,5' }
      : { stroke: '#94a3b8', strokeWidth: 2 },
    animated: e.edgeType === 'dependency',
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
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<SelectedNodeData | null>(null);

  const handleAddChildRef = { current: null as null | ((nodeId: string, nodeType: string) => void) };

  const fetchMindmap = useCallback(async (id: number, applyLayout = false) => {
    setLoading(true);
    try {
      const data = await apiGet<MindMapData>(`/goals/${id}/mindmap`);
      if (applyLayout) {
        const { nodes: n, edges: e } = layoutGraph(data, handleAddChildRef.current ?? undefined);
        setNodes(n);
        setEdges(e);
      } else {
        // Refresh data only, keep positions
        const addChildFn = handleAddChildRef.current ?? undefined;
        setNodes(prev => {
          const updatedMap = new Map(data.nodes.map(n => [n.id, n]));
          // Add new nodes that weren't in previous set
          const existingIds = new Set(prev.map(n => n.id));
          const newNodes: Node[] = [];
          for (const n of data.nodes) {
            if (!existingIds.has(n.id)) {
              newNodes.push({
                id: n.id,
                type: n.type,
                position: { x: 0, y: 0 },
                data: { label: n.label, nodeType: n.type, progress: n.progress, status: n.status, due_date: n.due_date, nodeId: n.id, onAddChild: addChildFn },
              });
            }
          }
          const updated = prev.map(node => {
            const upd = updatedMap.get(node.id);
            if (upd) {
              return { ...node, data: { label: upd.label, nodeType: upd.type, progress: upd.progress, status: upd.status, due_date: upd.due_date, nodeId: upd.id, onAddChild: addChildFn } };
            }
            return node;
          });
          return [...updated, ...newNodes];
        });
      }
    } catch (err) {
      console.error('Failed to fetch mindmap', err);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Escape to exit fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleAddChild = useCallback(async (parentNodeId: string, _parentType: string) => {
    const [pType, pIdStr] = parentNodeId.split('-');
    const parentId = Number(pIdStr);

    // Auto-detect project from parent
    let projectId: number | null = null;
    try {
      if (pType === 'goal') {
        const goal = await apiGet<Record<string, unknown>>(`/goals/${parentId}`);
        projectId = (goal as Record<string, unknown>)?.project_id as number | null ?? null;
      } else if (pType === 'task') {
        const task = await apiGet<Record<string, unknown>>(`/tasks/${parentId}`);
        projectId = (task as Record<string, unknown>)?.project_id as number | null ?? null;
      }
    } catch { /* ignore */ }

    try {
      let resp: Record<string, unknown> | undefined;
      const body: Record<string, unknown> = { title: 'Новая задача', status: 'todo', priority: 3, project_id: projectId };
      if (pType === 'goal') {
        body.goal_id = parentId;
        resp = await apiPost<Record<string, unknown>>('/tasks', body);
      } else if (pType === 'task') {
        body.parent_id = parentId;
        resp = await apiPost<Record<string, unknown>>('/tasks', body);
      }
      if (selectedBhag) await fetchMindmap(selectedBhag, true);
      // Auto-select the new task for editing
      if (resp?.id) {
        setSelectedNode({ id: `task-${resp.id}`, type: 'task', label: 'Новая задача', status: 'todo', progress: 0, due_date: undefined });
      }
    } catch { /* ignore */ }
  }, [selectedBhag, fetchMindmap]);

  handleAddChildRef.current = handleAddChild;

  const handleConnect = useCallback(async (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    // Only allow task-to-task connections
    if (!connection.source.startsWith('task-') || !connection.target.startsWith('task-')) return;
    const fromId = Number(connection.source.split('-')[1]);
    const toId = Number(connection.target.split('-')[1]);

    try {
      await apiPost(`/tasks/${toId}/dependencies`, { depends_on_id: fromId });
      setEdges(prev => addEdge({ ...connection, style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '5,5' }, animated: true }, prev));
    } catch { /* ignore */ }
  }, [setEdges]);

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

  const toolbar = (
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
      <button onClick={onCreateBhag} className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white">
        <Plus size={14} className="inline mr-1" /> Новая BHAG
      </button>
      <button onClick={() => setFullscreen(!fullscreen)} className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white">
        {fullscreen ? '\u2199 \u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c' : '\u26F6 \u041d\u0430 \u0432\u0435\u0441\u044c \u044d\u043a\u0440\u0430\u043d'}
      </button>
    </div>
  );

  const flowContent = (
    <div className="flex-1 border rounded-xl border-gray-200 dark:border-gray-700 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        connectionLineStyle={{ stroke: '#f59e0b' }}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => setSelectedNode({
          id: node.id,
          type: (node.data as Record<string, unknown>).nodeType as string,
          label: (node.data as Record<string, unknown>).label as string,
          status: (node.data as Record<string, unknown>).status as string,
          progress: (node.data as Record<string, unknown>).progress as number,
          due_date: (node.data as Record<string, unknown>).due_date as string | undefined,
        })}
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
  );

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-white dark:bg-gray-900 flex flex-col p-4' : 'h-[calc(100vh-200px)] w-full flex flex-col'}>
      {toolbar}
      {flowContent}
      <NodeDetailPanel
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onRefresh={() => { if (selectedBhag) fetchMindmap(selectedBhag, true); }}
      />
    </div>
  );
}
