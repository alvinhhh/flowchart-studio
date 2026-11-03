import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function fixture() {
  const date = '2026-11-02T00:00:00.000Z';
  return { schemaVersion: 1, documentId: 'code-fixture', title: 'Code export', createdAt: date, updatedAt: date, revision: 0,
    nodes: [
      { id: 'alpha', type: 'process', position: { x: 100, y: 80 }, width: 176, height: 80, label: 'Review order', notes: 'Keep this note', style: { color: 'blue' }, locked: false },
      { id: 'beta', type: 'decision', position: { x: 100, y: 280 }, width: 180, height: 120, label: 'Approved?', notes: '', style: { color: 'amber' } },
    ], edges: [{ id: 'edge', source: 'alpha', target: 'beta', sourceHandle: 'bottom', targetHandle: 'top', label: 'Next', style: { color: 'neutral' } }],
    drawings: [{ id: 'ink', color: 'blue', width: 2, points: [{ x: 20, y: 30, pressure: 1 }] }],
    viewport: { x: 0, y: 0, zoom: 1 }, settings: { snapToGrid: true, gridVisible: true, background: 'dots' } };
}
async function open(page: Page, value = fixture()) {
  await page.goto('/app');
  await page.locator('input[type="file"]').setInputFiles({ name: 'code.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(value.title);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Code panel' })).toBeVisible();
}

test('generated code follows canvas edits and copies/downloads the same Mermaid text', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as Window & { copiedCode?: string }).copiedCode = text; } } }); });
  await open(page);
  const code = page.getByRole('textbox', { name: 'Mermaid code', exact: true });
  await expect(code).toHaveAttribute('readonly', '');
  await expect(code).toHaveValue(/flowchart TD\n  N1\["Review order"\]\n  N2\{"Approved\?"\}\n  N1 -->\|Next\| N2/);
  await page.locator('.react-flow__node[data-id="alpha"]').click();
  await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Updated order 🧭');
  await page.getByRole('textbox', { name: 'Node label', exact: true }).press('Tab');
  await expect(code).toHaveValue(/Updated order 🧭/);
  const source = await code.inputValue();
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Code copied.' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { copiedCode?: string }).copiedCode)).toBe(source);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .mmd', exact: true }).click();
  const result = await download;
  expect(result.suggestedFilename()).toBe('Code export.mmd');
  expect(await readFile((await result.path())!, 'utf8')).toBe(source);
});

test('opening code keeps chart data and renders HTML labels as text without external requests', async ({ page, baseURL }) => {
  const value = fixture();
  value.nodes[0].label = '<img src="https://example.org/should-not-load"> %%{init: {"securityLevel":"loose"}}%%';
  const external: string[] = [];
  const origin = new URL(baseURL!).origin;
  page.on('request', request => { if (new URL(request.url()).origin !== origin) external.push(request.url()); });
  await open(page, value);
  const code = await page.getByRole('textbox', { name: 'Mermaid code', exact: true }).inputValue();
  expect(code).toContain('#60;img');
  expect(code).not.toContain('<img');
  expect(code).not.toContain('%%{');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByText('Export details', { exact: true }).click();
  await expect(page.getByText('Mermaid files omit notes, drawings, groups and locks.', { exact: false })).toBeVisible();
  expect(external).toEqual([]);
  await page.getByRole('button', { name: 'Close code panel', exact: true }).click();
  await page.locator('.react-flow__node[data-id="alpha"]').click();
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Keep this note');
});

test('code panel fits a narrow screen and closes back to the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const panel = page.getByRole('region', { name: 'Code panel' });
  const box = await panel.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Download .mmd', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close code panel', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.react-flow')).toBeVisible();
});
