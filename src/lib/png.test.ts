import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodePng, pngLayout } from './png';

async function* bands(...values: Uint8Array[]) {
  yield* values;
}

// Deliberately use a bitwise CRC instead of the encoder's lookup table.
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decode(bytes: Uint8Array) {
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { type: string; data: Uint8Array }[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    expect(offset + length + 12).toBeLessThanOrEqual(bytes.length);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (view.getUint32(offset + 8 + length) !== crc32(bytes.subarray(offset + 4, offset + 8 + length))) {
      throw new Error(`Invalid ${type} CRC`);
    }
    chunks.push({ type, data });
    offset += length + 12;
  }
  expect(offset).toBe(bytes.length);
  expect(chunks[0].type).toBe('IHDR');
  expect(chunks.at(-1)?.type).toBe('IEND');
  expect(chunks.at(-1)?.data.length).toBe(0);
  const header = chunks[0].data;
  expect(Array.from(header.subarray(8))).toEqual([8, 2, 0, 0, 0]);
  const headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = headerView.getUint32(0);
  const height = headerView.getUint32(4);
  const compressed = Buffer.concat(chunks.filter((value) => value.type === 'IDAT').map((value) => value.data));
  const inflated = inflateSync(compressed, { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  // Multiple independent zlib streams would leave compressed bytes unread.
  expect(inflated.engine.bytesWritten).toBe(compressed.length);
  const filtered = inflated.buffer;
  const rowBytes = width * 3;
  expect(filtered.length).toBe((rowBytes + 1) * height);
  const rgb = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row++) {
    const source = row * (rowBytes + 1);
    expect(filtered[source]).toBe(1);
    for (let column = 0; column < rowBytes; column++) {
      rgb[row * rowBytes + column] = filtered[source + 1 + column] + (column < 3 ? 0 : rgb[row * rowBytes + column - 3]);
    }
  }
  return { width, height, rgb, chunks };
}

afterEach(() => vi.unstubAllGlobals());

describe('PNG layout', () => {
  it('renders at four pixels per CSS pixel by default', () => {
    expect(pngLayout(100, 200)).toEqual({ width: 400, height: 800, scale: 4, limited: false });
    expect(pngLayout(25.125, 50.375)).toEqual({ width: 100, height: 201, scale: 4, limited: false });
  });

  it('caps dimensions and pixel count while preserving a uniform scale', () => {
    expect(pngLayout(5000, 100)).toEqual({ width: 16384, height: 327, scale: 16384 / 5000, limited: true });
    expect(pngLayout(100, 5000)).toEqual({ width: 327, height: 16384, scale: 16384 / 5000, limited: true });
    expect(pngLayout(4000, 4000)).toEqual({ width: 8000, height: 8000, scale: 2, limited: true });
    expect(pngLayout(8000, 8000).scale).toBe(1);
    expect(pngLayout(16384, 1).scale).toBe(1);
    for (const [width, height] of [[3999.9, 4000.1], [8192, 7812.5], [0.1, 16384]]) {
      const layout = pngLayout(width, height);
      expect(layout.width * layout.height).toBeLessThanOrEqual(64_000_000);
      expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(16384);
    }
  });

  it('keeps tiny axes at least one pixel wide', () => {
    expect(pngLayout(0.01, 100)).toEqual({ width: 1, height: 400, scale: 4, limited: false });
    expect(pngLayout(100, 0.01)).toEqual({ width: 400, height: 1, scale: 4, limited: false });
    expect(pngLayout(Number.MIN_VALUE, Number.MIN_VALUE).width).toBe(1);
  });

  it('refuses unreadable exports instead of scaling below one', () => {
    for (const [width, height] of [[16385, 1], [1, 16385], [8001, 8000], [5_000_000, 1]]) {
      expect(() => pngLayout(width, height)).toThrow(/readable PNG.*SVG or PDF/);
    }
  });

  it('rejects invalid scene dimensions', () => {
    for (const value of [0, -1, NaN, Infinity, -Infinity, 5_000_001]) {
      expect(() => pngLayout(value, 100)).toThrow(/Invalid export dimensions/);
      expect(() => pngLayout(100, value)).toThrow(/Invalid export dimensions/);
    }
  });
});

describe('PNG encoding', () => {
  it('preserves every RGB byte and resets Sub filtering at each row across bands', async () => {
    const rgb = Uint8Array.from([0, 255, 127, 255, 0, 128, 12, 34, 56, 1, 2, 3, 0, 0, 0, 255, 255, 255]);
    const blob = await encodePng(3, 2, bands(rgb.subarray(0, 9), rgb.subarray(9)));
    expect(blob.type).toBe('image/png');
    const result = decode(new Uint8Array(await blob.arrayBuffer()));
    expect([result.width, result.height]).toEqual([3, 2]);
    expect(result.rgb).toEqual(rgb);
    expect(result.chunks.map((value) => value.type)).not.toContain('pHYs');
  });

  it('drains larger input concurrently and splits one lossless zlib stream over IDAT chunks', async () => {
    const width = 512;
    const height = 180;
    let state = 123456789;
    const rgb = Uint8Array.from({ length: width * height * 3 }, () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state & 255;
    });
    const blob = await encodePng(width, height, bands(rgb.subarray(0, width * 128 * 3), rgb.subarray(width * 128 * 3)), 4 * 96 / 0.0254);
    const result = decode(new Uint8Array(await blob.arrayBuffer()));
    expect(result.rgb).toEqual(rgb);
    const idat = result.chunks.filter((value) => value.type === 'IDAT');
    expect(idat.length).toBeGreaterThan(1);
    for (const value of idat) expect(value.data.length).toBeLessThanOrEqual(65_536);
    expect(result.chunks.map((value) => value.type).slice(0, 2)).toEqual(['IHDR', 'pHYs']);
    const density = result.chunks[1].data;
    const densityView = new DataView(density.buffer, density.byteOffset, density.byteLength);
    expect(densityView.getUint32(0)).toBe(15118);
    expect(densityView.getUint32(4)).toBe(15118);
    expect(density[8]).toBe(1);
  });

  it('writes verifiable checksums that detect corrupted image bytes', async () => {
    const blob = await encodePng(1, 1, bands(new Uint8Array([1, 2, 3])));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    decode(bytes);
    bytes[41] ^= 1;
    expect(() => decode(bytes)).toThrow(/CRC/);
  });

  it('rejects incomplete, extra, partial, empty, and oversized bands', async () => {
    await expect(encodePng(1, 2, bands(new Uint8Array(3)))).rejects.toThrow(/missing rows/);
    await expect(encodePng(1, 1, bands(new Uint8Array(6)))).rejects.toThrow(/too many rows/);
    await expect(encodePng(2, 1, bands(new Uint8Array(3)))).rejects.toThrow(/complete RGB rows/);
    await expect(encodePng(1, 1, bands(new Uint8Array(0)))).rejects.toThrow(/complete RGB rows/);
    await expect(encodePng(1, 129, bands(new Uint8Array(129 * 3)))).rejects.toThrow(/at most 128 rows/);
    await expect(encodePng(1, 1, bands(new Uint8Array(3), new Uint8Array(3)))).rejects.toThrow(/too many rows/);
  });

  it('closes a rejected input iterator and propagates source failures', async () => {
    let closed = false;
    async function* invalidSource() {
      try {
        yield new Uint8Array(6);
      } finally {
        closed = true;
      }
    }
    await expect(encodePng(1, 1, invalidSource())).rejects.toThrow(/too many rows/);
    expect(closed).toBe(true);
    async function* failedSource() {
      yield new Uint8Array(3);
      throw new Error('Rendering failed');
    }
    await expect(encodePng(1, 2, failedSource())).rejects.toThrow('Rendering failed');
  });

  it('validates dimensions and density before requesting pixels', async () => {
    let requested = false;
    async function* source() { requested = true; yield new Uint8Array(3); }
    for (const value of [0, -1, NaN, Infinity, 1.5, 16385]) {
      await expect(encodePng(value, 1, source())).rejects.toThrow(/Invalid PNG dimensions/);
      await expect(encodePng(1, value, source())).rejects.toThrow(/Invalid PNG dimensions/);
    }
    await expect(encodePng(8001, 8000, source())).rejects.toThrow(/Invalid PNG dimensions/);
    for (const density of [0, -1, NaN, Infinity, 0.1, 0x100000000]) {
      await expect(encodePng(1, 1, source(), density)).rejects.toThrow(/Invalid PNG pixel density/);
    }
    expect(requested).toBe(false);
  });

  it('provides a vector alternative when native compression is unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    await expect(encodePng(1, 1, bands(new Uint8Array(3)))).rejects.toThrow(/does not support PNG compression.*SVG or PDF/);
    vi.stubGlobal('CompressionStream', class { constructor() { throw new Error('unsupported format'); } });
    await expect(encodePng(1, 1, bands(new Uint8Array(3)))).rejects.toThrow(/does not support PNG compression.*SVG or PDF/);
  });
});
