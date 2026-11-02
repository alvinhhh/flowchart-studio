import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type Point = { x: number; y: number; pressure: number };
type Stroke = { id: string; points: Point[]; color: string; width: number };
type Diagram = { title: string; nodes: Array<{ id: string; position: { x: number; y: number } }>; drawings: Stroke[]; viewport: { x: number; y: number; zoom: number } };

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

async function blank(page: Page, title: string, viewport?: { x: number; y: number; zoom: number }) {
  await page.goto('/app');
  if (viewport) {
    const date = '2026-11-02T00:00:00.000Z';
    const fixture = { schemaVersion: 1, documentId: 'drawing-fixture', title, createdAt: date, updatedAt: date, revision: 0,
      nodes: [], edges: [], drawings: [], viewport, settings: { snapToGrid: false, gridVisible: false, background: 'blank' } };
    await page.locator('input[type="file"]').setInputFiles({ name: 'drawing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  } else {
    const field = page.getByRole('textbox', { name: 'Diagram title', exact: true });
    await field.fill(title);
    await field.press('Enter');
  }
  await expect.poll(async () => !!await saved(page, title)).toBe(true);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
}

test('the default tool pans, Select lassos, and Space temporarily pans from Draw without a stroke', async ({ page }) => {
  await page.goto('/app');
  const title = 'Pan select and draw';
  const date = '2026-11-02T00:00:00.000Z';
  const fixture = { schemaVersion: 1, documentId: 'canvas-tools', title, createdAt: date, updatedAt: date, revision: 0, drawings: [],
    nodes: ['a', 'b'].map((id, index) => ({ id, type: 'process', position: { x: 100 + index * 260, y: 120 }, width: 176, height: 80, label: id, notes: '', style: { color: 'neutral' } })), edges: [],
    viewport: { x: 60, y: 50, zoom: 0.85 }, settings: { snapToGrid: false, gridVisible: false, background: 'blank' } };
  await page.locator('input[type="file"]').setInputFiles({ name: 'tools.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  await expect.poll(async () => !!await saved(page, title)).toBe(true);
  const original = (await saved(page, title))!;
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  const start = { x: pane.x + pane.width * 0.68, y: pane.y + pane.height * 0.65 };
  await drag(page, start, { x: start.x + 80, y: start.y + 45 });
  await expect.poll(async () => (await saved(page, title))?.viewport).not.toEqual(original.viewport);
  await expect(page.locator('.react-flow__selection')).toHaveCount(0);
  expect((await saved(page, title))!.nodes.map(node => node.position)).toEqual(original.nodes.map(node => node.position));
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const first = (await page.locator('.react-flow__node[data-id="a"]').boundingBox())!;
  const second = (await page.locator('.react-flow__node[data-id="b"]').boundingBox())!;
  await drag(page, { x: first.x - 20, y: first.y - 20 }, { x: second.x + second.width + 20, y: second.y + second.height + 20 });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const beforeSpace = (await saved(page, title))!;
  const currentPane = (await page.locator('.react-flow__pane').boundingBox())!;
  const panStart = { x: currentPane.x + currentPane.width * 0.65, y: currentPane.y + currentPane.height * 0.7 };
  await page.keyboard.down('Space');
  try { await drag(page, panStart, { x: panStart.x - 65, y: panStart.y + 35 }); }
  finally { await page.keyboard.up('Space'); }
  await expect.poll(async () => (await saved(page, title))?.viewport).not.toEqual(beforeSpace.viewport);
  expect((await saved(page, title))!.drawings).toHaveLength(0);
  await expect(page.locator('.drawing-stroke')).toHaveCount(0);
  await expect(page.locator('.drawing-input')).toBeVisible();
});

test('mouse strokes survive erasing, one-step undo and redo, reload, and PNG export', async ({ page }, testInfo) => {
  const title = 'Saved freehand drawing';
  await blank(page, title, { x: -4000, y: -1800, zoom: 1 });
  await page.getByRole('combobox', { name: 'Background', exact: true }).selectOption('blank');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const input = (await page.locator('.drawing-input').boundingBox())!;
  const from = { x: input.x + 180, y: input.y + 230 };
  const to = { x: input.x + 460, y: input.y + 270 };
  await drag(page, from, to);
  await expect(page.locator('.drawing-stroke')).toHaveCount(1);
  await expect.poll(async () => (await saved(page, title))?.drawings.length).toBe(1);
  const stroke = (await saved(page, title))!.drawings[0];
  expect(stroke.points.length).toBeGreaterThan(5);
  expect(stroke.points[0].x).toBeGreaterThan(4000);
  expect(stroke.points[0].y).toBeGreaterThan(1800);
  expect(stroke.points.every(point => point.pressure === 0.5)).toBe(true);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await drag(page, { x: from.x + 80, y: from.y + 8 }, { x: from.x + 180, y: from.y + 26 });
  await expect(page.locator('.drawing-stroke')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.drawing-stroke')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.drawing-stroke')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page, title))?.drawings[0]).toEqual(stroke);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(title);
  await expect(page.locator('.drawing-stroke')).toHaveCount(1);
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: 'outputs/drawing-preview.png' });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloadEvent;
  const buffer = await readFile((await download.path())!);
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const darkPixels = await page.evaluate(async base64 => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = `data:image/png;base64,${base64}`; });
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 160 && pixels[index + 1] < 160 && pixels[index + 2] < 160 && pixels[index + 3]) dark++;
    return dark;
  }, buffer.toString('base64'));
  expect(darkPixels).toBeGreaterThan(100);
});

test('scripted pen pressure is saved and changes stroke thickness without claiming tablet hardware verification', async ({ page }) => {
  const title = 'Scripted pressure input';
  await blank(page, title);
  await page.getByRole('combobox', { name: 'Background', exact: true }).selectOption('blank');
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.locator('.drawing-input').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const points = [[150, 0.12], [200, 0.12], [250, 0.12], [350, 0.9], [400, 0.9], [450, 0.9]];
    for (let index = 0; index < points.length; index++) element.dispatchEvent(new PointerEvent(index ? 'pointermove' : 'pointerdown', {
      bubbles: true, cancelable: true, composed: true, pointerId: 71, pointerType: 'pen', isPrimary: true,
      button: 0, buttons: 1, clientX: rect.x + points[index][0], clientY: rect.y + 250, pressure: points[index][1], width: 2, height: 2,
    }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 71, pointerType: 'pen', isPrimary: true, button: 0, buttons: 0, clientX: rect.x + 450, clientY: rect.y + 250, pressure: 0 }));
  });
  await expect(page.locator('.drawing-stroke')).toHaveCount(1);
  await expect.poll(async () => (await saved(page, title))?.drawings.length).toBe(1);
  const stroke = (await saved(page, title))!.drawings[0];
  expect(Math.min(...stroke.points.map(point => point.pressure))).toBeLessThanOrEqual(0.15);
  expect(Math.max(...stroke.points.map(point => point.pressure))).toBeGreaterThanOrEqual(0.85);
  const thickness = await page.locator('.drawing-stroke').evaluate(element => {
    const path = element as SVGPathElement;
    const box = path.getBBox();
    function inkAt(fraction: number) {
      let ink = 0;
      for (let y = box.y; y <= box.y + box.height; y += 0.1) if (path.isPointInFill(new DOMPoint(box.x + box.width * fraction, y))) ink += 0.1;
      return ink;
    }
    return { low: inkAt(0.2), high: inkAt(0.78) };
  });
  expect(thickness.low).toBeGreaterThan(0);
  expect(thickness.high).toBeGreaterThan(thickness.low * 1.25);
});
