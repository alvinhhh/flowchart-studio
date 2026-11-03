import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNode, exampleDiagram, newDiagram } from './diagram';
import { createShare, decryptShare, encryptShare, loadSharedDiagram, MAX_SHARE_BYTES, parseShareFragment, ShareError } from './sharing';

const id = 'a1'.repeat(16);
const expiresAt = () => new Date(Date.now() + 60_000).toISOString();
const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('encrypted sharing', () => {
  it('round-trips every portable field with a fresh AES-256 key and 96-bit IV', async () => {
    const diagram = exampleDiagram();
    diagram.nodes[0].notes = 'Private notes 🐈';
    diagram.drawings = [{ id: crypto.randomUUID(), color: 'neutral', width: 4, points: [{ x: 12, y: -40, pressure: 0.8 }] }];
    const a = await encryptShare(diagram), b = await encryptShare(diagram);
    expect(a.payload.version).toBe(1);
    expect(Buffer.from(a.key, 'base64url')).toHaveLength(32);
    expect(Buffer.from(a.payload.iv, 'base64url')).toHaveLength(12);
    expect(Buffer.from(a.payload.ciphertext, 'base64url')).toHaveLength(new TextEncoder().encode(JSON.stringify(diagram)).byteLength + 16);
    expect(a.key).not.toBe(b.key);
    expect(a.payload.iv).not.toBe(b.payload.iv);
    expect(a.payload.ciphertext).not.toBe(b.payload.ciphertext);
    expect(await decryptShare(a.payload, a.key)).toEqual(diagram);
    const key = await crypto.subtle.importKey('raw', Buffer.from(a.key, 'base64url'), 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(a.payload.iv, 'base64url') }, key, Buffer.from(a.payload.ciphertext, 'base64url'));
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(diagram);
  });

  it('rejects the wrong key, tampered ciphertext, and tampered IV', async () => {
    const { payload, key } = await encryptShare(exampleDiagram());
    const wrong = base64url(crypto.getRandomValues(new Uint8Array(32)));
    await expect(decryptShare(payload, wrong)).rejects.toMatchObject({ code: 'decrypt' });
    const bytes = Buffer.from(payload.ciphertext, 'base64url'); bytes[0] ^= 1;
    await expect(decryptShare({ ...payload, ciphertext: bytes.toString('base64url') }, key)).rejects.toMatchObject({ code: 'decrypt' });
    const iv = Buffer.from(payload.iv, 'base64url'); iv[0] ^= 1;
    await expect(decryptShare({ ...payload, iv: iv.toString('base64url') }, key)).rejects.toMatchObject({ code: 'decrypt' });
  });

  it('validates the complete diagram before encryption and after decryption', async () => {
    const diagram = exampleDiagram();
    await expect(encryptShare({ ...diagram, selection: [] } as typeof diagram)).rejects.toThrow(/not supported/);
    const keyBytes = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const data = new TextEncoder().encode(JSON.stringify({ ...diagram, edges: [{ ...diagram.edges[0], target: 'missing' }] }));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    await expect(decryptShare({ version: 1, iv: base64url(iv), ciphertext: base64url(new Uint8Array(ciphertext)) }, base64url(keyBytes))).rejects.toMatchObject({ code: 'decrypt' });
  });

  it('enforces the UTF-8 plaintext limit before sending anything', async () => {
    const diagram = newDiagram();
    diagram.nodes = Array.from({ length: 18 }, () => ({ ...createNode('process', { x: 0, y: 0 }), notes: '猫'.repeat(10_000) }));
    expect(new TextEncoder().encode(JSON.stringify(diagram)).byteLength).toBeGreaterThan(MAX_SHARE_BYTES);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(createShare(diagram)).rejects.toMatchObject({ code: 'too-large' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts only canonical full fragments and rejects malformed keys before any request', async () => {
    const { key } = await encryptShare(newDiagram());
    expect(parseShareFragment(`#${id}.${key}`)).toEqual({ id, key });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const fragment of ['', `#${id}`, `#${id}.${key}=`, `#${id}.${key}/`, `#${id.toUpperCase()}.${key}`, `#${id}.${'A'.repeat(42)}B`]) {
      await expect(loadSharedDiagram(fragment)).rejects.toBeInstanceOf(ShareError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts only the encrypted envelope and places the key exclusively in the fragment', async () => {
    const diagram = exampleDiagram(); diagram.title = 'secret project title';
    vi.stubGlobal('window', { location: { origin: 'https://flowchart.lol' } });
    const fetch = vi.fn().mockResolvedValue(Response.json({ id, expiresAt: expiresAt() })); vi.stubGlobal('fetch', fetch);
    const result = await createShare(diagram);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/shares');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    const payload = JSON.parse(init.body as string);
    expect(Object.keys(payload).sort()).toEqual(['ciphertext', 'iv', 'version']);
    const fragment = new URL(result.url).hash, parsed = parseShareFragment(fragment);
    expect(JSON.stringify([url, init])).not.toContain(parsed.key);
    expect(JSON.stringify([url, init])).not.toContain(diagram.title);
    expect(await decryptShare(payload, parsed.key)).toEqual(diagram);
    expect(new URL(result.url).pathname).toBe('/share');
    expect(new URL(result.url).search).toBe('');
  });

  it('loads only the share ID and decrypts in memory without caches or credentials', async () => {
    const diagram = exampleDiagram(), encrypted = await encryptShare(diagram);
    const expiration = expiresAt();
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...encrypted.payload, expiresAt: expiration })); vi.stubGlobal('fetch', fetch);
    expect(await loadSharedDiagram(`#${id}.${encrypted.key}`)).toEqual({ diagram, expiresAt: expiration });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/shares/${id}`);
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(JSON.stringify([url, init])).not.toContain(encrypted.key);
  });

  it('retries only bounded transient 404s and then reports an unavailable link', async () => {
    vi.useFakeTimers();
    const encrypted = await encryptShare(newDiagram());
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 404 }))); vi.stubGlobal('fetch', fetch);
    const result = expect(loadSharedDiagram(`#${id}.${encrypted.key}`)).rejects.toMatchObject({ code: 'expired' });
    await vi.advanceTimersByTimeAsync(1400);
    await result;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('recovers when a newly created share reaches the read region on retry', async () => {
    vi.useFakeTimers();
    const diagram = newDiagram(), encrypted = await encryptShare(diagram);
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(Response.json({ ...encrypted.payload, expiresAt: expiresAt() })); vi.stubGlobal('fetch', fetch);
    const result = loadSharedDiagram(`#${id}.${encrypted.key}`);
    await vi.advanceTimersByTimeAsync(400);
    expect((await result).diagram).toEqual(diagram);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects expired responses, malformed records, and oversized response streams', async () => {
    const encrypted = await encryptShare(newDiagram());
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    fetch.mockResolvedValueOnce(Response.json({ ...encrypted.payload, expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await expect(loadSharedDiagram(`#${id}.${encrypted.key}`)).rejects.toMatchObject({ code: 'expired' });
    fetch.mockResolvedValueOnce(Response.json({ ...encrypted.payload, version: 2, expiresAt: expiresAt() }));
    await expect(loadSharedDiagram(`#${id}.${encrypted.key}`)).rejects.toMatchObject({ code: 'decrypt' });
    fetch.mockResolvedValueOnce(new Response('x'.repeat(710_001)));
    await expect(loadSharedDiagram(`#${id}.${encrypted.key}`)).rejects.toMatchObject({ code: 'service' });
  });

  it('distinguishes network failures and supports aborting an in-flight request', async () => {
    const encrypted = await encryptShare(newDiagram());
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')); vi.stubGlobal('fetch', fetch);
    await expect(loadSharedDiagram(`#${id}.${encrypted.key}`)).rejects.toMatchObject({ code: 'network' });
    const controller = new AbortController(); controller.abort();
    fetch.mockImplementation((_url: string, init: RequestInit) => Promise.reject(init.signal?.reason));
    await expect(loadSharedDiagram(`#${id}.${encrypted.key}`, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
