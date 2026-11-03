import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const result = spawnSync(process.execPath, [next, 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    FLOWCHART_STATIC_EXPORT: '1',
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || 'https://flowchart.lol',
    NEXT_TELEMETRY_DISABLED: '1',
  },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const worker = await readFile(new URL('../src/worker/sharing.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(worker, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
// Test helpers remain named exports in source; the deployed worker exposes only its handler.
await writeFile(new URL('../out/_worker.js', import.meta.url), compiled.outputText.replace(/^export (?!default\b)/gm, ''));
await writeFile(new URL('../out/_routes.json', import.meta.url), JSON.stringify({
  version: 1,
  include: ['/api/shares*'],
  exclude: [],
}, null, 2) + '\n');
