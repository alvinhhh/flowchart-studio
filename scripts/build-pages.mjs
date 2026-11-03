import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
process.exit(result.status ?? 1);
