import { describe, it, expect } from 'vitest';
import { TaskStateMachine } from './task-manager.js';

describe('TaskStateMachine', () => {
  it('allows CREATED → PLANNING', () => {
    expect(TaskStateMachine.canTransition('CREATED', 'PLANNING')).toBe(true);
  });

  it('blocks CREATED → RUNNING', () => {
    expect(TaskStateMachine.canTransition('CREATED', 'RUNNING')).toBe(false);
  });

  it('allows PLAN_GATE → RUNNING (approve)', () => {
    expect(TaskStateMachine.canTransition('PLAN_GATE', 'RUNNING')).toBe(true);
  });

  it('allows PLAN_GATE → REJECTED (cancel)', () => {
    expect(TaskStateMachine.canTransition('PLAN_GATE', 'REJECTED')).toBe(true);
  });

  it('allows PLAN_GATE → PLANNING (re-plan)', () => {
    expect(TaskStateMachine.canTransition('PLAN_GATE', 'PLANNING')).toBe(true);
  });

  it('allows VERIFYING → DONE', () => {
    expect(TaskStateMachine.canTransition('VERIFYING', 'DONE')).toBe(true);
  });

  it('allows VERIFYING → FAILED', () => {
    expect(TaskStateMachine.canTransition('VERIFYING', 'FAILED')).toBe(true);
  });

  it('allows FAILED → RUNNING (retry)', () => {
    expect(TaskStateMachine.canTransition('FAILED', 'RUNNING')).toBe(true);
  });

  it('blocks DONE → anything', () => {
    expect(TaskStateMachine.canTransition('DONE', 'RUNNING')).toBe(false);
    expect(TaskStateMachine.canTransition('DONE', 'CREATED')).toBe(false);
  });

  it('blocks REJECTED → anything', () => {
    expect(TaskStateMachine.canTransition('REJECTED', 'RUNNING')).toBe(false);
  });
});
