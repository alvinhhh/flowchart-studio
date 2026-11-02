import { expect, test, type Locator, type Page } from '@playwright/test';

type Point = { x: number; y: number };
type StoredNode = { id: string; type: string; width: number; height: number; position: Point };
type StoredDiagram = { documentId: string; title: string; nodes: StoredNode[]; viewport: { x: number; y: number; zoom: number } };

async function documents(page: Page): Promise<StoredDiagram[]> {
  return page.evaluate(() => new Promise<StoredDiagram[]>((resolve, reject) => {
    const request = indexedDB.open('flowchart-studio');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('diagrams', 'readonly');
      const query = transaction.objectStore('diagrams').getAll();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}

async function documentByTitle(page: Page, title: string) {
  return (await documents(page)).find(doc => doc.title === title);
}

async function prepare(page: Page, title: string, snapToGrid: boolean) {
  await page.goto('/app');
  const viewport = { x: 123, y: 87, zoom: 0.7 };
  const date = '2026-11-02T00:00:00.000Z';
  const fixture = { schemaVersion: 1, documentId: `drag-${snapToGrid}`, title, createdAt: date, updatedAt: date, revision: 0,
    nodes: [], edges: [], viewport, settings: { snapToGrid, gridVisible: true } };
  await page.locator('input[type="file"]').setInputFiles({ name: 'drag.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  await expect.poll(async () => !!(await documentByTitle(page, title))).toBe(true);
  await expect.poll(async () => page.locator('.react-flow__viewport').evaluate(element => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  })).toEqual(viewport);
  return viewport;
}

async function canvasTarget(page: Page) {
  const bounds = (await page.locator('.react-flow__pane').boundingBox())!;
  return { point: { x: Math.round(bounds.x + bounds.width * 0.62), y: Math.round(bounds.y + bounds.height * 0.57) }, origin: { x: bounds.x, y: bounds.y } };
}

/** Uses the browser's native drag lifecycle, rather than dispatched drag events. */
async function pointerDrag(page: Page, source: Locator, target: Point, cancel = false) {
  const bounds = (await source.boundingBox())!;
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 14, start.y + 4, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 20 });
  // Both engines need a further move after drag initiation to deliver dragover.
  await page.mouse.move(target.x + 1, target.y + 1);
  await page.mouse.move(target.x, target.y);
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

async function singleDroppedNode(page: Page, title: string) {
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect.poll(async () => (await documentByTitle(page, title))?.nodes.length).toBe(1);
  return (await documentByTitle(page, title))!.nodes[0];
}

test('a palette drag places one snapped shape at the cursor under pan and zoom, with undo, redo and reload', async ({ page }) => {
  const title = 'Snapped palette drop';
  const viewport = await prepare(page, title, true);
  const target = await canvasTarget(page);
  await pointerDrag(page, page.getByRole('button', { name: 'Add Process', exact: true }), target.point);
  const node = await singleDroppedNode(page, title);
  expect(node.type).toBe('process');
  const centered = {
    x: (target.point.x - target.origin.x - viewport.x) / viewport.zoom - node.width / 2,
    y: (target.point.y - target.origin.y - viewport.y) / viewport.zoom - node.height / 2,
  };
  expect(node.position).toEqual({ x: Math.round(centered.x / 16) * 16, y: Math.round(centered.y / 16) * 16 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  const restored = await singleDroppedNode(page, title);
  expect(restored).toEqual(node);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  expect((await documentByTitle(page, title))!.nodes[0]).toEqual(node);
});

test('grid-free drops preserve cursor coordinates while click and keyboard addition remain available', async ({ page }) => {
  const title = 'Unsnapped palette drop';
  const viewport = await prepare(page, title, false);
  const target = await canvasTarget(page);
  await pointerDrag(page, page.getByRole('button', { name: 'Add Decision', exact: true }), target.point);
  const node = await singleDroppedNode(page, title);
  expect(node.type).toBe('decision');
  expect(node.position.x).toBeCloseTo((target.point.x - target.origin.x - viewport.x) / viewport.zoom - node.width / 2, 4);
  expect(node.position.y).toBeCloseTo((target.point.y - target.origin.y - viewport.y) / viewport.zoom - node.height / 2, 4);
  expect(node.position.x % 16 !== 0 || node.position.y % 16 !== 0).toBe(true);
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  const note = page.getByRole('button', { name: 'Add Note', exact: true });
  await note.focus();
  await note.press('Enter');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect.poll(async () => (await documentByTitle(page, title))?.nodes.map(item => item.type)).toEqual(['decision', 'process', 'note']);
});

test('dropping outside the canvas and canceling a native drag add no shapes', async ({ page }) => {
  const title = 'Canceled palette drop';
  await prepare(page, title, true);
  const header = (await page.locator('.editor-header').boundingBox())!;
  await pointerDrag(page, page.getByRole('button', { name: 'Add Process', exact: true }), { x: Math.round(header.x + header.width / 2), y: Math.round(header.y + header.height / 2) });
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  const target = await canvasTarget(page);
  await pointerDrag(page, page.getByRole('button', { name: 'Add Decision', exact: true }), target.point, true);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  expect((await documentByTitle(page, title))!.nodes).toHaveLength(0);
  // A canceled drag must not leave an active drag that interferes with a later click.
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
});

test('a stale read-only tab cannot start a palette drag or add a shape', async ({ page, context }) => {
  const title = 'Read-only palette';
  await prepare(page, title, true);
  const id = (await documentByTitle(page, title))!.documentId;
  const second = await context.newPage();
  await second.goto('/app');
  const titleField = second.getByRole('textbox', { name: 'Diagram title', exact: true });
  await expect(titleField).toHaveValue(title);
  await titleField.fill('Changed in another tab');
  await titleField.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: /another tab|read-only/i })).toBeVisible();
  const source = page.getByRole('button', { name: 'Add Process', exact: true });
  await expect(source).toBeDisabled();
  await expect(source).not.toHaveAttribute('draggable', 'true');
  const target = await canvasTarget(page);
  await pointerDrag(page, source, target.point);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  expect((await documents(page)).find(doc => doc.documentId === id)!.nodes).toHaveLength(0);
});
