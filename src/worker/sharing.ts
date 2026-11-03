import { countSharedChart, handleMetricsRequest, type MetricsEnvironment, type WorkerExecutionContext } from './metrics';

export const SHARE_TTL_SECONDS = 24 * 60 * 60;
export const MAX_CIPHERTEXT_BYTES = 512 * 1024 + 16;
export const MAX_REQUEST_BYTES = 700 * 1024;

interface ShareEnvelope {
  version: 1;
  iv: string;
  ciphertext: string;
}

interface StoredShare extends ShareEnvelope {
  expiresAt: string;
}

export interface ShareStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

export interface ShareEnvironment extends MetricsEnvironment {
  SHARES?: ShareStore;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...headers, ...extraHeaders } });
}

function failure(error: string, status: number, extraHeaders?: Record<string, string>) {
  return json({ error }, status, extraHeaders);
}

function validBase64(value: unknown, minBytes: number, maxBytes: number): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3)
    || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
    return decoded.length >= minBytes && decoded.length <= maxBytes
      && btoa(decoded).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === value;
  } catch {
    return false;
  }
}

function validEnvelope(value: unknown): value is ShareEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return input.version === 1 && validBase64(input.iv, 12, 12)
    && validBase64(input.ciphertext, 16, MAX_CIPHERTEXT_BYTES);
}

class RequestTooLarge extends Error {}

async function readEnvelope(request: Request): Promise<unknown> {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) {
    throw new RequestTooLarge();
  }
  if (!request.body) throw new SyntaxError('Missing body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        throw new RequestTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

async function createShare(request: Request, env: ShareEnvironment, ctx?: WorkerExecutionContext): Promise<Response> {
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return failure('This request must come from this site.', 403);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return failure('Send a JSON request.', 415);
  }
  let input: unknown;
  try {
    input = await readEnvelope(request);
  } catch (error) {
    return error instanceof RequestTooLarge
      ? failure('The shared diagram is too large.', 413)
      : failure('The share request is invalid.', 400);
  }
  if (!validEnvelope(input) || Object.keys(input).sort().join(',') !== 'ciphertext,iv,version') {
    return failure('The share request is invalid.', 400);
  }
  if (!env.SHARES) return failure('Sharing is unavailable. Try again later.', 503);
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + SHARE_TTL_SECONDS * 1000).toISOString();
  const stored: StoredShare = { version: 1, iv: input.iv, ciphertext: input.ciphertext, expiresAt };
  try {
    await env.SHARES.put(id, JSON.stringify(stored), { expirationTtl: SHARE_TTL_SECONDS });
  } catch {
    return failure('Sharing is unavailable. Try again later.', 503);
  }
  if (new URL(request.url).origin === (env.SITE_ORIGIN ?? 'https://flowchart.lol')) {
    const counting = countSharedChart(env).catch(() => {});
    if (ctx) ctx.waitUntil(counting);
    else await counting;
  }
  return json({ id, expiresAt }, 201);
}

async function getShare(id: string, env: ShareEnvironment): Promise<Response> {
  if (!/^[a-f0-9]{32}$/.test(id)) return failure('This share was not found or has expired.', 404);
  if (!env.SHARES) return failure('Sharing is unavailable. Try again later.', 503);
  let raw: string | null;
  try {
    raw = await env.SHARES.get(id);
  } catch {
    return failure('Sharing is unavailable. Try again later.', 503);
  }
  if (!raw) return failure('This share was not found or has expired.', 404);
  try {
    const value: unknown = JSON.parse(raw);
    if (!validEnvelope(value)) return failure('This share is unavailable.', 503);
    const expiresAt = (value as StoredShare).expiresAt;
    const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
    if (!Number.isFinite(expiry)) return failure('This share is unavailable.', 503);
    if (Date.now() >= expiry) return failure('This share was not found or has expired.', 404);
    return json({ version: 1, iv: value.iv, ciphertext: value.ciphertext, expiresAt });
  } catch {
    return failure('This share is unavailable.', 503);
  }
}

export async function handleRequest(request: Request, env: ShareEnvironment, ctx?: WorkerExecutionContext): Promise<Response> {
  const metricsResponse = await handleMetricsRequest(request, env);
  if (metricsResponse) return metricsResponse;
  const { pathname } = new URL(request.url);
  if (pathname === '/api/shares') {
    if (request.method !== 'POST') return failure('Method not allowed.', 405, { Allow: 'POST' });
    return createShare(request, env, ctx);
  }
  const match = /^\/api\/shares\/([^/]+)$/.exec(pathname);
  if (match) {
    if (request.method !== 'GET') return failure('Method not allowed.', 405, { Allow: 'GET' });
    return getShare(match[1], env);
  }
  if (pathname.startsWith('/api/shares')) return failure('This share was not found or has expired.', 404);
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return failure('Not found.', 404);
}

const worker = { fetch: handleRequest };
export default worker;
