import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, MAX_CIPHERTEXT_BYTES, MAX_REQUEST_BYTES, SHARE_TTL_SECONDS, type ShareStore } from './sharing';
import { readStats } from './metrics';
import { testDatabase } from './test-database';

const origin = 'https://flowchart.lol';
const exampleId = 'a'.repeat(32);
const base64url = (value: Uint8Array) => Buffer.from(value).toString('base64url');
const envelope = {
  version: 1,
  iv: base64url(new Uint8Array(12)),
  ciphertext: base64url(new Uint8Array(32)),
};

function store() {
  const records = new Map<string, string>();
  return {
    records,
    get: vi.fn(async (key: string) => records.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { records.set(key, value); }),
  } satisfies ShareStore & { records: Map<string, string> };
}

function post(value: unknown = envelope, extra: RequestInit = {}, site = origin) {
  return new Request(`${site}/api/shares`, {
    method: 'POST',
    headers: { Origin: site, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    ...extra,
  });
}

afterEach(() => vi.useRealTimers());

describe('encrypted shares', () => {
  it('counts successful production shares without counting reads, rejected requests or failed KV writes', async () => {
    const db = testDatabase();
    try {
      const kv = store();
      const env = { SHARES: kv, METRICS: db };
      const created = await handleRequest(post(), env);
      expect(created.status).toBe(201);
      const { id } = await created.json();
      await handleRequest(new Request(`${origin}/api/shares/${id}`), env);
      await handleRequest(post(null), env);
      kv.put.mockRejectedValueOnce(new Error('KV failed'));
      expect((await handleRequest(post(), env)).status).toBe(503);
      expect(await readStats(db)).toMatchObject({ chartsShared: 1 });
      // Preview sites must not change public production totals.
      expect((await handleRequest(post(envelope, {}, 'https://preview.pages.dev'), env)).status).toBe(201);
      expect(await readStats(db)).toMatchObject({ chartsShared: 1 });
    } finally { db.close(); }
  });

  it('continues sharing when metrics storage fails and defers counting through waitUntil', async () => {
    const db = testDatabase();
    try {
      const kv = store();
      db.sqlite.exec('DROP TABLE metrics');
      expect((await handleRequest(post(), { SHARES: kv, METRICS: db })).status).toBe(201);
      expect(kv.records.size).toBe(1);
      const tasks: Promise<unknown>[] = [];
      const ctx = { waitUntil: (task: Promise<unknown>) => tasks.push(task) };
      expect((await handleRequest(post(), { SHARES: kv, METRICS: db }, ctx)).status).toBe(201);
      expect(tasks).toHaveLength(1);
      await expect(tasks[0]).resolves.toBeUndefined();
    } finally { db.close(); }
  });

  it('returns a created share while background counting is still pending', async () => {
    const db = testDatabase();
    try {
      const originalBatch = db.batch.bind(db);
      let finish: (() => void) | undefined;
      vi.spyOn(db, 'batch').mockImplementationOnce(statements => new Promise(resolve => {
        finish = () => { void originalBatch(statements).then(resolve); };
      }));
      const tasks: Promise<unknown>[] = [];
      const response = await handleRequest(post(), { SHARES: store(), METRICS: db }, { waitUntil: task => tasks.push(task) });
      expect(response.status).toBe(201);
      expect(tasks).toHaveLength(1);
      expect(await readStats(db)).toMatchObject({ chartsShared: 0 });
      finish!();
      await tasks[0];
      expect(await readStats(db)).toMatchObject({ chartsShared: 1 });
    } finally { db.close(); }
  });

  it('routes the public statistics and event APIs through the Pages worker', async () => {
    const db = testDatabase();
    try {
      const eventRequest = new Request(`${origin}/api/metrics`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'visit', id: crypto.randomUUID(), day: new Date().toISOString().slice(0, 10) }),
      });
      expect((await handleRequest(eventRequest, { METRICS: db })).status).toBe(204);
      const response = await handleRequest(new Request(`${origin}/api/stats`), { METRICS: db });
      expect(await response.json()).toMatchObject({ visitors: 1 });
    } finally { db.close(); }
  });
  it('stores opaque ciphertext with a random ID and a 24-hour TTL, and retrieves a decryptable snapshot', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T12:00:00.250Z'));
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = JSON.stringify({ title: 'Private diagram', nodes: [] });
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const encrypted = { version: 1, iv: base64url(iv), ciphertext: base64url(new Uint8Array(ciphertext)) };
    const kv = store();
    const response = await handleRequest(post(encrypted), { SHARES: kv });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created).toEqual({ id: expect.stringMatching(/^[a-f0-9]{32}$/), expiresAt: '2026-11-03T12:00:00.250Z' });
    expect(kv.put).toHaveBeenCalledWith(created.id, JSON.stringify({ ...encrypted, expiresAt: created.expiresAt }), { expirationTtl: 86400 });
    expect(kv.records.get(created.id)).not.toContain('Private diagram');
    const retrieved = await handleRequest(new Request(`${origin}/api/shares/${created.id}`), { SHARES: kv });
    const payload = await retrieved.json();
    expect(payload).toEqual({ ...encrypted, expiresAt: created.expiresAt });
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, Buffer.from(payload.ciphertext, 'base64url'));
    expect(new TextDecoder().decode(decrypted)).toBe(plaintext);
    const second = await (await handleRequest(post(), { SHARES: kv })).json();
    expect(second.id).not.toBe(created.id);
  });

  it('rejects access at the exact expiry even while KV retains the record', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.parse('2026-11-02T00:00:00.100Z');
    vi.setSystemTime(start);
    const kv = store();
    const { id } = await (await handleRequest(post(), { SHARES: kv })).json();
    vi.setSystemTime(start + SHARE_TTL_SECONDS * 1000 - 1);
    expect((await handleRequest(new Request(`${origin}/api/shares/${id}`), { SHARES: kv })).status).toBe(200);
    vi.setSystemTime(start + SHARE_TTL_SECONDS * 1000);
    expect((await handleRequest(new Request(`${origin}/api/shares/${id}`), { SHARES: kv })).status).toBe(404);
    expect(kv.records.has(id)).toBe(true);
  });

  it.each([
    null, [], {}, { ...envelope, version: 2 }, { ...envelope, iv: 'a'.repeat(15) },
    { ...envelope, ciphertext: '==' }, { ...envelope, ciphertext: 'a'.repeat(21) },
    { ...envelope, key: 'must-not-be-stored' }, { ...envelope, title: 'plaintext' },
    { ...envelope, ciphertext: `${envelope.ciphertext}=` },
  ])('rejects malformed envelope %j', async (invalid) => {
    const kv = store();
    expect((await handleRequest(post(invalid), { SHARES: kv })).status).toBe(400);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('enforces the ciphertext limit including the authentication tag', async () => {
    const kv = store();
    const max = { ...envelope, ciphertext: base64url(new Uint8Array(MAX_CIPHERTEXT_BYTES)) };
    expect((await handleRequest(post(max), { SHARES: kv })).status).toBe(201);
    const oversize = { ...envelope, ciphertext: base64url(new Uint8Array(MAX_CIPHERTEXT_BYTES + 1)) };
    expect((await handleRequest(post(oversize), { SHARES: kv })).status).toBe(400);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized declared body before reading it', async () => {
    const request = post(envelope, { headers: { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': String(MAX_REQUEST_BYTES + 1) } });
    const getReader = vi.spyOn(request.body!, 'getReader');
    expect((await handleRequest(request, { SHARES: store() })).status).toBe(413);
    expect(getReader).not.toHaveBeenCalled();
  });

  it('bounds streamed bodies even when Content-Length is absent or false', async () => {
    for (const declared of [null, '1']) {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(256 * 1024)); },
        cancel() { cancelled = true; },
      });
      const headers: Record<string, string> = { Origin: origin, 'Content-Type': 'application/json' };
      if (declared) headers['Content-Length'] = declared;
      const request = new Request(`${origin}/api/shares`, { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
      expect((await handleRequest(request, { SHARES: store() })).status).toBe(413);
      expect(cancelled).toBe(true);
    }
  });

  it('handles invalid JSON, invalid UTF-8 and failed request streams', async () => {
    const bodies = ['{', new Uint8Array([0xff]), new ReadableStream({ start(controller) { controller.error(new Error('disconnected')); } })];
    for (const body of bodies) {
      const request = post(envelope, { body, duplex: 'half' } as RequestInit);
      expect((await handleRequest(request, { SHARES: store() })).status).toBe(400);
    }
  });

  it.each([null, 'https://elsewhere.test', 'https://flowchart.lol.evil.test', 'null', 'http://flowchart.lol'])('requires the exact origin: %s', async (requestOrigin) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (requestOrigin) headers.Origin = requestOrigin;
    const kv = store();
    expect((await handleRequest(post(envelope, { headers }), { SHARES: kv })).status).toBe(403);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('accepts the matching local development origin', async () => {
    expect((await handleRequest(post(envelope, {}, 'http://localhost:3000'), { SHARES: store() })).status).toBe(201);
  });

  it('requires JSON Content-Type', async () => {
    expect((await handleRequest(post(envelope, { headers: { Origin: origin, 'Content-Type': 'text/plain' } }), { SHARES: store() })).status).toBe(415);
  });

  it.each([
    ['/api/shares', 'GET', 'POST'], ['/api/shares', 'OPTIONS', 'POST'],
    [`/api/shares/${exampleId}`, 'POST', 'GET'], [`/api/shares/${exampleId}`, 'DELETE', 'GET'],
    [`/api/shares/${exampleId}`, 'HEAD', 'GET'],
  ])('rejects unsupported method %s %s', async (path, method, allow) => {
    const response = await handleRequest(new Request(origin + path, { method }), { SHARES: store() });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe(allow);
  });

  it('returns 404 for missing, malformed and unknown share routes', async () => {
    const kv = store();
    for (const path of [`/api/shares/${exampleId}`, '/api/shares/no', '/api/shares/', '/api/shares/extra/path', '/api/shares-other']) {
      expect((await handleRequest(new Request(origin + path), { SHARES: kv })).status).toBe(404);
    }
    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it('handles missing bindings and KV quota/read/write errors without exposing details', async () => {
    const kv = store();
    kv.get.mockRejectedValue(new Error('private account details'));
    kv.put.mockRejectedValue(new Error('quota limit'));
    const responses = await Promise.all([
      handleRequest(post(), {}),
      handleRequest(new Request(`${origin}/api/shares/${exampleId}`), {}),
      handleRequest(post(), { SHARES: kv }),
      handleRequest(new Request(`${origin}/api/shares/${exampleId}`), { SHARES: kv }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('{"error":"Sharing is unavailable. Try again later."}');
    }
  });

  it('rejects corrupt stored records', async () => {
    const kv = store();
    for (const value of ['{', JSON.stringify(envelope), JSON.stringify({ ...envelope, expiresAt: 'bad' }), JSON.stringify({ ciphertext: 'invalid' })]) {
      kv.records.set(exampleId, value);
      expect((await handleRequest(new Request(`${origin}/api/shares/${exampleId}`), { SHARES: kv })).status).toBe(503);
    }
  });

  it('marks success and error API responses as non-cacheable and non-indexable without CORS', async () => {
    const kv = store();
    const responses = await Promise.all([
      handleRequest(post(), { SHARES: kv }),
      handleRequest(new Request(`${origin}/api/shares/${exampleId}`), { SHARES: kv }),
      handleRequest(post(null), { SHARES: kv }),
      handleRequest(post(), {}),
      handleRequest(new Request(`${origin}/api/shares`, { method: 'OPTIONS' }), {}),
    ]);
    for (const response of responses) {
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('delegates static requests to Pages assets unchanged', async () => {
    const assetResponse = new Response('static page');
    const request = new Request(`${origin}/`);
    const fetch = vi.fn(async () => assetResponse);
    expect(await handleRequest(request, { ASSETS: { fetch } })).toBe(assetResponse);
    expect(fetch).toHaveBeenCalledWith(request);
  });
});
