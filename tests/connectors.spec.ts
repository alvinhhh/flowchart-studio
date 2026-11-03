import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type Saved = { title: string; edges: Array<{ id: string; waypoints?: Array<{ x: number; y: number }> }> };
const title = 'Connection bends';
function fixture(waypoints?: Array<{ x: number; y: number }>) {
  const timestamp = '2026-11-02T00:00:00.000Z';
  return {
    schemaVersion: 1, documentId: 'bend-fixture', title, createdAt: timestamp, updatedAt: timestamp, revision: 0,
    nodes: [
      { id: 'source', type: 'process', position: { x: 0, y: 100 }, width: 140, height: 80, label: 'Start', notes: '', style: { color: 'neutral' } },
      { id: 'target', type: 'process', position: { x: 650, y: 100 }, width: 140, height: 80, label: 'End', notes: '', style: { color: 'neutral' } },
      { id: 'obstacle', type: 'process', position: { x: 320, y: 80 }, width: 140, height: 140, label: 'Obstacle', notes: '', style: { color: 'neutral' } },
    ],
    edges: [{ id: 'connection', source: 'source', target: 'target', sourceHandle: 'right', targetHandle: 'left', label: '', style: { color: 'blue' }, ...(waypoints ? { waypoints } : {}) }],
    drawings: [], viewport: { x: 80, y: 80, zoom: 1 }, settings: { snapToGrid: true, gridVisible: true, background: 'dots' },
  };
}
async function saved(page: Page): Promise<Saved | undefined> {
  return page.evaluate(title => new Promise<Saved | undefined>((resolve, reject) => {
    const request = indexedDB.open('flowchart-studio');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('diagrams', 'readonly'), query = transaction.objectStore('diagrams').getAll();
      query.onsuccess = () => resolve(query.result.find((doc: Saved) => doc.title === title));
      query.onerror = () => reject(query.error); transaction.oncomplete = () => db.close();
    };
  }), title);
}
async function open(page: Page, waypoints?: Array<{ x: number; y: number }>) {
  await page.goto('/app');
  await page.locator('input[type="file"]').setInputFiles({ name: 'bends.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture(waypoints))) });
  await expect.poll(async () => (await saved(page))?.title).toBe(title);
  await selectEdge(page);
}
async function selectEdge(page: Page) {
  const edge = page.locator('.react-flow__edge').first();
  await edge.focus(); await edge.press('Enter');
  await expect(page.getByRole('button', { name: /^(Add|Move) connection bend / }).first()).toBeVisible();
}

test('bend drag is one undoable edit and is preserved in JSON and after reload', async ({ page }) => {
  await open(page);
  const control = page.getByRole('button', { name: /^Add connection bend / }).first();
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 - 70, { steps: 10 });
  expect((await saved(page))?.edges[0].waypoints).toBeUndefined();
  await page.mouse.up();
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints?.length).toBe(1);
  const points = (await saved(page))!.edges[0].waypoints!;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints).toBeUndefined();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints).toEqual(points);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as Saved;
  expect(exported.edges[0].waypoints).toEqual(points);
  await page.reload(); await selectEdge(page);
  await expect(page.getByRole('button', { name: 'Move connection bend 1', exact: true })).toBeVisible();
  expect((await saved(page))?.edges[0].waypoints).toEqual(points);
});

test('Escape discards a bend drag and keyboard input without changing exports or undo history', async ({ page }) => {
  await open(page, [{ x: 250, y: 20 }]);
  const control = page.getByRole('button', { name: 'Move connection bend 1', exact: true });
  await control.focus(); await control.press('ArrowRight');
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints).toEqual([{ x: 251, y: 20 }]);
  const initial = (await saved(page))!.edges[0].waypoints;
  const path = page.locator('.react-flow__edge-path').first(), before = await path.getAttribute('d');
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 50, { steps: 8 });
  await expect(path).not.toHaveAttribute('d', before!);
  await expect(control).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(path).toHaveAttribute('d', before!);
  expect((await saved(page))!.edges[0].waypoints).toEqual(initial);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as Saved;
  expect(exported.edges[0].waypoints).toEqual(initial);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints).toEqual([{ x: 250, y: 20 }]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints).toEqual(initial);
});

test('bend keyboard movement and removal are undoable', async ({ page }) => {
  await open(page, [{ x: 250, y: 20 }]);
  const control = page.getByRole('button', { name: 'Move connection bend 1', exact: true });
  await control.focus(); await control.press('ArrowRight');
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints).toEqual([{ x: 251, y: 20 }]);
  await control.press('Shift+ArrowDown');
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints).toEqual([{ x: 251, y: 30 }]);
  await control.dblclick();
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.edges[0].waypoints).toEqual([{ x: 251, y: 30 }]);
});

test('close facing connections stay compact in the canvas and SVG export', async ({ page }, testInfo) => {
  const diagram = fixture();
  const base = diagram.nodes[0];
  diagram.nodes = [
    { ...base, id: 'aligned-start', label: 'Start', position: { x: 0, y: 100 } },
    { ...base, id: 'aligned-end', label: 'Next step', position: { x: 170, y: 100 } },
    { ...base, id: 'offset-start', label: 'Review', position: { x: 0, y: 300 } },
    { ...base, id: 'offset-end', label: 'Continue', position: { x: 170, y: 345 } },
  ];
  diagram.edges = [
    { ...diagram.edges[0], id: 'aligned', source: 'aligned-start', target: 'aligned-end' },
    { ...diagram.edges[0], id: 'offset', source: 'offset-start', target: 'offset-end' },
  ];
  await page.goto('/app');
  await page.locator('input[type="file"]').setInputFiles({ name: 'close-connections.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(diagram)) });
  await expect.poll(async () => (await saved(page))?.edges.length).toBe(2);
  const paths = page.locator('.react-flow__edge-path');
  await expect(paths).toHaveCount(2);
  const handleBounds = (await page.locator('.react-flow__handle[data-handleid="right"]').first().boundingBox())!;
  const handleRadius = handleBounds.width / (2 * diagram.viewport.zoom);
  await expect(paths.nth(0)).toHaveAttribute('d', `M ${140 + handleRadius} 140 L ${170 - handleRadius} 140`);
  await expect(paths.nth(1)).toHaveAttribute('d', `M ${140 + handleRadius} 340 L 155 340 L 155 385 L ${170 - handleRadius} 385`);
  const displayed = await paths.evaluateAll(elements => elements.map(element => element.getAttribute('d')));
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG', exact: true }).click();
  const download = await pending;
  const svg = await readFile((await download.path())!, 'utf8');
  const exported = await page.evaluate(source => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    return [...document.querySelectorAll('path[marker-end]')].map(element => element.getAttribute('d'));
  }, svg);
  const coordinates = (path: string | null) => (path?.match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
  // Canvas connectors meet the visible handle edge; SVG connectors meet the shape contour.
  const normalized = displayed.map(path => {
    const points = coordinates(path);
    points[0] -= handleRadius; points[points.length - 2] += handleRadius;
    return points;
  });
  expect(exported.map(coordinates)).toEqual(normalized);
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: 'outputs/close-connections.png' });
});
