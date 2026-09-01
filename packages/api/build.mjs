import { build } from 'esbuild';
import { readdirSync, statSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';

// Collect all .ts files from src/
function collectTs(dir, files = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) collectTs(p, files);
    else if (f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.spec.ts')) files.push(p);
  }
  return files;
}

const entryPoints = collectTs('src');

await build({
  entryPoints,
  outdir: 'dist',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  outbase: 'src',
});

// Copy non-.ts assets (SQL migrations, OpenAPI spec) that esbuild doesn't touch —
// without this, files present in src/ silently don't exist in dist/ at runtime.
function copyByExt(dir, extensions) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) copyByExt(p, extensions);
    else if (extensions.some((ext) => f.endsWith(ext))) {
      const dest = join('dist', relative('src', p));
      const destDir = dirname(dest);
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      copyFileSync(p, dest);
    }
  }
}
copyByExt('src', ['.sql', '.yaml', '.yml']);

console.log(`Built ${entryPoints.length} files to dist/`);
