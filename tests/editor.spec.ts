import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

type StoredDiagram = { documentId: string; title: string; revision: number; nodes: Array<{ id: string; label: string; notes: string; position: { x: number; y: number } }>; edges: unknown[] };

async function storedDocuments(page: Page): Promise<StoredDiagram[]> {
  return page.evaluate(() => new Promise<StoredDiagram[]>((resolve, reject) => {
    const request = indexedDB.open('flowchart-studio');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('diagrams')) { db.close(); reject(new Error('Missing diagrams store')); return; }
      const transaction = db.transaction('diagrams', 'readonly');
      const query = transaction.objectStore('diagrams').getAll();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}

async function savedDocument(page: Page, title: string) {
  await expect.poll(async () => (await storedDocuments(page)).some(doc => doc.title === title)).toBe(true);
  return (await storedDocuments(page)).find(doc => doc.title === title)!;
}

async function newDocument(page: Page, title: string) {
  await page.goto('/app');
  await page.getByRole('textbox', { name: 'Diagram title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Diagram title', exact: true }).press('Enter');
  await savedDocument(page, title);
}

async function openDocument(page: Page, title: string) {
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Diagram title', exact: true });
  if (await input.isVisible()) {
    if (await input.inputValue() === title) return;
    await page.getByRole('button', { name: 'Documents', exact: true }).click();
  }
  await page.getByRole('dialog', { name: 'Documents', exact: true }).getByRole('button').filter({ hasText: title }).click();
  await expect(input).toHaveValue(title);
}

function diagramFixture(count = 2) {
  const createdAt = '2026-11-02T00:00:00.000Z';
  return {
    schemaVersion: 1, documentId: `fixture-${count}`, title: `Imported ${count} shapes`, createdAt, updatedAt: createdAt, revision: 0,
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `node-${index}`, type: index === 0 ? 'terminal' : 'process',
      position: { x: (index % 20) * 280, y: Math.floor(index / 20) * 150 },
      width: 180, height: 80, label: `Step ${index + 1}`, notes: '', style: { color: index % 2 ? 'blue' : 'neutral' },
    })),
    edges: count > 1 ? [{ id: 'edge-1', source: 'node-0', target: 'node-1', sourceHandle: 'right', targetHandle: 'left', label: 'Continue', style: { color: 'blue' } }] : [],
    viewport: { x: 80, y: 80, zoom: 1 }, settings: { snapToGrid: true, gridVisible: true },
  };
}

async function importJson(page: Page, value: unknown, name = 'diagram.json') {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

test('a fresh guest can create a diagram, edit Unicode labels and notes, and reopen it after reload', async ({ page }) => {
  const title = 'Travel 🧭 — 漢字';
  await newDocument(page, title);
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  const label = page.getByRole('textbox', { name: 'Node label', exact: true });
  await label.fill('確認 👨‍👩‍👧‍👦\nReview & approve <next>');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Keep this private note with the shape.');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).press('Tab');
  await expect.poll(async () => {
    const doc = (await storedDocuments(page)).find(doc => doc.title === title);
    return doc?.nodes.some(node => node.label.includes('確認') && node.notes.includes('private note'));
  }).toBe(true);
  await page.reload();
  await openDocument(page, title);
  await page.locator('.react-flow__node').first().click();
  await expect(label).toHaveValue('確認 👨‍👩‍👧‍👦\nReview & approve <next>');
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep this private note with the shape.');
});

test('delete and undo restore the selected shape, and duplicate creates an independent shape', async ({ page }) => {
  await newDocument(page, 'Undo changes');
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Original');
  const nodes = page.locator('.react-flow__node');
  const count = await nodes.count();
  await page.getByRole('button', { name: 'Duplicate selection', exact: true }).click();
  await expect(nodes).toHaveCount(count + 1);
  await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
  await expect(nodes).toHaveCount(count);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(nodes).toHaveCount(count + 1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(nodes).toHaveCount(count);
});

test('the programming example route opens once and preserves edits after reload', async ({ page }) => {
  await page.goto('/app?example=1');
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/app$/);
  await expect.poll(() => page.locator('.react-flow__node').count()).toBeGreaterThan(3);
  await expect.poll(() => page.locator('.react-flow__edge').count()).toBeGreaterThan(2);
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Edited example');
  await page.getByRole('textbox', { name: 'Node label', exact: true }).press('Tab');
  await expect.poll(async () => (await storedDocuments(page)).some(doc => doc.nodes.some(node => node.label === 'Edited example'))).toBe(true);
  const saved = await storedDocuments(page);
  expect(saved).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toBeVisible();
  await page.locator('.react-flow__node').first().click();
  await expect(page.getByRole('textbox', { name: 'Node label', exact: true })).toHaveValue('Edited example');
  const reopened = await storedDocuments(page);
  expect(reopened).toHaveLength(1);
  expect(reopened[0].documentId).toBe(saved[0].documentId);
});

test('documents can be created separately and switched without losing their titles', async ({ page }) => {
  await newDocument(page, 'First document');
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'New diagram', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Diagram title', exact: true });
  await title.fill('Second document');
  await title.press('Enter');
  await savedDocument(page, 'Second document');
  await openDocument(page, 'First document');
  await expect(title).toHaveValue('First document');
  expect((await storedDocuments(page)).map(doc => doc.title).sort()).toEqual(['First document', 'Second document']);
});

test('moving shapes and adding a connection persist, and undo restores incident connections after deletion', async ({ page }) => {
  await page.goto('/app');
  const fixture = diagramFixture();
  await importJson(page, fixture);
  const before = await savedDocument(page, fixture.title);
  const node = page.locator('.react-flow__node').filter({ hasText: 'Step 1' });
  await expect(node).toBeVisible();
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 70, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => {
    const after = await savedDocument(page, fixture.title);
    return after.nodes.find(item => item.id === before.nodes[0].id)?.position;
  }).not.toEqual(before.nodes[0].position);
  await page.getByRole('button', { name: 'Connect nodes', exact: true }).click();
  await page.getByRole('textbox', { name: 'New connection label', exact: true }).fill('Retry');
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await node.click();
  await page.getByRole('button', { name: 'Delete selection', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect.poll(async () => (await savedDocument(page, fixture.title)).edges.length).toBe(2);
});

test('text fields and dialogs keep Delete shortcuts from deleting selected shapes', async ({ page }) => {
  await newDocument(page, 'Field focus');
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Node label', exact: true });
  await field.fill('Safe editing');
  await field.press('ControlOrMeta+A');
  await field.press('Backspace');
  await expect(field).toHaveValue('');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await field.fill('After field edit');
  await field.press('Tab');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('dialog', { name: 'Help', exact: true }).getByRole('button', { name: 'Close dialog', exact: true }).press('Delete');
  await expect(page.getByRole('dialog', { name: 'Help', exact: true })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toContainText('After field edit');
});

test('JSON download imports in a fresh browser context with labels, notes, connections and settings intact', async ({ page, browser }) => {
  await page.goto('/app');
  const fixture = diagramFixture();
  fixture.nodes[1].notes = 'A note retained by portable JSON';
  fixture.nodes[1].label = 'Review 🧭';
  await importJson(page, fixture);
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(fixture.title);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const downloaded = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(downloaded.nodes).toEqual(fixture.nodes);
  expect(downloaded.edges).toEqual(fixture.edges);
  expect(downloaded.settings).toEqual({ ...fixture.settings, background: fixture.settings.gridVisible ? 'dots' : 'blank' });
  expect(downloaded.drawings).toEqual([]);
  const context = await browser.newContext();
  try {
    const freshPage = await context.newPage();
    await freshPage.goto('http://127.0.0.1:3000/app');
    await importJson(freshPage, downloaded);
    const saved = await savedDocument(freshPage, fixture.title);
    expect(saved.nodes).toEqual(fixture.nodes);
    expect(saved.edges).toEqual(fixture.edges);
  } finally {
    await context.close();
  }
});

test('a malformed import gives an actionable error and preserves the current document', async ({ page }) => {
  await newDocument(page, 'Keep this document');
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Keep this shape');
  await importJson(page, { ...diagramFixture(), schemaVersion: 99 });
  await expect(page.getByRole('alert').filter({ hasText: /version|supported|invalid|import/i })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue('Keep this document');
  await expect(page.getByRole('textbox', { name: 'Node label', exact: true })).toHaveValue('Keep this shape');
});

test('PNG download includes shapes beyond the viewport and stays within canvas limits', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/app');
  const fixture = diagramFixture();
  fixture.title = 'Full diagram PNG';
  fixture.nodes[0].position = { x: -300, y: -200 };
  fixture.nodes[1].position = { x: 4000, y: 1800 };
  await importJson(page, fixture);
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(fixture.title);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const buffer = await readFile((await download.path())!);
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  expect(width).toBeGreaterThan(4000);
  expect(height).toBeGreaterThan(1800);
  expect(Math.max(width, height)).toBeLessThanOrEqual(16_384);
  expect(width * height).toBeGreaterThan(16_000_000);
  expect(width * height).toBeLessThanOrEqual(64_000_000);
  const lowerRightHasContent = await page.evaluate(async (base64) => {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = `data:image/png;base64,${base64}`; });
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, image.width - 512, image.height - 512, 512, 512, 0, 0, 256, 256);
    const pixels = context.getImageData(0, 0, 256, 256).data;
    for (let index = 0; index < pixels.length; index += 16) {
      if (pixels[index + 3] > 0 && (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)) return true;
    }
    return false;
  }, buffer.toString('base64'));
  expect(lowerRightHasContent).toBe(true);
});

test('simultaneous edits in two tabs expose a conflict instead of silently overwriting', async ({ page, context }) => {
  await newDocument(page, 'Two tab document');
  const second = await context.newPage();
  await second.goto('/app');
  await openDocument(second, 'Two tab document');
  await Promise.all([
    page.getByRole('textbox', { name: 'Diagram title', exact: true }).fill('First tab change'),
    second.getByRole('textbox', { name: 'Diagram title', exact: true }).fill('Second tab change'),
  ]);
  await Promise.all([
    page.getByRole('textbox', { name: 'Diagram title', exact: true }).press('Enter'),
    second.getByRole('textbox', { name: 'Diagram title', exact: true }).press('Enter'),
  ]);
  await expect.poll(async () => (await Promise.all([page.getByRole('alert').allTextContents(), second.getByRole('alert').allTextContents()])).flat().join(' ')).toMatch(/conflict|another tab|newer|changed elsewhere/i);
  const docs = await storedDocuments(page);
  expect(docs).toHaveLength(1);
});

test('storage failure is visible and leaves the editor usable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, 'open', { configurable: true, value() { throw new DOMException('Storage unavailable for test', 'SecurityError'); } });
  });
  await page.goto('/app');
  await expect(page.getByRole('alert').filter({ hasText: /storage|sav|browser|local|persist/i })).toBeVisible();
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Still editable');
  await page.getByRole('textbox', { name: 'Node label', exact: true }).press('Tab');
  await expect(page.locator('.react-flow__node')).toContainText('Still editable');
});

test('edits while offline persist locally and remain after reconnecting', async ({ page, context }) => {
  await newDocument(page, 'Offline document');
  await context.setOffline(true);
  try {
    await page.getByRole('button', { name: 'Add Decision', exact: true }).click();
    await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Offline decision');
    await page.getByRole('textbox', { name: 'Node label', exact: true }).press('Tab');
    await expect.poll(async () => (await storedDocuments(page)).some(doc => doc.nodes.some(node => node.label === 'Offline decision'))).toBe(true);
  } finally {
    await context.setOffline(false);
  }
  await page.reload();
  await openDocument(page, 'Offline document');
  await expect(page.getByRole('group', { name: 'Decision: Offline decision', exact: true })).toBeVisible();
});

test('a 200-shape diagram imports and remains editable without dropping shapes', async ({ page }) => {
  await page.goto('/app');
  const fixture = diagramFixture(200);
  await importJson(page, fixture);
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(fixture.title);
  const stored = await savedDocument(page, fixture.title);
  expect(stored.nodes).toHaveLength(200);
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Shape 201');
  await page.getByRole('textbox', { name: 'Node label', exact: true }).press('Tab');
  await expect.poll(async () => (await storedDocuments(page)).find(doc => doc.title === fixture.title)?.nodes.length).toBe(201);
});

test('the documents dialog and editor have no serious automated accessibility violations', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const documents = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(documents.violations.filter(violation => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  const editor = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(editor.violations.filter(violation => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([]);
});
