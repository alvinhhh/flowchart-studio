import { expect, test, type Page } from '@playwright/test';

type Point = { x: number; y: number };
type Shape = { id: string; label: string; position: Point; width: number; height: number; groupId?: string; locked?: boolean };
type Edge = { id: string; source: string; target: string; waypoints?: Point[] };
type Diagram = { title: string; nodes: Shape[]; edges: Edge[] };
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const rounded = (value: number) => Math.round(value * 10000) / 10000;
const geometry = (doc: Diagram) => doc.nodes.map(node => ({ id: node.id, position: node.position, width: node.width, height: node.height }));

async function saved(page: Page, title: string): Promise<Diagram | undefined> {
  return page.evaluate(title => new Promise<Diagram | undefined>((resolve, reject) => {
    const request = indexedDB.open('flowchart-studio');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('diagrams', 'readonly');
      const query = transaction.objectStore('diagrams').getAll();
      query.onsuccess = () => resolve(query.result.find((doc: Diagram) => doc.title === title));
      query.onerror = () => reject(query.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), title);
}

function fixture(title: string, grouped = true, distribution = false) {
  const date = '2026-11-02T00:00:00.000Z';
  const positions = distribution ? [{ x: 40, y: 60 }, { x: 180, y: 150 }, { x: 420, y: 300 }, { x: 820, y: 480 }] : [{ x: 80, y: 100 }, { x: 280, y: 180 }, { x: 600, y: 100 }];
  const widths = distribution ? [100, 140, 180, 120] : [120, 160, 150];
  const nodes = positions.map((position, index) => ({ id: String.fromCharCode(97 + index), type: 'process', position, width: widths[index], height: distribution && index === 2 ? 100 : 80,
    label: String.fromCharCode(65 + index), notes: `Note ${index}`, style: { color: index === 0 ? 'blue' : 'neutral' }, ...grouped && index < 2 ? { groupId: 'original-group' } : {} }));
  return { schemaVersion: 1, documentId: 'editing-fixture', title, createdAt: date, updatedAt: date, revision: 0, nodes,
    edges: [
      { id: 'inside', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left', label: 'Internal', style: { color: 'blue' }, waypoints: [{ x: 230, y: 140 }, { x: 230, y: 220 }] },
      { id: 'outside', source: 'a', target: 'c', sourceHandle: 'top', targetHandle: 'top', label: 'External', style: { color: 'neutral' } },
    ], drawings: [], viewport: { x: 40, y: 45, zoom: 0.8 }, settings: { snapToGrid: false, gridVisible: false, background: 'blank' } };
}

async function prepare(page: Page, title: string, grouped = true, distribution = false) {
  await page.goto('/app');
  await page.locator('input[type="file"]').setInputFiles({ name: 'editing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture(title, grouped, distribution))) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  await expect.poll(async () => !!await saved(page, title)).toBe(true);
  await page.getByRole('checkbox', { name: 'Align shapes', exact: true }).uncheck();
}

async function newDocument(page: Page, title: string) {
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'New diagram', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Diagram title', exact: true });
  await input.fill(title); await input.press('Enter');
  await expect.poll(async () => !!await saved(page, title)).toBe(true);
}

async function dragNode(page: Page, id: string) {
  const box = (await node(page, id).boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y + 60, { steps: 20 }); await page.mouse.up();
}

function groupOffsets(doc: Diagram) {
  const a = doc.nodes.find(node => node.id === 'a')!, b = doc.nodes.find(node => node.id === 'b')!;
  return { x: rounded(b.position.x - a.position.x), y: rounded(b.position.y - a.position.y) };
}

function units(doc: Diagram) {
  const groups = new Map<string, Shape[]>();
  for (const node of doc.nodes) { const id = node.groupId ?? node.id; groups.set(id, [...groups.get(id) ?? [], node]); }
  return [...groups.values()].map(nodes => {
    const left = Math.min(...nodes.map(node => node.position.x));
    const top = Math.min(...nodes.map(node => node.position.y));
    const right = Math.max(...nodes.map(node => node.position.x + node.width));
    const bottom = Math.max(...nodes.map(node => node.position.y + node.height));
    return { left, top, right, bottom, center: (left + right) / 2, middle: (top + bottom) / 2 };
  });
}

test('copy, cut and paste preserve a grouped fragment across Documents while remapping identities and waypoints', async ({ page }) => {
  await page.addInitScript(() => {
    let content = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { content = text; }, readText: async () => content,
    } });
  });
  const sourceTitle = 'Clipboard source', destinationTitle = 'Clipboard destination';
  await prepare(page, sourceTitle);
  const original = (await saved(page, sourceTitle))!;
  await node(page, 'a').click();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.keyboard.press('Meta+c');
  await expect.poll(async () => page.evaluate(async () => JSON.parse(await navigator.clipboard.readText()).format)).toBe('flowchart-studio/selection');
  await newDocument(page, destinationTitle);
  await page.keyboard.press('Meta+v');
  await expect.poll(async () => (await saved(page, destinationTitle))?.nodes.length).toBe(2);
  const pasted = (await saved(page, destinationTitle))!;
  expect(pasted.edges).toHaveLength(1);
  const a = pasted.nodes.find(node => node.label === 'A')!, b = pasted.nodes.find(node => node.label === 'B')!;
  expect(['a', 'b']).not.toContain(a.id); expect(['a', 'b']).not.toContain(b.id);
  expect(a.id).not.toBe(b.id);
  expect(a.groupId).toBeTruthy(); expect(a.groupId).not.toBe('original-group'); expect(a.groupId).toBe(b.groupId);
  expect({ x: rounded(b.position.x - a.position.x), y: rounded(b.position.y - a.position.y) }).toEqual({ x: 200, y: 80 });
  expect(pasted.edges[0]).toMatchObject({ source: a.id, target: b.id });
  expect(pasted.edges[0].id).not.toBe('inside');
  const delta = { x: a.position.x - original.nodes[0].position.x, y: a.position.y - original.nodes[0].position.y };
  expect(pasted.edges[0].waypoints!.map(point => ({ x: rounded(point.x), y: rounded(point.y) }))).toEqual(original.edges[0].waypoints!.map(point => ({ x: rounded(point.x + delta.x), y: rounded(point.y + delta.y) })));
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.keyboard.press('Shift+Meta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await node(page, a.id).click();
  await page.keyboard.press('Meta+x');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await node(page, a.id).click();
  // The editor's fallback must also work when system clipboard permission is denied.
  await page.evaluate(() => {
    navigator.clipboard.readText = async () => { throw new DOMException('Denied for test', 'NotAllowedError'); };
    navigator.clipboard.writeText = async () => { throw new DOMException('Denied for test', 'NotAllowedError'); };
  });
  await page.getByRole('button', { name: 'Copy selection', exact: true }).click();
  await page.getByRole('button', { name: 'Paste', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.getByRole('button', { name: 'Cut selection', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('group selection, dragging and ungrouping keep member offsets and are individually undoable', async ({ page }) => {
  const title = 'Group gestures';
  await prepare(page, title, false);
  await node(page, 'a').click(); await node(page, 'b').click({ modifiers: ['Meta'] });
  await page.keyboard.press('Meta+g');
  await expect.poll(async () => (await saved(page, title))?.nodes.filter(node => node.groupId).length).toBe(2);
  const grouped = (await saved(page, title))!;
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await node(page, 'a').click();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await dragNode(page, 'b');
  await expect.poll(async () => geometry((await saved(page, title))!)).not.toEqual(geometry(grouped));
  const moved = (await saved(page, title))!;
  expect(groupOffsets(moved)).toEqual(groupOffsets(grouped));
  expect(moved.nodes.find(node => node.id === 'c')!.position).toEqual(grouped.nodes.find(node => node.id === 'c')!.position);
  const delta = { x: moved.nodes[0].position.x - grouped.nodes[0].position.x, y: moved.nodes[0].position.y - grouped.nodes[0].position.y };
  expect(moved.edges[0].waypoints!.map(point => ({ x: rounded(point.x), y: rounded(point.y) }))).toEqual(grouped.edges[0].waypoints!.map(point => ({ x: rounded(point.x + delta.x), y: rounded(point.y + delta.y) })));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => geometry((await saved(page, title))!)).toEqual(geometry(grouped));
  await page.getByRole('button', { name: 'Ungroup selection', exact: true }).click();
  await expect.poll(async () => (await saved(page, title))?.nodes.some(node => node.groupId)).toBe(false);
  await page.keyboard.press('Meta+z');
  await expect.poll(async () => (await saved(page, title))?.nodes.filter(node => node.groupId).length).toBe(2);
  await page.keyboard.press('Shift+Meta+g');
  await expect.poll(async () => (await saved(page, title))?.nodes.some(node => node.groupId)).toBe(false);
  await page.getByRole('button', { name: 'Group selection', exact: true }).click();
  await expect.poll(async () => (await saved(page, title))?.nodes.filter(node => node.groupId).length).toBe(2);
});

test('locks block group movement, resizing, labels, deletion and auto arrange, and survive reload until unlocked', async ({ page }) => {
  const title = 'Locked edits';
  await prepare(page, title);
  const original = (await saved(page, title))!;
  await node(page, 'a').click();
  await page.getByRole('button', { name: 'Lock selection', exact: true }).click();
  await expect.poll(async () => (await saved(page, title))?.nodes.filter(node => node.locked).length).toBe(2);
  await dragNode(page, 'a');
  expect(geometry((await saved(page, title))!)).toEqual(geometry(original));
  await page.keyboard.press('Backspace');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await node(page, 'c').click();
  await page.getByRole('button', { name: 'Lock selection', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Node label', exact: true })).toBeDisabled();
  await expect(node(page, 'c').locator('.shape-resize-handle')).toHaveCount(0);
  const arrange = page.getByRole('button', { name: 'Auto arrange', exact: true });
  if (await arrange.isEnabled()) { await arrange.click(); await expect(page.locator('.footer-notice')).toContainText(/arranged|locked/i); }
  await expect.poll(async () => (await saved(page, title))?.nodes.filter(node => node.locked).length).toBe(3);
  expect(geometry((await saved(page, title))!)).toEqual(geometry(original));
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  await node(page, 'c').click();
  await expect(page.getByRole('textbox', { name: 'Node label', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Unlock selection', exact: true }).click();
  const label = page.getByRole('textbox', { name: 'Node label', exact: true });
  await expect(label).toBeEnabled();
  await expect(node(page, 'c').locator('.shape-resize-handle')).toHaveCount(4);
  await label.fill('Unlocked text'); await label.press('Tab');
  await expect.poll(async () => (await saved(page, title))?.nodes.find(node => node.id === 'c')?.label).toBe('Unlocked text');
});

test('alignment and equal-gap distribution treat a group as one variable-sized unit', async ({ page }) => {
  const title = 'Align and distribute';
  await prepare(page, title, true, true);
  const original = (await saved(page, title))!;
  await node(page, 'a').click(); await page.keyboard.press('Meta+a');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(4);
  for (const mode of ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const) {
    await page.getByRole('button', { name: `Align ${mode}`, exact: true }).click();
    await expect.poll(async () => units((await saved(page, title))!).map(unit => rounded(unit[mode]))).toEqual(Array(3).fill({ left: 40, center: 490, right: 940, top: 60, middle: 310, bottom: 560 }[mode]));
    expect(groupOffsets((await saved(page, title))!)).toEqual(groupOffsets(original));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => geometry((await saved(page, title))!)).toEqual(geometry(original));
  }
  for (const [direction, gap] of [['horizontally', 160], ['vertically', 75]] as const) {
    await page.getByRole('button', { name: `Distribute ${direction}`, exact: true }).click();
    await expect.poll(async () => {
      const boxes = units((await saved(page, title))!).sort((a, b) => direction === 'horizontally' ? a.left - b.left : a.top - b.top);
      return boxes.slice(1).map((box, index) => rounded(direction === 'horizontally' ? box.left - boxes[index].right : box.top - boxes[index].bottom));
    }).toEqual([gap, gap]);
    expect(groupOffsets((await saved(page, title))!)).toEqual(groupOffsets(original));
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => geometry((await saved(page, title))!)).toEqual(geometry(original));
  }
});
