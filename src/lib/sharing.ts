import { validateDiagram, type Diagram } from './diagram';

export const MAX_SHARE_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 710_000;
export type ShareErrorCode = 'invalid-link' | 'decrypt' | 'unavailable' | 'expired' | 'network' | 'too-large' | 'service';
export class ShareError extends Error {
  constructor(readonly code: ShareErrorCode, message: string) { super(message); this.name = 'ShareError'; }
}
export interface EncryptedShare { version: 1; iv: string; ciphertext: string }
export interface ShareRecord extends EncryptedShare { expiresAt: string }

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) throw new ShareError('unavailable', 'This browser cannot encrypt or open share links. Use a current browser over HTTPS.');
  return globalThis.crypto;
}
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: unknown, max: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ShareError('invalid-link', 'This share link is invalid or incomplete.');
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)); }
  catch { throw new ShareError('invalid-link', 'This share link is invalid or incomplete.'); }
  if (bytes.byteLength > max || encode(bytes) !== value) throw new ShareError('invalid-link', 'This share link is invalid or incomplete.');
  return bytes;
}
export function parseShareFragment(fragment: string): { id: string; key: string } {
  const match = /^#([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(fragment);
  if (!match || decode(match[2], 32).byteLength !== 32) throw new ShareError('invalid-link', 'This share link is invalid or incomplete. Ask the sender for the full link, including the part after #.');
  return { id: match[1], key: match[2] };
}

/** The key is returned separately and must only be placed in the URL fragment. */
export async function encryptShare(diagram: Diagram): Promise<{ payload: EncryptedShare; key: string }> {
  const plaintext = new TextEncoder().encode(JSON.stringify(validateDiagram(diagram)));
  if (plaintext.byteLength > MAX_SHARE_BYTES) throw new ShareError('too-large', 'This diagram exceeds the 512 KiB sharing limit. Download JSON to share a file instead.');
  const crypto = webCrypto();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { payload: { version: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }, key: encode(keyBytes) };
}

export async function decryptShare(record: EncryptedShare, encodedKey: string): Promise<Diagram> {
  if (record.version !== 1) throw new ShareError('decrypt', 'This shared diagram uses an unsupported format.');
  const keyBytes = decode(encodedKey, 32), iv = decode(record.iv, 12), ciphertext = decode(record.ciphertext, MAX_SHARE_BYTES + 16);
  if (keyBytes.byteLength !== 32 || iv.byteLength !== 12 || ciphertext.byteLength <= 16) throw new ShareError('invalid-link', 'This share link is invalid or incomplete.');
  const crypto = webCrypto();
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    if (plaintext.byteLength > MAX_SHARE_BYTES) throw new Error('Oversized diagram');
    return validateDiagram(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
  } catch { throw new ShareError('decrypt', 'This diagram could not be opened. The key may be incorrect or the shared data may be damaged. Ask the sender for a new link.'); }
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > MAX_RESPONSE_BYTES) throw new ShareError('service', 'The sharing service returned invalid data.');
  const reader = response.body?.getReader();
  if (!reader) throw new ShareError('service', 'The sharing service returned invalid data.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new ShareError('service', 'The sharing service returned invalid data.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response');
    return value as Record<string, unknown>;
  } catch { throw new ShareError('service', 'The sharing service returned invalid data.'); }
}
function expiry(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ShareError('service', 'The sharing service returned an invalid expiry date.');
  if (Date.parse(value) <= Date.now()) throw new ShareError('expired', 'This share link has expired. Ask the sender for a new link.');
  return value;
}
async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(20_000);
  try {
    return await fetch(url, { ...init, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ShareError('network', 'The sharing service could not be reached. Check your connection and try again.');
  }
}
export async function createShare(diagram: Diagram): Promise<{ url: string; expiresAt: string }> {
  const { payload, key } = await encryptShare(diagram);
  const response = await request('/api/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new ShareError('service', response.status === 429 ? 'Too many share links were created. Wait a moment and try again.' : 'The share link could not be created. Try again.');
  const value = await readResponse(response);
  if (typeof value.id !== 'string' || !/^[a-f0-9]{32}$/.test(value.id)) throw new ShareError('service', 'The sharing service returned an invalid link.');
  return { url: `${window.location.origin}/share#${value.id}.${key}`, expiresAt: expiry(value.expiresAt) };
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, milliseconds);
    if (signal?.aborted) aborted(); else signal?.addEventListener('abort', aborted, { once: true });
  });
}
export async function loadSharedDiagram(fragment: string, signal?: AbortSignal): Promise<{ diagram: Diagram; expiresAt: string }> {
  const { id, key } = parseShareFragment(fragment);
  let response: Response | undefined;
  // A newly written link can briefly be unavailable in another storage region.
  for (const delay of [0, 400, 1000]) {
    if (delay) await pause(delay, signal);
    response = await request(`/api/shares/${id}`, { method: 'GET' }, signal);
    if (response.status !== 404) break;
    await response.body?.cancel();
  }
  if (!response || response.status === 404 || response.status === 410) throw new ShareError('expired', 'This share link has expired or is unavailable. Ask the sender for a new link.');
  if (!response.ok) throw new ShareError('service', 'The shared diagram could not be loaded. Try again.');
  const value = await readResponse(response);
  const expiresAt = expiry(value.expiresAt);
  const diagram = await decryptShare(value as unknown as ShareRecord, key);
  expiry(expiresAt);
  return { diagram, expiresAt };
}
