// Bundles the MV3 service worker and the two content scripts.
// They must be self-contained classic scripts (IIFE), so they get their own
// esbuild pass instead of going through the Vite/Rollup pipeline.
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  absWorkingDir: root,
  entryPoints: {
    background: 'src/background/index.ts',
    'bridge.isolated': 'src/content/bridge.isolated.ts',
    'interceptor.main': 'src/content/interceptor.main.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome111'],
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build-scripts] watching…');
} else {
  await build(options);
}
