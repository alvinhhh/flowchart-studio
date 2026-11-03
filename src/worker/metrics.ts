export const EVENT_TTL_MS = 48 * 60 * 60 * 1000;
export const MAX_METRIC_BYTES = 256;

export interface DatabaseResult<T = Record<string, unknown>> { results: T[] }
export interface DatabaseStatement {
  bind(...values: (string | number | null)[]): DatabaseStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  run(): Promise<unknown>;
}
export interface MetricsDatabase {
  prepare(sql: string): DatabaseStatement;
  batch(statements: DatabaseStatement[]): Promise<unknown[]>;
}
export interface MetricsEnvironment {
  METRICS?: MetricsDatabase;
  SITE_ORIGIN?: string;
}
export interface WorkerExecutionContext { waitUntil(promise: Promise<unknown>): void }
export interface PublicStats {
  startedAt: string;
  visitors: number;
  chartsCreated: number;
  chartsShared: number;
}

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
};
function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...headers, ...extra } });
}

class TooLarge extends Error {}
async function readEvent(request: Request): Promise<unknown> {
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_METRIC_BYTES)) throw new TooLarge();
  if (!request.body) throw new SyntaxError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_METRIC_BYTES) {
        void reader.cancel().catch(() => {});
        throw new TooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

async function recordEvent(request: Request, env: MetricsEnvironment): Promise<Response> {
  const origin = env.SITE_ORIGIN ?? 'https://flowchart.lol';
  if (new URL(request.url).origin !== origin || request.headers.get('Origin') !== origin) {
    return json({ error: 'This request must come from this site.' }, 403);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'Send a JSON request.' }, 415);
  }
  let value: unknown;
  try { value = await readEvent(request); }
  catch (error) { return json({ error: error instanceof TooLarge ? 'The request is too large.' : 'The event is invalid.' }, error instanceof TooLarge ? 413 : 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: 'The event is invalid.' }, 400);
  const event = value as Record<string, unknown>;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  if (Object.keys(event).sort().join(',') !== 'day,id,type'
    || (event.type !== 'visit' && event.type !== 'chart_created')
    || typeof event.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id)
    || (event.day !== today && event.day !== yesterday)) return json({ error: 'The event is invalid.' }, 400);
  if (!env.METRICS) return json({ error: 'Statistics are unavailable.' }, 503);
  try {
    // The insert and trigger run as one atomic SQLite statement. Replays do not run the trigger.
    await env.METRICS.batch([
      expiredReceipts(env.METRICS, now),
      env.METRICS.prepare('INSERT OR IGNORE INTO metric_events (id, type, day, expires_at) VALUES (?, ?, ?, ?)')
        .bind(event.id.toLowerCase(), event.type, event.day, now + EVENT_TTL_MS),
    ]);
    return new Response(null, { status: 204, headers });
  } catch { return json({ error: 'Statistics are unavailable.' }, 503); }
}

// Cleanup is bounded and runs on writes. Inactive receipts are logically expired
// after 48 hours and physically removed on subsequent activity.
function expiredReceipts(db: MetricsDatabase, now: number): DatabaseStatement {
  return db.prepare('DELETE FROM metric_events WHERE id IN (SELECT id FROM metric_events WHERE expires_at <= ? ORDER BY expires_at LIMIT 500)').bind(now);
}

export async function countSharedChart(env: MetricsEnvironment): Promise<void> {
  if (!env.METRICS) return;
  await env.METRICS.batch([
    expiredReceipts(env.METRICS, Date.now()),
    env.METRICS.prepare('UPDATE metrics SET charts_shared = charts_shared + 1 WHERE id = 1'),
  ]);
}

export async function readStats(db: MetricsDatabase): Promise<PublicStats> {
  const totals = await db.prepare('SELECT started_at, visitors, charts_created, charts_shared FROM metrics WHERE id = 1')
    .first<{ started_at: string; visitors: number; charts_created: number; charts_shared: number }>();
  if (!totals) throw new Error('Metrics not initialized');
  return { startedAt: totals.started_at, visitors: totals.visitors, chartsCreated: totals.charts_created, chartsShared: totals.charts_shared };
}

export async function handleMetricsRequest(request: Request, env: MetricsEnvironment): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === '/api/metrics') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
    return recordEvent(request, env);
  }
  if (path === '/api/stats') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
    if (!env.METRICS) return json({ error: 'Statistics are unavailable.' }, 503);
    try { return json(await readStats(env.METRICS), 200, { 'Cache-Control': 'public, max-age=60, s-maxage=60' }); }
    catch { return json({ error: 'Statistics are unavailable.' }, 503); }
  }
  if (path.startsWith('/api/metrics') || path.startsWith('/api/stats')) return json({ error: 'Not found.' }, 404);
  return null;
}
