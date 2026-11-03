import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const result = spawnSync(process.execPath, [next, 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    FLOWCHART_STATIC_EXPORT: '1',
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'https://flowchart.lol',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_METRICS_ENABLED: process.env.NEXT_PUBLIC_METRICS_ENABLED || '1',
  },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

await build({
  stdin: {
    contents: "export { default } from './src/worker/sharing.ts';",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: fileURLToPath(new URL('../out/_worker.js', import.meta.url)),
});
await writeFile(new URL('../out/_routes.json', import.meta.url), JSON.stringify({
  version: 1,
  include: ['/api/shares*', '/api/metrics', '/api/stats'],
  exclude: [],
}, null, 2) + '\n');
