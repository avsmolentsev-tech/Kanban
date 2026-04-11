import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useHotkeys() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'n': // New task — focus on add
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('hotkey-new-task'));
          break;
        case '/': // Search
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('hotkey-search'));
          break;
        case '1': navigate('/'); break;
        case '2': navigate('/timeline'); break;
        case '3': navigate('/projects'); break;
        case '4': navigate('/meetings'); break;
        case '5': navigate('/habits'); break;
        case '?': // Show shortcuts help
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('hotkey-help'));
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
