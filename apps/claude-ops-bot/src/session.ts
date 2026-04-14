import type { Target } from './project-resolver.js';

export interface Session {
  tgId: number;
  activeTarget?: Target;
  model: 'sonnet' | 'opus';
  lastActivityTs: number;
  claudeProcess?: unknown;
  pendingUserAnswer: boolean;
}

export interface SessionManagerOpts {
  timeoutMs: number;
  defaultModel: 'sonnet' | 'opus';
}

export class SessionManager {
  private sessions = new Map<number, Session>();
  private timers = new Map<number, NodeJS.Timeout>();

  constructor(private readonly opts: SessionManagerOpts) {}

  get(tgId: number): Session {
    let s = this.sessions.get(tgId);
    if (!s) {
      s = {
        tgId,
        model: this.opts.defaultModel,
        lastActivityTs: Date.now(),
        pendingUserAnswer: false,
      };
      this.sessions.set(tgId, s);
    }
    return s;
  }

  has(tgId: number): boolean {
    return this.sessions.has(tgId);
  }

  touch(tgId: number): void {
    const s = this.sessions.get(tgId);
    if (!s) return;
    s.lastActivityTs = Date.now();
    const prev = this.timers.get(tgId);
    if (prev) clearTimeout(prev);
    this.timers.set(tgId, setTimeout(() => this.end(tgId), this.opts.timeoutMs));
  }

  end(tgId: number): void {
    const prev = this.timers.get(tgId);
    if (prev) clearTimeout(prev);
    this.timers.delete(tgId);
    this.sessions.delete(tgId);
  }

  all(): Session[] {
    return [...this.sessions.values()];
  }
}
