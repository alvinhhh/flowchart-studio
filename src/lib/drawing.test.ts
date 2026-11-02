import { describe, expect, it } from 'vitest';
import { drawingBounds, drawingIntersectsSegment, drawingPath, drawingPressure, type DrawingStroke } from './drawing';

const stroke = (points: DrawingStroke['points'], width = 8): DrawingStroke => ({ id: 'stroke', color: 'neutral', width, points });

describe('pressure-sensitive drawing geometry', () => {
  it('uses bounded tablet pressure and constant nominal mouse and touch widths', () => {
    expect(drawingPressure(0.001)).toBe(0.05);
    expect(drawingPressure(5)).toBe(1);
    for (const pressure of [0, -1, NaN, Infinity]) expect(drawingPressure(pressure)).toBe(0.5);
    expect(drawingPressure(0.9, 'mouse')).toBe(0.5);
    expect(drawingPressure(0.1, 'touch')).toBe(0.5);
  });

  it('renders a single contact as a closed, bounded dot', () => {
    const dot = stroke([{ x: -4, y: 10, pressure: 0.5 }]);
    expect(drawingBounds(dot)).toEqual({ x: -8, y: 6, width: 8, height: 8 });
    expect(drawingPath(dot)).toMatch(/^M -8 10 a 4 4 .* Z$/);
    expect(drawingPath(stroke([]))).toBe('');
  });

  it('creates a deterministic smooth filled outline with pressure-dependent width and round ends', () => {
    const ink = stroke([{ x: 0, y: 0, pressure: 0.1 }, { x: 50, y: 0, pressure: 1 }, { x: 100, y: 0, pressure: 0.5 }], 10);
    const path = drawingPath(ink);
    expect(path).toContain('Q 50 10 75 7.5');
    expect(path).toContain('A 5 5');
    expect(path).toContain('A 1 1');
    expect(path).toMatch(/ Z$/);
    expect(drawingPath(structuredClone(ink))).toBe(path);
    expect(drawingBounds(ink)).toEqual({ x: -1, y: -10, width: 106, height: 20 });
  });

  it('handles repeated samples, reversals, unavailable pressure and bad coordinates without invalid SVG', () => {
    const ink = stroke([{ x: 0, y: 0, pressure: NaN }, { x: 0, y: 0, pressure: 0.8 }, { x: 10, y: 10, pressure: 0.2 }, { x: 0, y: 0, pressure: 1 }, { x: Infinity, y: 0, pressure: 0.5 }]);
    const path = drawingPath(ink);
    expect(path).not.toMatch(/NaN|Infinity/);
    expect(path).toMatch(/ Z$/);
    expect(drawingBounds(ink).width).toBeGreaterThan(10);
  });
});

describe('swept eraser hit testing', () => {
  const ink = stroke([{ x: 0, y: 0, pressure: 0.5 }, { x: 100, y: 0, pressure: 0.5 }]);
  it('erases a crossing gesture even when neither sampled endpoint touches the stroke', () => {
    expect(drawingIntersectsSegment(ink, { x: 50, y: -100 }, { x: 50, y: 100 }, 5)).toBe(true);
    expect(drawingIntersectsSegment(ink, { x: 50, y: -20 }, { x: 50, y: -10 }, 5)).toBe(false);
  });
  it('includes round caps, dots, collinear overlap and screen-space tolerance', () => {
    expect(drawingIntersectsSegment(ink, { x: -8, y: 0 }, { x: -8, y: 0 }, 5)).toBe(true);
    expect(drawingIntersectsSegment(ink, { x: 30, y: 0 }, { x: 60, y: 0 }, 0)).toBe(true);
    const dot = stroke([{ x: 20, y: 30, pressure: 1 }]);
    expect(drawingIntersectsSegment(dot, { x: 20, y: 50 }, { x: 20, y: 40 }, 2)).toBe(true);
    expect(drawingIntersectsSegment(stroke([]), { x: 0, y: 0 }, { x: 0, y: 0 }, 5)).toBe(false);
  });
});
