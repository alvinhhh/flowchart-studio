import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { parseDiagram, type Diagram } from '../src/lib/diagram';

// Playwright supplies a fresh browser context per test; existing user storage is never opened.
async function storedDocuments(page: Page): Promise<Diagram[]> {
  return page.evaluate(() => new Promise<Diagram[]>((resolve, reject) => {
    const request = indexedDB.open('flowchart-studio');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('diagrams', 'readonly');
      const query = transaction.objectStore('diagrams').getAll();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }));
}

test('help contains the relocated guidance and attribution, and example dismissal persists', async ({ page }) => {
  await page.goto('/app?example=1');
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toHaveCount(0);
  await expect(page.locator('.react-flow__attribution')).toHaveCount(0);
  await expect(page.locator('.canvas-hint')).toHaveCount(0);
  await expect(page.getByText('Drag between connection points to link shapes.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss programming example', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Programming example', exact: true })).toBeHidden();
  await expect.poll(async () => (await storedDocuments(page)).length).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Programming example', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Local storage & help', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Local storage & help', exact: true });
  await expect(help).toContainText('Shift + drag');
  await expect(help).toContainText('Hold Space to pan from any tool');
  await expect(help).toContainText('Click a sidebar shape to add it, or drag it onto the canvas');
  await expect(help.getByRole('link', { name: 'React Flow', exact: true })).toHaveAttribute('href', 'https://reactflow.dev');
  await expect(help.getByRole('link', { name: 'MIT license', exact: true })).toHaveAttribute('href', '/licenses/react-flow.txt');
  const previousId = (await storedDocuments(page))[0].documentId;
  await help.getByRole('button', { name: 'Open programming example', exact: true }).click();
  await expect(help).toBeHidden();
  await expect.poll(async () => (await storedDocuments(page)).filter(doc => doc.documentId !== previousId).length).toBe(1);
});

test('all backups include every local document and the latest field edits as importable JSON', async ({ page }) => {
  await page.goto('/app?example=1');
  const title = page.getByRole('textbox', { name: 'Diagram title', exact: true });
  await title.fill('First diagram 🧭');
  await title.press('Enter');
  await expect.poll(async () => (await storedDocuments(page)).some(doc => doc.title === 'First diagram 🧭')).toBe(true);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: 'New diagram', exact: true }).click();
  await title.fill('Second diagram');
  await title.press('Enter');
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Latest 漢字 label');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Latest notes before autosave');
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download all backups', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^flowchart-backups-\d{4}-\d{2}-\d{2}\.zip$/);
  const entries = unzipSync(await readFile((await download.path())!));
  const backedUp = Object.values(entries).map(bytes => parseDiagram(strFromU8(bytes)));
  const stored = await storedDocuments(page);
  expect(backedUp).toHaveLength(2);
  const byId = (a: Diagram, b: Diagram) => a.documentId.localeCompare(b.documentId);
  expect(backedUp.sort(byId)).toEqual(stored.sort(byId));
  expect(backedUp.find(doc => doc.title === 'Second diagram')?.nodes[0]).toMatchObject({ label: 'Latest 漢字 label', notes: 'Latest notes before autosave' });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByText('Backups downloaded (2 diagrams).', { exact: true })).toBeVisible();
});

test('a listing failure shows a recoverable backup error without downloading a partial archive', async ({ page }) => {
  await page.goto('/app?example=1');
  await expect.poll(async () => (await storedDocuments(page)).length).toBe(1);
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) {
      if (this.name === 'diagrams') throw new DOMException('Test storage failure', 'UnknownError');
      return original.apply(this, args);
    };
  });
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await page.getByRole('button', { name: 'Download all backups', exact: true }).click();
  const documents = page.getByRole('dialog', { name: 'Documents', exact: true });
  await expect(documents.getByRole('alert')).toContainText('Backup failed. Browser storage is unavailable.');
  await expect(documents.getByRole('button', { name: 'Download all backups', exact: true })).toBeEnabled();
  expect(downloads).toBe(0);
});

test('icon tooltips work on hover and keyboard focus, explain unavailable actions, and stay within the viewport', async ({ page }) => {
  await page.goto('/app?example=1');
  await expect(page.getByRole('button', { name: 'Pan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy selection', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Select a shape');
  await page.mouse.move(0, 0);
  for (const [name, text] of [['Pan', 'Pan (H)'], ['Select', 'Select (V)'], ['Draw', 'Draw (P)'], ['Eraser', 'Eraser (E)'], ['Zoom out', 'Zoom out'], ['Zoom in', 'Zoom in'], ['Fit view', 'Fit diagram']] as const) {
    const button = page.getByRole('button', { name, exact: true });
    await button.focus();
    await expect(page.getByRole('tooltip')).toHaveText(text);
    const bounds = (await page.getByRole('tooltip').boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await button.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  const disabledUndo = page.getByRole('button', { name: 'Undo', exact: true }).locator('..');
  await disabledUndo.focus();
  await expect(page.getByRole('tooltip')).toContainText('No changes to undo');
});
