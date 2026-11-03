import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countSharedChart, EVENT_TTL_MS, handleMetricsRequest, readStats } from './metrics';
import { testDatabase } from './test-database';

const origin = 'https://flowchart.lol';
const now = Date.parse('2026-11-03T12:00:00.000Z');
let db: ReturnType<typeof testDatabase>;
function event(type = 'visit', extra: Record<string, unknown> = {}) {
  return { type, id: crypto.randomUUID(), day: '2026-11-03', ...extra };
}
function post(value: unknown = event(), options: RequestInit = {}, site = origin) {
  return new Request(`${site}/api/metrics`, {
    method: 'POST', headers: { Origin: site, 'Content-Type': 'application/json' },
    body: JSON.stringify(value), ...options,
  });
}
async function submit(value: unknown = event()) { return handleMetricsRequest(post(value), { METRICS: db }); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  db = testDatabase();
});
afterEach(() => { db.close(); vi.useRealTimers(); });

describe('aggregate statistics', () => {
  it('returns only all-time counters and their measurement start, including empty counters', async () => {
    const response = await handleMetricsRequest(new Request(`${origin}/api/stats`), { METRICS: db });
    expect(response!.status).toBe(200);
    expect(await response!.json()).toEqual({ startedAt: expect.any(String), visitors: 0, chartsCreated: 0, chartsShared: 0 });
    expect(response!.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60');
    await submit(event('visit', { day: '2026-11-02' }));
    await submit(event());
    await submit(event('chart_created'));
    await countSharedChart({ METRICS: db });
    expect(await readStats(db)).toMatchObject({ visitors: 2, chartsCreated: 1, chartsShared: 1 });
    vi.setSystemTime(now + 86_400_000);
    expect(await readStats(db)).toMatchObject({ visitors: 2 });
  });

  it('deduplicates concurrent retry deliveries atomically without retaining supplied identities or content', async () => {
    const visit = event();
    const created = event('chart_created');
    const responses = await Promise.all(Array.from({ length: 20 }, () => Promise.all([submit(visit), submit(created)])));
    expect(responses.flat().every(response => response!.status === 204)).toBe(true);
    expect(await readStats(db)).toMatchObject({ visitors: 1, chartsCreated: 1 });
    expect(db.sqlite.prepare('SELECT * FROM metric_events ORDER BY type').all()).toEqual([
      { ...created, expires_at: now + EVENT_TTL_MS }, { ...visit, expires_at: now + EVENT_TTL_MS },
    ]);
    // The UUID itself is the receipt key, so changing event type/day cannot replay it.
    expect((await submit({ ...visit, type: 'chart_created', day: '2026-11-02' }))!.status).toBe(204);
    expect(await readStats(db)).toMatchObject({ visitors: 1, chartsCreated: 1 });
  });

  it('normalizes UUID case so alternate casing cannot increment twice', async () => {
    const value = event();
    await submit(value);
    await submit({ ...value, id: value.id.toUpperCase() });
    expect(await readStats(db)).toMatchObject({ visitors: 1 });
  });

  it('rolls back the receipt when the aggregate update fails, allowing a retry', async () => {
    db.sqlite.exec("CREATE TRIGGER fail_count BEFORE UPDATE ON metrics BEGIN SELECT RAISE(ABORT, 'private error'); END");
    const value = event();
    const response = await submit(value);
    expect(response!.status).toBe(503);
    expect(await response!.text()).not.toContain('private error');
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM metric_events').get()).toEqual({ n: 0 });
    db.sqlite.exec('DROP TRIGGER fail_count');
    await submit(value);
    expect(await readStats(db)).toMatchObject({ visitors: 1 });
  });

  it('bounds cleanup to 500 expired receipts per write while retaining aggregate totals', async () => {
    const insert = db.sqlite.prepare('INSERT INTO metric_events (id, type, day, expires_at) VALUES (?, ?, ?, ?)');
    for (let index = 0; index < 501; index++) insert.run(crypto.randomUUID(), 'visit', '2026-10-31', now - 1);
    const current = event();
    await submit(current);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM metric_events').get()).toEqual({ n: 2 });
    expect(await readStats(db)).toMatchObject({ visitors: 502 });
    await countSharedChart({ METRICS: db });
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM metric_events').get()).toEqual({ n: 1 });
    expect(await readStats(db)).toMatchObject({ visitors: 502, chartsShared: 1 });
    expect(db.sqlite.prepare('SELECT expires_at FROM metric_events WHERE id = ?').get(current.id)).toEqual({ expires_at: now + EVENT_TTL_MS });
  });

  it('does not prolong receipt expiry when a request is retried', async () => {
    const value = event();
    await submit(value);
    vi.setSystemTime(now + 60_000);
    await submit(value);
    expect(db.sqlite.prepare('SELECT expires_at FROM metric_events WHERE id = ?').get(value.id)).toEqual({ expires_at: now + EVENT_TTL_MS });
  });

  it.each([
    null, [], {}, event('share'), event('chart_shared'), event('VISIT'),
    event('visit', { id: 'not-an-id' }), event('visit', { id: '00000000-0000-1000-8000-000000000000' }),
    event('visit', { day: '2026-11-01' }), event('visit', { day: '2026-11-04' }),
    event('visit', { day: '2026-11-03T00:00:00Z' }), event('visit', { browser: 'identity' }),
    event('visit', { title: 'private title' }),
  ])('rejects invalid or over-specified events: %j', async value => {
    expect((await submit(value))!.status).toBe(400);
    expect(await readStats(db)).toMatchObject({ visitors: 0, chartsCreated: 0 });
  });

  it('requires production request URL and Origin even if a preview sends a production Origin header', async () => {
    for (const site of ['https://preview.pages.dev', 'http://localhost:3000']) {
      expect((await handleMetricsRequest(post(event(), {}, site), { METRICS: db }))!.status).toBe(403);
      expect((await handleMetricsRequest(post(event(), { headers: { Origin: origin, 'Content-Type': 'application/json' } }, site), { METRICS: db }))!.status).toBe(403);
    }
    for (const badOrigin of ['', 'null', 'http://flowchart.lol', 'https://flowchart.lol.evil.test']) {
      expect((await handleMetricsRequest(post(event(), { headers: { Origin: badOrigin, 'Content-Type': 'application/json' } }), { METRICS: db }))!.status).toBe(403);
    }
    expect((await handleMetricsRequest(post(event(), {}, 'http://localhost:3000'), { METRICS: db, SITE_ORIGIN: 'http://localhost:3000' }))!.status).toBe(204);
  });

  it('checks JSON type and both declared and streamed size limits', async () => {
    expect((await handleMetricsRequest(post(event(), { headers: { Origin: origin, 'Content-Type': 'text/plain' } }), { METRICS: db }))!.status).toBe(415);
    const declared = post(event(), { headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': '257' } });
    const getReader = vi.spyOn(declared.body!, 'getReader');
    expect((await handleMetricsRequest(declared, { METRICS: db }))!.status).toBe(413);
    expect(getReader).not.toHaveBeenCalled();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(128)); }, cancel() { cancelled = true; } });
    const streaming = post(event(), { body: stream, duplex: 'half', headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': '1' } } as RequestInit);
    expect((await handleMetricsRequest(streaming, { METRICS: db }))!.status).toBe(413);
    expect(cancelled).toBe(true);
    for (const body of ['{', new Uint8Array([0xff])]) {
      expect((await handleMetricsRequest(post(event(), { body }), { METRICS: db }))!.status).toBe(400);
    }
  });

  it('handles missing bindings, unavailable tables and methods without exposing database details', async () => {
    const get = () => new Request(`${origin}/api/stats`);
    expect((await handleMetricsRequest(get(), {}))!.status).toBe(503);
    expect((await handleMetricsRequest(post(), {}))!.status).toBe(503);
    db.sqlite.exec('DROP TABLE metrics');
    expect((await handleMetricsRequest(get(), { METRICS: db }))!.status).toBe(503);
    expect((await submit())!.status).toBe(503);
    for (const [path, method, allow] of [['/api/stats', 'POST', 'GET'], ['/api/metrics', 'GET', 'POST']]) {
      const response = await handleMetricsRequest(new Request(origin + path, { method }), { METRICS: db });
      expect(response!.status).toBe(405);
      expect(response!.headers.get('Allow')).toBe(allow);
      expect(response!.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
    expect((await handleMetricsRequest(new Request(`${origin}/api/stats/extra`), {}))!.status).toBe(404);
    expect(await handleMetricsRequest(new Request(`${origin}/app`), {})).toBeNull();
  });
});
