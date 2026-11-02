import { describe, expect, it } from 'vitest';
import { alignShapes, type AlignBox } from './alignment';

const box = (id: string, x: number, y: number, width = 100, height = 80): AlignBox => ({ id, position: { x, y }, width, height });
const free = { zoom: 1, snapToGrid: false };

describe('shape alignment', () => {
  it('aligns equal-size centers and spans both final boxes', () => {
    const result = alignShapes([box('moving', 104, 250)], [box('target', 100, 10)], free);
    expect(result).toEqual({ delta: { x: -4, y: 0 }, guides: [{ axis: 'x', position: 150, start: 10, end: 330 }] });
  });

  it('aligns unlike anchors and chooses the nearest candidate', () => {
    const result = alignShapes([box('moving', 104, 250)], [box('target', 0, 0, 100, 80), box('farther', 109, 0, 100, 80)], free);
    expect(result.delta).toEqual({ x: -4, y: 0 });
    expect(result.guides).toEqual([{ axis: 'x', position: 100, start: 0, end: 330 }]);
    expect(alignShapes([box('moving', 300, 104)], [box('target', 0, 0, 100, 100)], free)).toEqual({
      delta: { x: 0, y: -4 }, guides: [{ axis: 'y', position: 100, start: 0, end: 400 }],
    });
  });

  it('uses six screen pixels rather than six flow units', () => {
    const moving = [box('moving', 111, 250)];
    const target = [box('target', 100, 0)];
    expect(alignShapes(moving, target, { ...free, zoom: 0.5 }).delta.x).toBe(-11);
    expect(alignShapes(moving, target, free).delta.x).toBe(0);
    expect(alignShapes([box('moving', 104, 250)], target, { ...free, zoom: 2 }).guides).toEqual([]);
    expect(alignShapes([box('moving', 103, 250)], target, { ...free, zoom: 2 }).delta.x).toBe(-3);
    expect(alignShapes(moving, target, { ...free, tolerance: 12 }).delta.x).toBe(-11);
  });

  it('prioritizes a nearby shape over grid snapping independently on each axis', () => {
    const result = alignShapes([box('moving', 101, 233)], [box('target', 105, 0)], { zoom: 1, snapToGrid: true });
    expect(result.delta).toEqual({ x: 4, y: 7 });
    expect(result.guides).toEqual([{ axis: 'x', position: 155, start: 0, end: 320 }]);
    expect(alignShapes([box('moving', 101, 233)], [], { zoom: 1, snapToGrid: true })).toEqual({ delta: { x: -5, y: 7 }, guides: [] });
  });

  it('translates a multiple selection by group bounds without changing relative positions', () => {
    const moving = [box('one', 104, 205, 40, 40), box('two', 184, 305, 20, 40)];
    const targets = [box('x', 100, 0, 100, 30), box('y', 400, 200, 30, 140)];
    const before = structuredClone({ moving, targets });
    const result = alignShapes(moving, targets, free);
    expect(result.delta).toEqual({ x: -4, y: -5 });
    expect(result.guides).toEqual([
      { axis: 'x', position: 150, start: 0, end: 340 },
      { axis: 'y', position: 270, start: 100, end: 430 },
    ]);
    const translated = moving.map(node => ({ x: node.position.x + result.delta.x, y: node.position.y + result.delta.y }));
    expect({ x: translated[1].x - translated[0].x, y: translated[1].y - translated[0].y }).toEqual({ x: 80, y: 100 });
    expect({ moving, targets }).toEqual(before);
  });

  it('prefers same-anchor matches on ties, then centers, then stable target IDs', () => {
    const moving = [box('moving', 100, 250)];
    const matching = box('z-same-kind', 105, 0);
    const crossing = box('a-other-kind', -5, 0);
    const sameKind = alignShapes(moving, [crossing, matching], free);
    expect(sameKind.delta.x).toBe(5);
    expect(sameKind.guides[0].position).toBe(155);
    const center = alignShapes(moving, [box('a-edge', 105, 0, 40), box('z-center', 85, 0, 140)], free);
    expect(center.delta.x).toBe(5);
    expect(center.guides[0].position).toBe(155);
    const targetA = box('a-target', 105, 0);
    const targetZ = box('z-target', 95, 0);
    expect(alignShapes(moving, [targetZ, targetA], free)).toEqual(alignShapes(moving, [targetA, targetZ], free));
    expect(alignShapes(moving, [targetZ, targetA], free).delta.x).toBe(5);
  });

  it('excludes every moving ID even when supplied among stationary nodes', () => {
    const moving = [box('one', 101, 233), box('two', 251, 333)];
    expect(alignShapes(moving, moving, free)).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
    expect(alignShapes(moving, [box('one', 104, 230), box('two', 254, 330)], { zoom: 1, snapToGrid: true })).toEqual({ delta: { x: -5, y: 7 }, guides: [] });
  });

  it('keeps grid snapping when guides are disabled and supports a complete bypass', () => {
    const moving = [box('moving', 101, 233)];
    const stationary = [box('target', 105, 0)];
    expect(alignShapes(moving, stationary, { zoom: 1, snapToGrid: true, enabled: false })).toEqual({ delta: { x: -5, y: 7 }, guides: [] });
    expect(alignShapes(moving, stationary, { ...free, enabled: false })).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
  });

  it('handles negative fractional coordinates and exact matches at zero tolerance', () => {
    expect(alignShapes([box('moving', -17.25, -30.5)], [], { zoom: 1, snapToGrid: true })).toEqual({ delta: { x: 1.25, y: -1.5 }, guides: [] });
    const result = alignShapes([box('moving', -100.5, -200.25)], [box('target', -100.5, 100)], { ...free, tolerance: 0 });
    expect(result.delta).toEqual({ x: 0, y: 0 });
    expect(result.guides).toEqual([{ axis: 'x', position: -50.5, start: -200.25, end: 180 }]);
  });

  it('does not snap outside the tolerance or invent guides with no moving boxes', () => {
    expect(alignShapes([box('moving', 107, 207)], [box('target', 100, 100)], free)).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
    expect(alignShapes([], [box('target', 100, 100)], { zoom: 1, snapToGrid: true })).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
  });

  it('normalizes invalid zoom and tolerance and ignores nonfinite geometry', () => {
    const moving = [box('moving', 104, 250)];
    const target = [box('target', 100, 0)];
    expect(alignShapes(moving, target, { ...free, zoom: Number.NaN })).toEqual(alignShapes(moving, target, free));
    expect(alignShapes(moving, target, { ...free, zoom: 0, tolerance: -1 })).toEqual(alignShapes(moving, target, free));
    expect(alignShapes(moving, target, { ...free, zoom: 100 }).guides).toEqual([]);
    expect(alignShapes([box('moving', 154, 250)], target, { ...free, zoom: 0.001 }).delta.x).toBe(-4);
    expect(alignShapes(moving, [box('invalid', Number.NaN, 0)], free)).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
    expect(alignShapes([box('invalid', 0, Infinity)], target, free)).toEqual({ delta: { x: 0, y: 0 }, guides: [] });
  });
});
