import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createBackupArchive, prepareAllBackups } from './backup';
import { exampleDiagram, newDiagram, parseDiagram } from './diagram';

describe('all-document backups', () => {
  it('round trips every diagram without changing its portable contents', () => {
    const full = exampleDiagram();
    full.title = 'Review 漢字 🧭';
    full.nodes[0].notes = 'Private notes\n<&> " \\ 🎨';
    full.nodes[0].locked = true;
    full.nodes[0].groupId = full.nodes[1].groupId = 'group-1';
    full.edges[0].waypoints = [{ x: -14.5, y: 51 }];
    full.drawings = [{ id: 'stroke-1', color: 'blue', width: 3, points: [{ x: -12, y: 8, pressure: 0.5 }, { x: 100, y: 23, pressure: 0.8 }] }];
    full.viewport = { x: -81.25, y: 99.5, zoom: 0.8 };
    full.settings.background = 'graph';
    const documents = [full, newDiagram('Empty diagram')];
    const before = JSON.stringify(documents);
    const entries = unzipSync(createBackupArchive(documents));
    expect(Object.keys(entries)).toHaveLength(2);
    expect(Object.values(entries).map(bytes => parseDiagram(strFromU8(bytes)))).toEqual(documents);
    expect(strFromU8(entries['Review 漢字 🧭.json'])).toBe(`${JSON.stringify(full, null, 2)}\n`);
    expect(JSON.stringify(documents)).toBe(before);
  });

  it('uses safe, unique flat filenames including collisions, reserved names and Unicode', () => {
    const titles = ['../folder\\bad:?.', '..', 'CON', 'Same', 'same', 'Same (2)', 'e\u0301', 'é', '__proto__', '🧭'.repeat(180)];
    const docs = titles.map(title => newDiagram(title));
    const entries = unzipSync(createBackupArchive(docs));
    const names = Object.keys(entries);
    expect(names).toHaveLength(docs.length);
    expect(new Set(names.map(name => name.toLowerCase())).size).toBe(docs.length);
    for (const name of names) {
      expect(name).toMatch(/\.json$/);
      expect(name).not.toMatch(/^[.]|[\u0000-\u001f<>:"/\\|?*]/);
      expect(name.length).toBeLessThanOrEqual(170);
      expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200);
      expect(name).not.toBe('CON.json');
    }
    expect(Object.values(entries).map(bytes => JSON.parse(strFromU8(bytes)).title)).toEqual(titles);
  });

  it('awaits the current save before reading all stored diagrams', async () => {
    let release!: (saved: boolean) => void;
    const flush = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
    const newest = newDiagram('Latest title before debounce');
    const list = vi.fn(async () => [newest, newDiagram('Another document')]);
    const pending = prepareAllBackups(flush, list);
    expect(list).not.toHaveBeenCalled();
    release(true);
    const result = await pending;
    expect(list).toHaveBeenCalledOnce();
    expect(result.count).toBe(2);
    expect(JSON.parse(strFromU8(unzipSync(result.bytes)['Latest title before debounce.json']))).toEqual(newest);
  });

  it('aborts when saving fails, without returning an outdated archive', async () => {
    const list = vi.fn(async () => [newDiagram('Old version')]);
    await expect(prepareAllBackups(async () => false, list)).rejects.toThrow('current diagram could not be saved');
    expect(list).not.toHaveBeenCalled();
  });

  it('propagates storage failures and rejects an empty list', async () => {
    await expect(prepareAllBackups(async () => true, async () => { throw new Error('Storage unavailable'); })).rejects.toThrow('Storage unavailable');
    await expect(prepareAllBackups(async () => { throw new Error('Save unavailable'); }, async () => [])).rejects.toThrow('Save unavailable');
    expect(() => createBackupArchive([])).toThrow('No saved diagrams');
  });
});
