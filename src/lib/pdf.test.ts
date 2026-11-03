import { describe, expect, it } from 'vitest';
import { pdfLayout } from './pdf';

describe('PDF page layout', () => {
  it.each([[1200, 400], [400, 1200], [800, 800]])('preserves native text size for a %s × %s scene', (width, height) => {
    const layout = pdfLayout(width, height);
    expect(layout.pageWidth).toBeCloseTo(width * 0.75, 8);
    expect(layout.pageHeight).toBeCloseTo(height * 0.75, 8);
    expect(layout.scale).toBeCloseTo(0.75, 8);
    expect(layout.imageWidth / layout.imageHeight).toBeCloseTo(width / height, 8);
    expect(layout.imageX).toBeCloseTo(0, 8);
    expect(layout.imageY).toBeCloseTo(0, 8);
    expect(layout.imageX * 2 + layout.imageWidth).toBeCloseTo(layout.pageWidth, 8);
    expect(layout.imageY * 2 + layout.imageHeight).toBeCloseTo(layout.pageHeight, 8);
  });

  it.each([[1, 1], [1, 300], [300, 1]])('centers a small %s × %s scene on pages at least one inch wide and high', (width, height) => {
    const layout = pdfLayout(width, height);
    expect(layout.pageWidth).toBe(Math.max(72, width * 0.75));
    expect(layout.pageHeight).toBe(Math.max(72, height * 0.75));
    expect(layout.scale).toBe(0.75);
    expect(layout.imageWidth).toBe(width * 0.75);
    expect(layout.imageHeight).toBe(height * 0.75);
    expect(layout.imageX * 2 + layout.imageWidth).toBeCloseTo(layout.pageWidth, 8);
    expect(layout.imageY * 2 + layout.imageHeight).toBeCloseTo(layout.pageHeight, 8);
  });

  it.each([[80_000, 400], [400, 80_000], [80_000, 80_000]])('uniformly scales a %s × %s scene within PDF page limits', (width, height) => {
    const layout = pdfLayout(width, height);
    expect(Math.max(layout.pageWidth, layout.pageHeight)).toBe(14_400);
    expect(Math.min(layout.pageWidth, layout.pageHeight)).toBeGreaterThanOrEqual(72);
    expect(layout.imageWidth / layout.imageHeight).toBeCloseTo(width / height, 8);
    expect(layout.scale).toBeCloseTo(14_400 / Math.max(width, height), 8);
    expect(layout.imageWidth).toBeCloseTo(width * layout.scale, 8);
    expect(layout.imageHeight).toBeCloseTo(height * layout.scale, 8);
    expect(layout.imageX).toBeGreaterThanOrEqual(0);
    expect(layout.imageY).toBeGreaterThanOrEqual(0);
  });

  it('rejects invalid dimensions before rendering', () => {
    for (const dimension of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => pdfLayout(dimension, 100)).toThrow(/invalid export dimensions/);
      expect(() => pdfLayout(100, dimension)).toThrow(/invalid export dimensions/);
    }
  });
});
