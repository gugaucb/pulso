import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts', 'server/torLauncher.ts'],
  outdir: 'dist/server',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
});
