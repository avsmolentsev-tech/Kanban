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
