const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 64_000_000;
const MAX_SCENE_DIMENSION = 5_000_000;
const MAX_BAND_ROWS = 128;
const IDAT_BYTES = 65_536;

export function pngLayout(width: number, height: number) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0 && value <= MAX_SCENE_DIMENSION)) {
    throw new Error('Invalid export dimensions.');
  }
  const scale = Math.min(4, MAX_DIMENSION / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  if (scale < 1) {
    throw new Error('This diagram is too large for a readable PNG. Export SVG or PDF instead.');
  }
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
    limited: scale < 4,
  };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function chunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) bytes[index + 4] = type.charCodeAt(index);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < bytes.length - 4; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

/** Encode sequential full-width RGB8 bands without allocating a full image. */
export async function encodePng(
  width: number,
  height: number,
  bands: AsyncIterable<Uint8Array>,
  pixelsPerMeter?: number,
): Promise<Blob> {
  if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= MAX_DIMENSION) || width * height > MAX_PIXELS) {
    throw new Error('Invalid PNG dimensions. Export SVG or PDF for larger diagrams.');
  }
  if (pixelsPerMeter !== undefined && (!Number.isFinite(pixelsPerMeter) || Math.round(pixelsPerMeter) < 1 || Math.round(pixelsPerMeter) > 0xffffffff)) {
    throw new Error('Invalid PNG pixel density.');
  }
  if (typeof CompressionStream === 'undefined') {
    throw new Error('This browser does not support PNG compression. Export SVG or PDF instead.');
  }
  let compression: CompressionStream;
  try {
    compression = new CompressionStream('deflate');
  } catch {
    throw new Error('This browser does not support PNG compression. Export SVG or PDF instead.');
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  const parts: BlobPart[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header)];
  if (pixelsPerMeter !== undefined) {
    const density = new Uint8Array(9);
    const densityView = new DataView(density.buffer);
    densityView.setUint32(0, Math.round(pixelsPerMeter));
    densityView.setUint32(4, Math.round(pixelsPerMeter));
    density[8] = 1;
    parts.push(chunk('pHYs', density));
  }

  const writer = compression.writable.getWriter();
  const reader = compression.readable.getReader();
  // Drain while writing: compression may stop accepting input until output is read.
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.length; offset += IDAT_BYTES) {
        parts.push(chunk('IDAT', value.subarray(offset, offset + IDAT_BYTES)));
      }
    }
  })();
  // Observe failures immediately, including when the source is awaiting its next band.
  void drain.catch(() => {});
  void writer.closed.catch(() => {});
  try {
    const rowBytes = width * 3;
    let rows = 0;
    for await (const band of bands) {
      if (!(band instanceof Uint8Array) || band.length === 0 || band.length % rowBytes !== 0) {
        throw new Error('PNG bands must contain complete RGB rows.');
      }
      const bandRows = band.length / rowBytes;
      if (bandRows > MAX_BAND_ROWS) throw new Error('PNG bands must contain at most 128 rows.');
      if (rows + bandRows > height) throw new Error('PNG input contains too many rows.');
      const filtered = new Uint8Array(band.length + bandRows);
      for (let row = 0; row < bandRows; row++) {
        const source = row * rowBytes;
        const target = row * (rowBytes + 1);
        filtered[target] = 1;
        for (let column = 0; column < rowBytes; column++) {
          filtered[target + column + 1] = band[source + column] - (column < 3 ? 0 : band[source + column - 3]);
        }
      }
      await writer.write(filtered);
      rows += bandRows;
    }
    if (rows !== height) throw new Error('PNG input is missing rows.');
    await writer.close();
    await drain;
    parts.push(chunk('IEND', new Uint8Array(0)));
    return new Blob(parts, { type: 'image/png' });
  } catch (error) {
    await Promise.allSettled([writer.abort(error), reader.cancel(error)]);
    await drain.catch(() => {});
    throw error;
  } finally {
    writer.releaseLock();
    reader.releaseLock();
  }
}
