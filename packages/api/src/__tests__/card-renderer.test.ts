import { renderDraftCard, parseCallbackData, encodeCallbackData, inlineKeyboard } from '../services/card-renderer';
import type { DraftCard } from '@pis/shared';

const card: DraftCard = {
  id: 'abc',
  userId: 2, tgId: 42, createdAt: 0, updatedAt: 0,
  type: 'meeting', title: 'Test', date: '2026-04-16',
  projectName: 'Roboty', companyName: 'Keenon',
  people: ['Maksim'],
  tags: ['type/meeting', 'project/roboty', 'company/keenon', 'прототип'],
  summary: 'Summary', transcript: 'x',
  sourceKind: 'voice', sourceLocalPath: null,
  awaitingEdit: false, cardMessageId: null,
};

test('renderDraftCard emits all fields', () => {
  const txt = renderDraftCard(card);
  expect(txt).toMatch(/Тип:.*встреча/);
  expect(txt).toMatch(/Название: Test/);
  expect(txt).toMatch(/Проект: Roboty/);
  expect(txt).toMatch(/Компания: Keenon/);
  expect(txt).toMatch(/Люди: Maksim/);
  expect(txt).toMatch(/#type\/meeting.*#project\/roboty.*#company\/keenon.*#прототип/);
});

test('encodeCallbackData and parseCallbackData are inverse', () => {
  const s = encodeCallbackData('abc', 'ok');
  const { draftId, action } = parseCallbackData(s)!;
  expect(draftId).toBe('abc');
  expect(action).toBe('ok');
});

test('parseCallbackData returns null on malformed input', () => {
  expect(parseCallbackData('bogus')).toBeNull();
  expect(parseCallbackData('draft:')).toBeNull();
});

test('inlineKeyboard includes primary + type-change rows', () => {
  const kb = inlineKeyboard(card);
  expect(kb.inline_keyboard).toHaveLength(2);
  expect(kb.inline_keyboard[0].map((b: any) => b.text)).toEqual(['✅ OK', '✏️ Исправить', '❌ Отменить']);
  expect(kb.inline_keyboard[1].map((b: any) => b.text)).toEqual(['🤝 Это встреча', '📋 Это задача', '💡 Это идея']);
});
