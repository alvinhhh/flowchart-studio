import { expect, test, type Locator, type Page } from '@playwright/test';

type Point = { x: number; y: number };
type Shape = { id: string; type: string; position: Point; width: number; height: number; label: string; notes: string; style: { color: string } };
type Diagram = { documentId: string; title: string; nodes: Shape[]; edges: Array<{ source: string; target: string }> };
const viewport = { x: 83, y: 61, zoom: 0.75 };
const guides = (page: Page) => page.locator('.alignment-guide');
const shape = (id: string, x: number, y: number, width = 176): Shape => ({ id, type: 'process', position: { x, y }, width, height: 80, label: id, notes: '', style: { color: 'neutral' } });

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

async function prepare(page: Page, title: string, nodes: Shape[], grid = false, connected = false) {
  await page.goto('/app');
  const date = '2026-11-02T00:00:00.000Z';
  const fixture = { schemaVersion: 1, documentId: 'alignment-fixture', title, createdAt: date, updatedAt: date, revision: 0, nodes,
    edges: connected ? [{ id: 'attachment', source: nodes[0].id, target: nodes.at(-1)!.id, sourceHandle: 'right', targetHandle: 'left', label: '', style: { color: 'neutral' } }] : [],
    viewport, settings: { snapToGrid: grid, gridVisible: true } };
  await page.locator('input[type="file"]').setInputFiles({ name: 'alignment.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  await expect.poll(async () => !!await saved(page, title)).toBe(true);
  await expect.poll(async () => page.locator('.react-flow__viewport').evaluate(element => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  })).toEqual(viewport);
  await expect(page.getByRole('checkbox', { name: 'Align shapes', exact: true })).toBeChecked();
}

const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

async function destination(page: Page, position: Point, width = 176, height = 80) {
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  const point = {
    x: Math.round(pane.x + viewport.x + (position.x + width / 2) * viewport.zoom),
    y: Math.round(pane.y + viewport.y + (position.y + height / 2) * viewport.zoom),
  };
  return {
    point,
    rawPosition: { x: (point.x - pane.x - viewport.x) / viewport.zoom - width / 2, y: (point.y - pane.y - viewport.y) / viewport.zoom - height / 2 },
    pane,
  };
}

async function holdDrag(page: Page, source: Locator, target: Point) {
  await source.scrollIntoViewIfNeeded();
  const box = (await source.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 2, { steps: 4 });
  const activeBox = (await source.boundingBox())!;
  const anchorOffset = { x: start.x + 12 - activeBox.x - activeBox.width / 2, y: start.y + 2 - activeBox.y - activeBox.height / 2 };
  await page.mouse.move(target.x, target.y, { steps: 18 });
  await page.mouse.move(target.x + 1, target.y + 1);
  await page.mouse.move(target.x, target.y);
  return anchorOffset;
}

async function storedPosition(page: Page, title: string, id: string) {
  return (await saved(page, title))!.nodes.find(item => item.id === id)!.position;
}

const precisePoint = (point: Point) => ({ x: Math.round(point.x * 10000) / 10000, y: Math.round(point.y * 10000) / 10000 });

test('edge alignment shows a guide while held and one undo restores movement and connector geometry', async ({ page }) => {
  const title = 'Edge alignment';
  await prepare(page, title, [shape('moving', 80, 80), shape('fixed', 400, 300)], false, true);
  const edge = page.locator('.react-flow__edge-path');
  const originalPath = await edge.getAttribute('d');
  const target = await destination(page, { x: 403, y: 125 });
  await holdDrag(page, node(page, 'moving'), target.point);
  await expect.poll(() => guides(page).count()).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(guides(page)).toHaveCount(0);
  await expect.poll(async () => (await storedPosition(page, title, 'moving')).x).toBeCloseTo(400, 6);
  await expect(edge).not.toHaveAttribute('d', originalPath!);
  expect((await saved(page, title))!.edges).toEqual([expect.objectContaining({ source: 'moving', target: 'fixed' })]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => storedPosition(page, title, 'moving')).toEqual({ x: 80, y: 80 });
  await expect(edge).toHaveAttribute('d', originalPath!);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await storedPosition(page, title, 'moving')).x).toBeCloseTo(400, 6);
});

test('center alignment takes precedence over the grid and the alignment toggle disables guides', async ({ page }) => {
  const title = 'Center alignment';
  await prepare(page, title, [shape('moving', 80, 80), shape('fixed', 403, 340, 240)], true);
  const target = await destination(page, { x: 438, y: 128 });
  await holdDrag(page, node(page, 'moving'), target.point);
  await expect.poll(() => guides(page).count()).toBeGreaterThan(0);
  await page.mouse.up();
  await expect.poll(async () => (await storedPosition(page, title, 'moving')).x).toBeCloseTo(435, 6);
  await page.getByRole('checkbox', { name: 'Align shapes', exact: true }).uncheck();
  const unaligned = await destination(page, { x: 406, y: 177 });
  await holdDrag(page, node(page, 'moving'), unaligned.point);
  await expect(guides(page)).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => precisePoint(await storedPosition(page, title, 'moving'))).toEqual({ x: Math.round(unaligned.rawPosition.x / 16) * 16, y: Math.round(unaligned.rawPosition.y / 16) * 16 });
});

test('aligning a selection moves the whole group without changing its internal offsets', async ({ page }) => {
  const title = 'Group alignment';
  await prepare(page, title, [shape('moving', 80, 100), shape('companion', 80, 240), shape('fixed', 400, 420)]);
  await node(page, 'moving').click();
  await node(page, 'companion').click({ modifiers: ['Shift'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  const target = await destination(page, { x: 403, y: 145 });
  await holdDrag(page, node(page, 'moving'), target.point);
  await expect.poll(() => guides(page).count()).toBeGreaterThan(0);
  await page.mouse.up();
  await expect.poll(async () => (await storedPosition(page, title, 'moving')).x).toBeCloseTo(400, 6);
  const first = await storedPosition(page, title, 'moving');
  const second = await storedPosition(page, title, 'companion');
  expect(precisePoint({ x: second.x - first.x, y: second.y - first.y })).toEqual({ x: 0, y: 140 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => storedPosition(page, title, 'moving')).toEqual({ x: 80, y: 100 });
  await expect.poll(() => storedPosition(page, title, 'companion')).toEqual({ x: 80, y: 240 });
});

test('the palette preview contains only the scaled shape and matches the aligned drop position', async ({ page }, testInfo) => {
  const title = 'Palette alignment preview';
  await prepare(page, title, [shape('fixed', 400, 300)]);
  const target = await destination(page, { x: 403, y: 100 });
  await holdDrag(page, page.getByRole('button', { name: 'Add Process', exact: true }), target.point);
  const preview = page.locator('.palette-shape-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('svg')).toHaveCount(1);
  await expect(preview.locator('text,.react-flow__handle')).toHaveCount(0);
  expect((await preview.innerText()).trim()).toBe('');
  await expect.poll(() => guides(page).count()).toBeGreaterThan(0);
  expect((await saved(page, title))!.nodes).toHaveLength(1);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  const box = (await preview.boundingBox())!;
  expect(box.width).toBeCloseTo(176 * viewport.zoom, 0);
  expect(box.height).toBeCloseTo(80 * viewport.zoom, 0);
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: 'outputs/alignment-preview.png' });
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect(guides(page)).toHaveCount(0);
  await expect.poll(async () => (await saved(page, title))?.nodes.length).toBe(2);
  const dropped = (await saved(page, title))!.nodes.find(item => item.id !== 'fixed')!;
  expect(dropped.position.x).toBeCloseTo(400, 6);
  expect(dropped.position.x).toBeCloseTo((box.x - target.pane.x - viewport.x) / viewport.zoom, 1);
  expect(dropped.position.y).toBeCloseTo((box.y - target.pane.y - viewport.y) / viewport.zoom, 1);
});

test('Alt bypasses both alignment and grid snapping for a moving shape and a palette drop', async ({ page }) => {
  const title = 'Alt bypass';
  await prepare(page, title, [shape('moving', 80, 80), shape('fixed', 400, 300)], true);
  const target = await destination(page, { x: 403, y: 137 });
  await page.keyboard.down('Alt');
  try {
    const anchor = await holdDrag(page, node(page, 'moving'), target.point);
    await expect(guides(page)).toHaveCount(0);
    await page.mouse.up();
    await expect.poll(async () => precisePoint(await storedPosition(page, title, 'moving'))).toEqual(precisePoint({ x: target.rawPosition.x - anchor.x / viewport.zoom, y: target.rawPosition.y - anchor.y / viewport.zoom }));
    const paletteTarget = await destination(page, { x: 404, y: 470 });
    await holdDrag(page, page.getByRole('button', { name: 'Add Process', exact: true }), paletteTarget.point);
    await expect(guides(page)).toHaveCount(0);
    await page.mouse.up();
    await expect.poll(async () => (await saved(page, title))?.nodes.length).toBe(3);
    const dropped = (await saved(page, title))!.nodes.find(item => !['moving', 'fixed'].includes(item.id))!;
    expect(precisePoint(dropped.position)).toEqual(precisePoint(paletteTarget.rawPosition));
  } finally {
    await page.keyboard.up('Alt');
  }
});

test('shapes outside the alignment threshold follow the pointer without showing guides', async ({ page }) => {
  const title = 'No distant alignment';
  await prepare(page, title, [shape('moving', 80, 80), shape('fixed', 400, 300)]);
  const target = await destination(page, { x: 427, y: 125 });
  const anchor = await holdDrag(page, node(page, 'moving'), target.point);
  await expect(guides(page)).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(async () => precisePoint(await storedPosition(page, title, 'moving'))).toEqual(precisePoint({ x: target.rawPosition.x - anchor.x / viewport.zoom, y: target.rawPosition.y - anchor.y / viewport.zoom }));
});
