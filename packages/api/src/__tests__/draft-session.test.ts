import { DraftSession } from '../services/draft-session';
import type { DraftCard, ExtractionResult } from '@pis/shared';

jest.useFakeTimers();

const makeResult = (): ExtractionResult => ({
  detected_type: 'meeting',
  title: 'Test',
  date: '2026-04-16',
  project_hints: ['Roboty'],
  company_hints: ['Keenon'],
  people: ['Maksim'],
  tags_hierarchical: ['type/meeting', 'project/roboty'],
  tags_free: ['test'],
  summary: 'sum',
  agreements: 0,
  tasks: [],
});

test('create returns a DraftCard with canonical tags merged', () => {
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: () => {} });
  const card = s.create(42, 2, makeResult(), 'voice', 'transcript', null);
  expect(card.type).toBe('meeting');
  expect(card.tgId).toBe(42);
  expect(card.userId).toBe(2);
  expect(card.tags).toEqual(['type/meeting', 'project/roboty', 'test']);
  expect(card.awaitingEdit).toBe(false);
});

test('get and update mutate the same draft', () => {
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: () => {} });
  const card = s.create(42, 2, makeResult(), 'voice', 't', null);
  s.update(42, { title: 'New title', awaitingEdit: true });
  expect(s.get(42)?.title).toBe('New title');
  expect(s.get(42)?.awaitingEdit).toBe(true);
});

test('timeout triggers onTimeout with the draft', () => {
  const timeouts: DraftCard[] = [];
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: (c) => timeouts.push(c) });
  s.create(42, 2, makeResult(), 'voice', 't', null);
  jest.advanceTimersByTime(1500);
  expect(timeouts).toHaveLength(1);
  expect(s.get(42)).toBeUndefined();
});

test('close removes draft and cancels timeout', () => {
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: () => { throw new Error('should not fire'); } });
  s.create(42, 2, makeResult(), 'voice', 't', null);
  s.close(42);
  jest.advanceTimersByTime(2000);
  expect(s.get(42)).toBeUndefined();
});

test('create second draft for same tgId auto-closes the previous one', () => {
  const closed: DraftCard[] = [];
  const s = new DraftSession({ timeoutMs: 1000, onTimeout: (c) => closed.push(c) });
  s.create(42, 2, makeResult(), 'voice', 'first', null);
  s.create(42, 2, makeResult(), 'voice', 'second', null);
  expect(closed).toHaveLength(1);
  expect(s.get(42)?.transcript).toBe('second');
});
