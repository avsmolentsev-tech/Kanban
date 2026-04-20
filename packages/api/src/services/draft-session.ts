import type { DraftCard, DraftType, ExtractionResult } from '@pis/shared';
import { randomUUID } from 'node:crypto';

export interface DraftSessionOpts {
  timeoutMs: number;
  onTimeout: (draft: DraftCard) => void;
}

export class DraftSession {
  private drafts = new Map<number, DraftCard>();
  private timers = new Map<number, NodeJS.Timeout>();

  constructor(private readonly opts: DraftSessionOpts) {}

  create(
    tgId: number,
    userId: number,
    extraction: ExtractionResult,
    sourceKind: DraftCard['sourceKind'],
    transcript: string,
    sourceLocalPath: string | null,
  ): DraftCard {
    const existing = this.drafts.get(tgId);
    if (existing) {
      this.clearTimer(tgId);
      this.opts.onTimeout(existing);
      this.drafts.delete(tgId);
    }
    const now = Date.now();
    const card: DraftCard = {
      id: randomUUID(),
      userId,
      tgId,
      createdAt: now,
      updatedAt: now,
      type: extraction.detected_type,
      title: extraction.title,
      date: extraction.date,
      projectName: extraction.project_hints[0] ?? null,
      companyName: extraction.company_hints[0] ?? null,
      people: extraction.people,
      tags: [...extraction.tags_hierarchical, ...extraction.tags_free],
      summary: extraction.summary,
      transcript,
      sourceKind,
      sourceLocalPath,
      awaitingEdit: false,
      cardMessageId: null,
    };
    this.drafts.set(tgId, card);
    this.armTimer(tgId);
    return card;
  }

  get(tgId: number): DraftCard | undefined {
    return this.drafts.get(tgId);
  }

  update(tgId: number, patch: Partial<DraftCard>): DraftCard | undefined {
    const c = this.drafts.get(tgId);
    if (!c) return undefined;
    Object.assign(c, patch, { updatedAt: Date.now() });
    this.clearTimer(tgId);
    this.armTimer(tgId);
    return c;
  }

  close(tgId: number): void {
    this.clearTimer(tgId);
    this.drafts.delete(tgId);
  }

  flushAll(): DraftCard[] {
    return [...this.drafts.values()];
  }

  private armTimer(tgId: number): void {
    this.timers.set(tgId, setTimeout(() => {
      const c = this.drafts.get(tgId);
      if (!c) return;
      this.drafts.delete(tgId);
      this.timers.delete(tgId);
      this.opts.onTimeout(c);
    }, this.opts.timeoutMs));
  }

  private clearTimer(tgId: number): void {
    const t = this.timers.get(tgId);
    if (t) clearTimeout(t);
    this.timers.delete(tgId);
  }
}
