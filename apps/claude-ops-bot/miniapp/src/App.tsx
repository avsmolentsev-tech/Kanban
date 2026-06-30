import { useState } from 'react';
import WebApp from '@twa-dev/sdk';
import { TaskList } from './pages/TaskList';
import { TaskDetail } from './pages/TaskDetail';
import { DiffView } from './pages/DiffView';
import './index.css';

WebApp.ready();

type Page = { type: 'list' } | { type: 'detail'; taskId: number } | { type: 'diff'; taskId: number };

export default function App() {
  const [page, setPage] = useState<Page>({ type: 'list' });

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      {page.type === 'list' && (
        <TaskList onSelect={(id) => setPage({ type: 'detail', taskId: id })} />
      )}
      {page.type === 'detail' && (
        <TaskDetail
          taskId={page.taskId}
          onBack={() => setPage({ type: 'list' })}
          onDiff={() => setPage({ type: 'diff', taskId: page.taskId })}
        />
      )}
      {page.type === 'diff' && (
        <DiffView
          taskId={page.taskId}
          onBack={() => setPage({ type: 'detail', taskId: page.taskId })}
        />
      )}
    </div>
  );
}
