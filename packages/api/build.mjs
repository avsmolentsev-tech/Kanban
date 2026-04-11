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

// Copy SQL files
function copySql(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) copySql(p);
    else if (f.endsWith('.sql')) {
      const dest = join('dist', relative('src', p));
      const destDir = dirname(dest);
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      copyFileSync(p, dest);
    }
  }
}
copySql('src');

console.log(`Built ${entryPoints.length} files to dist/`);
