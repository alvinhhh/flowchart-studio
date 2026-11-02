import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type Point = { x: number; y: number };
type Shape = { id: string; position: Point; width: number; height: number; label: string };
type Diagram = { title: string; nodes: Shape[]; edges: Array<{ id: string; source: string; target: string; sourceHandle: string; targetHandle: string }> };
const modelGeometry = (node: Shape) => ({ position: node.position, width: node.width, height: node.height });
const flowNode = (page: Page) => page.locator('.react-flow__node[data-id="resizable"]');
const corner = (page: Page, name: 'bottom.right' | 'top.left') => flowNode(page).locator(`.shape-resize-handle.${name}`);

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

async function resized(page: Page, title: string) {
  return (await saved(page, title))!.nodes.find(node => node.id === 'resizable')!;
}

async function prepare(page: Page, title: string, large = false) {
  await page.goto('/app');
  const date = '2026-11-02T00:00:00.000Z';
  const fixture = { schemaVersion: 1, documentId: 'resize-fixture', title, createdAt: date, updatedAt: date, revision: 0,
    nodes: [{ id: 'resizable', type: 'process', position: { x: 120, y: 120 }, width: large ? 1900 : 176, height: large ? 1900 : 80,
      label: large ? 'An important approval step' : 'Resize me', notes: '', style: { color: 'blue' } },
    ...large ? [] : [{ id: 'fixed', type: 'process', position: { x: 600, y: 160 }, width: 176, height: 80, label: 'Next', notes: '', style: { color: 'neutral' } }]],
    edges: large ? [] : [{ id: 'attached', source: 'resizable', target: 'fixed', sourceHandle: 'right', targetHandle: 'left', label: 'Continue', style: { color: 'neutral' } }],
    drawings: [], viewport: { x: 61, y: 49, zoom: large ? 0.25 : 0.75 }, settings: { snapToGrid: false, gridVisible: false, background: 'blank' } };
  await page.locator('input[type="file"]').setInputFiles({ name: 'resize.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  await expect.poll(async () => !!await saved(page, title)).toBe(true);
  await expect(flowNode(page)).toBeVisible();
  await expect(flowNode(page).locator('.shape-resize-handle')).toHaveCount(0);
  await flowNode(page).click();
  await expect(flowNode(page).locator('.shape-resize-handle')).toHaveCount(4);
}

async function holdCorner(page: Page, name: 'bottom.right' | 'top.left', delta: Point) {
  const handle = corner(page, name);
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const end = { x: start.x + delta.x, y: start.y + delta.y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 18 });
  return end;
}

async function assertAttachment(page: Page) {
  await expect.poll(async () => {
    const path = await page.locator('.react-flow__edge[data-id="attached"] .react-flow__edge-path').getAttribute('d');
    const values = (path?.match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
    const handle = await flowNode(page).locator('.react-flow__handle[data-handleid="right"]').evaluate(element => {
      const box = element.getBoundingClientRect();
      const root = element.closest('.react-flow')!;
      const origin = root.getBoundingClientRect();
      const matrix = new DOMMatrix(getComputedStyle(root.querySelector('.react-flow__viewport')!).transform);
      return { x: (box.right - origin.x - matrix.e) / matrix.a, y: (box.y + box.height / 2 - origin.y - matrix.f) / matrix.a };
    });
    return Math.max(Math.abs(values[0] - handle.x), Math.abs(values[1] - handle.y));
  }).toBeLessThan(0.5);
}

async function pngDimensions(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await event;
  const buffer = await readFile((await download.path())!);
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

for (const name of ['bottom.right', 'top.left'] as const) {
  test(`${name.replace('.', '-')} resizing keeps the opposite corner fixed and persists one undoable geometry change`, async ({ page }, testInfo) => {
    const title = `Resize ${name}`;
    await prepare(page, title);
    const original = await resized(page, title);
    const beforePng = name === 'bottom.right' ? await pngDimensions(page) : undefined;
    const beforePath = await page.locator('.react-flow__edge-path').getAttribute('d');
    const end = await holdCorner(page, name, name === 'bottom.right' ? { x: 120, y: 96 } : { x: -60, y: -48 });
    const live = (await flowNode(page).boundingBox())!;
    await expect.poll(async () => Number(await flowNode(page).locator('.shape-node > svg').getAttribute('width'))).toBeGreaterThan(original.width + 50);
    expect(Math.abs((name === 'bottom.right' ? live.x + live.width : live.x) - end.x)).toBeLessThan(6);
    expect(Math.abs((name === 'bottom.right' ? live.y + live.height : live.y) - end.y)).toBeLessThan(6);
    await expect(page.locator('.react-flow__edge-path')).not.toHaveAttribute('d', beforePath!);
    await assertAttachment(page);
    if (name === 'bottom.right' && testInfo.project.name === 'chromium') await page.screenshot({ path: 'outputs/resize-preview.png' });
    await page.mouse.up();
    await expect.poll(async () => (await resized(page, title)).width).toBeGreaterThan(original.width + 50);
    const changed = await resized(page, title);
    expect(changed.height).toBeGreaterThan(original.height + 30);
    if (name === 'bottom.right') expect(changed.position).toEqual(original.position);
    else {
      expect(changed.position.x + changed.width).toBeCloseTo(original.position.x + original.width, 5);
      expect(changed.position.y + changed.height).toBeCloseTo(original.position.y + original.height, 5);
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => modelGeometry(await resized(page, title))).toEqual(modelGeometry(original));
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(async () => modelGeometry(await resized(page, title))).toEqual(modelGeometry(changed));
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
    expect(modelGeometry(await resized(page, title))).toEqual(modelGeometry(changed));
    await assertAttachment(page);
    if (beforePng) {
      const afterPng = await pngDimensions(page);
      expect(afterPng.height).toBeGreaterThan(beforePng.height);
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
      const download = await event;
      const json = JSON.parse(await readFile((await download.path())!, 'utf8'));
      expect(modelGeometry(json.nodes.find((node: Shape) => node.id === 'resizable'))).toEqual(modelGeometry(changed));
    }
  });
}

test('extreme corner drags clamp dimensions and keep the label inside the shape', async ({ page }) => {
  const title = 'Clamped resize';
  await prepare(page, title, true);
  await holdCorner(page, 'bottom.right', { x: 120, y: 120 });
  await page.mouse.up();
  await expect.poll(async () => { const node = await resized(page, title); return { width: node.width, height: node.height }; }).toEqual({ width: 2000, height: 2000 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await resized(page, title)).width).toBe(1900);
  const box = (await flowNode(page).boundingBox())!;
  const handle = (await corner(page, 'bottom.right').boundingBox())!;
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(box.x + 1, box.y + 1, { steps: 24 }); await page.mouse.up();
  await expect.poll(async () => (await resized(page, title)).width).toBeLessThan(1900);
  const small = await resized(page, title);
  expect(small.width).toBeGreaterThan(0);
  expect(small.height).toBeGreaterThan(0);
  const contained = await flowNode(page).locator('.shape-node > svg > text').evaluate(element => {
    const box = (element as SVGGraphicsElement).getBBox();
    const outline = element.parentElement!.querySelector('path')! as SVGGeometryElement;
    return [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].every(([x, y]) => outline.isPointInFill(new DOMPoint(x, y)));
  });
  expect(contained).toBe(true);
});

test('a selected node exposes no resize handles after the tab becomes read-only', async ({ page, context }) => {
  const title = 'Read-only resize';
  await prepare(page, title);
  const before = modelGeometry(await resized(page, title));
  const second = await context.newPage(); await second.goto('/app');
  const input = second.getByRole('textbox', { name: 'Diagram title', exact: true });
  await expect(input).toHaveValue(title);
  await input.fill('Edited elsewhere'); await input.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: /another tab|read-only/i })).toBeVisible();
  await expect(flowNode(page).locator('.shape-resize-handle')).toHaveCount(0);
  const stored = await saved(second, 'Edited elsewhere');
  expect(modelGeometry(stored!.nodes.find(node => node.id === 'resizable')!)).toEqual(before);
});
