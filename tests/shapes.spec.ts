import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type Shape = { id: string; type: string; position: { x: number; y: number }; width: number; height: number; label: string; notes: string; style: { color: string } };
type Diagram = { title: string; nodes: Shape[]; drawings: unknown[]; edges: unknown[]; settings: { background: string } };

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

async function blank(page: Page, title: string) {
  await page.goto('/app');
  const input = page.getByRole('textbox', { name: 'Diagram title', exact: true });
  await input.fill(title); await input.press('Enter');
  await expect.poll(async () => !!await saved(page, title)).toBe(true);
}

test('all 32 categorized shapes are searchable, addable, portable, and retain their dimensions after auto arrange', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const title = 'Complete shape library';
  await blank(page, title);
  for (const group of ['Basic shapes', 'Process shapes', 'Data shapes', 'Routing shapes']) await expect(page.getByRole('region', { name: group, exact: true })).toBeVisible();
  const options = page.getByRole('button', { name: /^Add / });
  await expect(options).toHaveCount(32);
  const labels = await options.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!));
  expect(new Set(labels).size).toBe(32);
  const search = page.getByLabel('Search shapes', { exact: true });
  for (const label of labels) {
    await search.fill(label.replace(/^Add /, ''));
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  await search.fill('no-such-shape-123');
  await expect(options).toHaveCount(0);
  await search.clear();
  await expect(options).toHaveCount(32);
  await expect.poll(async () => (await saved(page, title))?.nodes.length).toBe(32);
  const before = (await saved(page, title))!;
  expect(new Set(before.nodes.map(node => node.type)).size).toBe(32);
  await page.getByRole('button', { name: 'Auto arrange', exact: true }).click();
  await expect(page.locator('.footer-notice')).toContainText(/arranged/i);
  await expect(page.getByRole('status')).toContainText('Saved');
  const arranged = (await saved(page, title))!;
  const contents = (doc: Diagram) => doc.nodes.map(node => ({ id: node.id, type: node.type, width: node.width, height: node.height, label: node.label, notes: node.notes, style: node.style }));
  expect(contents(arranged)).toEqual(contents(before));
  for (let i = 0; i < arranged.nodes.length; i++) for (let j = i + 1; j < arranged.nodes.length; j++) {
    const a = arranged.nodes[i], b = arranged.nodes[j];
    expect(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y).toBe(true);
  }
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadEvent;
  const json = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(json.nodes).toEqual(arranged.nodes);
  expect(json.drawings).toEqual([]);
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await fresh.goto('http://127.0.0.1:3000/app');
    await fresh.locator('input[type="file"]').setInputFiles({ name: 'all-shapes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    await expect.poll(async () => (await saved(fresh, title))?.nodes.length).toBe(32);
    expect((await saved(fresh, title))!.nodes).toEqual(arranged.nodes);
  } finally { await context.close(); }
});

test('background choices render as dots, graph paper and blank, and survive reload', async ({ page }) => {
  const title = 'Background choices';
  await blank(page, title);
  const background = page.getByRole('combobox', { name: 'Background', exact: true });
  await background.selectOption('graph');
  await expect(page.locator('.react-flow__background pattern path')).not.toHaveCount(0);
  await expect.poll(async () => (await saved(page, title))?.settings.background).toBe('graph');
  await page.reload();
  await expect(background).toHaveValue('graph');
  await background.selectOption('blank');
  await expect(page.locator('.react-flow__background')).toHaveCount(0);
  await expect.poll(async () => (await saved(page, title))?.settings.background).toBe('blank');
  await page.reload();
  await expect(background).toHaveValue('blank');
  await background.selectOption('dots');
  await expect(page.locator('.react-flow__background pattern circle')).not.toHaveCount(0);
  await expect.poll(async () => (await saved(page, title))?.settings.background).toBe('dots');
});

test('irregular shapes preview their actual outline at canvas zoom and drop without an early saved node', async ({ page }, testInfo) => {
  const title = 'Irregular shape previews';
  await page.goto('/app');
  const date = '2026-11-02T00:00:00.000Z';
  const viewport = { x: 90, y: 60, zoom: 0.8 };
  const fixture = { schemaVersion: 1, documentId: 'irregular', title, createdAt: date, updatedAt: date, revision: 0, nodes: [], edges: [], drawings: [], viewport, settings: { snapToGrid: false, gridVisible: false, background: 'blank' } };
  await page.locator('input[type="file"]').setInputFiles({ name: 'previews.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  await expect.poll(async () => !!await saved(page, title)).toBe(true);
  const labels = await page.getByRole('button', { name: /^Add / }).evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!));
  const representatives = ['Add Document', 'Add Paper tape', 'Add Database'];
  for (const label of representatives) expect(labels).toContain(label);
  const paths: string[] = [];
  for (let index = 0; index < representatives.length; index++) {
    await page.getByLabel('Search shapes', { exact: true }).fill(representatives[index].replace(/^Add /, ''));
    const button = page.getByRole('button', { name: representatives[index], exact: true });
    await button.scrollIntoViewIfNeeded();
    const source = (await button.boundingBox())!;
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    const target = { x: Math.round(pane.x + pane.width * (0.35 + index * 0.18)), y: Math.round(pane.y + pane.height * (0.35 + index * 0.14)) };
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 24 });
    const preview = page.locator('.palette-shape-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('text,.react-flow__handle')).toHaveCount(0);
    const path = (await preview.locator('path').getAttribute('d'))!;
    paths.push(path);
    const box = (await preview.boundingBox())!;
    expect((await saved(page, title))!.nodes).toHaveLength(index);
    if (!index && testInfo.project.name === 'chromium') await page.screenshot({ path: 'outputs/expanded-shape-preview.png' });
    await page.mouse.up();
    await expect.poll(async () => (await saved(page, title))?.nodes.length).toBe(index + 1);
    const dropped = (await saved(page, title))!.nodes[index];
    expect(box.width).toBeCloseTo(dropped.width * viewport.zoom, 0);
    expect(box.height).toBeCloseTo(dropped.height * viewport.zoom, 0);
    await expect(page.locator(`.react-flow__node[data-id="${dropped.id}"] svg > path`).first()).toHaveAttribute('d', path);
  }
  expect(new Set(paths).size).toBe(3);
});
