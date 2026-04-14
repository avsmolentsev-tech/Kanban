import { classifyDiff } from '../src/git-safety.js';

test('empty diff is small', () => {
  expect(classifyDiff({ files: [], totalChanges: 0 }).kind).toBe('small');
});

test('3 files, 100 lines, non-sensitive — small', () => {
  expect(classifyDiff({
    files: ['apps/web/src/App.tsx', 'apps/web/src/components/X.tsx', 'apps/web/src/components/Y.tsx'],
    totalChanges: 100,
  }).kind).toBe('small');
});

test('4 files — large', () => {
  expect(classifyDiff({
    files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
    totalChanges: 10,
  }).kind).toBe('large');
});

test('201 lines — large', () => {
  expect(classifyDiff({ files: ['a.ts'], totalChanges: 201 }).kind).toBe('large');
});

test('touches auth file — large', () => {
  const res = classifyDiff({ files: ['packages/api/src/middleware/auth.ts'], totalChanges: 1 });
  expect(res.kind).toBe('large');
  if (res.kind === 'large') expect(res.reason).toMatch(/blacklist/);
});

test('touches .env — large', () => {
  expect(classifyDiff({ files: ['.env'], totalChanges: 1 }).kind).toBe('large');
});

test('touches package.json — large', () => {
  expect(classifyDiff({ files: ['package.json'], totalChanges: 1 }).kind).toBe('large');
});
