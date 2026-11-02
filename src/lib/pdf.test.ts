import { describe, expect, it } from 'vitest';
import { jpegToPdf, pdfLayout } from './pdf';

describe('PDF page layout', () => {
  it.each([[1200, 400], [400, 1200], [800, 800]])('fits a %s × %s scene on A4 without changing its aspect ratio', (width, height) => {
    const layout = pdfLayout(width, height);
    expect(layout.pageWidth > layout.pageHeight).toBe(width > height);
    expect(layout.imageWidth / layout.imageHeight).toBeCloseTo(width / height, 8);
    expect(layout.imageX).toBeGreaterThanOrEqual(24 - 1e-8);
    expect(layout.imageY).toBeGreaterThanOrEqual(24 - 1e-8);
    expect(layout.imageX * 2 + layout.imageWidth).toBeCloseTo(layout.pageWidth, 8);
    expect(layout.imageY * 2 + layout.imageHeight).toBeCloseTo(layout.pageHeight, 8);
    expect(layout.pixelWidth).toBe(Math.round(layout.imageWidth * 300 / 72));
    expect(layout.pixelHeight).toBe(Math.round(layout.imageHeight * 300 / 72));
    expect(layout.pixelWidth * layout.pixelHeight).toBeLessThan(16_000_000);
  });

  it('rejects invalid dimensions before rendering', () => {
    for (const dimension of [0, -1, NaN, Infinity]) expect(() => pdfLayout(dimension, 100)).toThrow(/invalid export dimensions/);
  });
});

describe('binary PDF writer', () => {
  // Binary sentinel bytes exercise offsets and stream length independently of image decoding.
  const jpeg = new Uint8Array([0xff, 0xd8, 0x80, 0x00, 0xc3, 0x0a, 0xff, 0xd9]);
  const latin = (bytes: Uint8Array) => Array.from(bytes, byte => String.fromCharCode(byte)).join('');

  it('embeds untouched image bytes with correct stream lengths and byte-based cross-reference offsets', () => {
    const layout = pdfLayout(700, 350);
    const bytes = jpegToPdf(jpeg, layout);
    const pdf = latin(bytes);
    expect(pdf.startsWith('%PDF-1.4\n%')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    expect(pdf).toContain('/Type /Pages /Kids [3 0 R] /Count 1');
    expect(pdf).toContain('/MediaBox [0 0 841.89 595.28]');
    expect(pdf).toContain(`/Subtype /Image /Width ${layout.pixelWidth} /Height ${layout.pixelHeight}`);
    expect(pdf).toContain('/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length 8');
    const imageStart = pdf.indexOf('stream\n', pdf.indexOf('4 0 obj')) + 'stream\n'.length;
    expect(bytes.slice(imageStart, imageStart + jpeg.byteLength)).toEqual(jpeg);
    expect(pdf.slice(imageStart + jpeg.length)).toMatch(/^\nendstream\nendobj/);
    const xrefOffset = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xrefOffset)).toMatch(/^xref\n0 6\n/);
    const entries = pdf.slice(xrefOffset).split('\n').slice(3, 8);
    expect(entries).toHaveLength(5);
    entries.forEach((entry, index) => {
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      expect(pdf.slice(Number(entry.slice(0, 10)))).toMatch(new RegExp(`^${index + 1} 0 obj\\n`));
    });
    const contentObject = pdf.slice(pdf.indexOf('5 0 obj'), pdf.indexOf('xref\n'));
    const length = Number(contentObject.match(/\/Length (\d+)/)![1]);
    const content = contentObject.slice(contentObject.indexOf('stream\n') + 'stream\n'.length);
    expect(content.slice(length)).toMatch(/^\nendstream/);
    expect(content.slice(0, length)).toContain('/Scene Do');
    expect(pdf).not.toContain('/Font');
  });

  it('rejects missing JPEG bytes and invalid page geometry', () => {
    expect(() => jpegToPdf(new Uint8Array([1, 2, 3]), pdfLayout(10, 10))).toThrow(/JPEG/);
    expect(() => jpegToPdf(jpeg, { ...pdfLayout(10, 10), imageWidth: NaN })).toThrow(/page dimensions/);
  });
});
