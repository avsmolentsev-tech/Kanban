export interface DiffInfo {
  files: string[];
  totalChanges: number;
}

export type DiffClass =
  | { kind: 'small' }
  | { kind: 'large'; reason: string };

const BLACKLIST_PATTERNS = [
  /(^|\/)auth[^/]*$/,
  /(^|\/)user-scope[^/]*$/,
  /(^|\/)db\/schema[^/]*$/,
  /(^|\/)migrations\//,
  /(^|\/)\.env($|\.)/,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)package\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
];

export function classifyDiff(info: DiffInfo): DiffClass {
  if (info.files.length > 3) return { kind: 'large', reason: `too many files (${info.files.length})` };
  if (info.totalChanges > 200) return { kind: 'large', reason: `too many lines (${info.totalChanges})` };
  for (const f of info.files) {
    for (const pat of BLACKLIST_PATTERNS) {
      if (pat.test(f)) return { kind: 'large', reason: `blacklist: ${f}` };
    }
  }
  return { kind: 'small' };
}
