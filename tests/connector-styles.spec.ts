import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const title = 'Connector styles';
function fixture() {
  const now = '2026-11-02T00:00:00.000Z';
  return { schemaVersion: 1, documentId: 'connector-style-fixture', title, createdAt: now, updatedAt: now, revision: 0,
    nodes: [{ id: 'start', label: 'Start', position: { x: 0, y: 0 } }, { id: 'end', label: 'End', position: { x: 400, y: 0 } }].map(node => ({ ...node, type: 'process', width: 160, height: 80, notes: '', style: { color: 'neutral' } })),
    edges: [{ id: 'edge', source: 'start', target: 'end', sourceHandle: 'right', targetHandle: 'left', label: '', style: { color: 'blue' } }],
    drawings: [], viewport: { x: 100, y: 180, zoom: 1 }, settings: { snapToGrid: true, gridVisible: true, background: 'dots' } };
}
async function open(page: Page) {
  await page.goto('/app');
  await page.locator('input[type="file"]').setInputFiles({ name: 'connectors.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture())) });
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.locator('.react-flow__edge').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tablist', { name: 'Connector categories' })).toBeVisible();
  await page.locator('.properties-panel .connector-custom > summary').click();
}
async function exported(page: Page, format: 'JSON' | 'SVG') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `Export ${format}`, exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}

test('categorized connector presets customize both ends, persist and undo', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'UML', exact: true }).click();
  await page.getByRole('button', { name: 'Composition connector', exact: true }).click();
  await expect(page.getByLabel('Connection start marker', { exact: true })).toHaveValue('diamond-filled');
  await expect(page.getByLabel('Connection end marker', { exact: true })).toHaveValue('none');
  const edgePath = page.locator('.react-flow__edge-path');
  await expect(edgePath).toHaveAttribute('marker-start', /diamond-filled-blue/);
  await expect(edgePath).not.toHaveAttribute('marker-end');
  await page.getByLabel('Connection line pattern', { exact: true }).selectOption('dotted');
  await page.getByLabel('Connection line width', { exact: true }).selectOption('4');
  await page.getByLabel('Connection end marker', { exact: true }).selectOption('crowfoot');
  await page.getByRole('button', { name: 'Connection color Rose', exact: true }).click();
  await expect(edgePath).toHaveCSS('stroke', 'rgb(224, 103, 128)');
  await expect(edgePath).toHaveCSS('stroke-width', '4px');
  await expect(edgePath).toHaveCSS('stroke-dasharray', '0px, 12px');
  const svg = await exported(page, 'SVG');
  expect(svg).toContain('marker-start="url(#connector-diamond-filled-rose-4)"');
  expect(svg).toContain('marker-end="url(#connector-crowfoot-rose-4)"');
  expect(svg).toContain('stroke-dasharray="0 12"');
  const json = JSON.parse(await exported(page, 'JSON'));
  expect(json.edges[0].style).toEqual({ color: 'rose', width: 4, lineStyle: 'dotted', startMarker: 'diamond-filled', endMarker: 'crowfoot' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(edgePath).toHaveCSS('stroke', 'rgb(59, 130, 246)');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(edgePath).toHaveCSS('stroke', 'rgb(224, 103, 128)');
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible();
  await page.reload();
  await page.locator('.react-flow__edge').focus(); await page.keyboard.press('Enter');
  await page.locator('.properties-panel .connector-custom > summary').click();
  await expect(page.getByLabel('Connection end marker', { exact: true })).toHaveValue('crowfoot');
  await expect(edgePath).toHaveAttribute('marker-start', /diamond-filled-rose/);
});

test('new connections inherit the chosen default and dialog categories support keyboard navigation', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click();
  await page.getByRole('button', { name: 'One to many connector', exact: true }).click();
  await page.getByRole('button', { name: 'Use for new connections', exact: true }).click();
  await page.getByRole('button', { name: 'Connect nodes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect nodes', exact: true });
  await dialog.locator('.connector-custom > summary').click();
  await expect(dialog.getByLabel('Connection start marker', { exact: true })).toHaveValue('bar');
  await expect(dialog.getByLabel('Connection end marker', { exact: true })).toHaveValue('crowfoot');
  await dialog.getByRole('tab', { name: 'Relationships', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.getByRole('tab', { name: 'UML', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Dependency connector', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  const json = JSON.parse(await exported(page, 'JSON'));
  expect(json.edges[1].style).toEqual({ color: 'blue', width: 1.5, lineStyle: 'dashed', startMarker: 'none', endMarker: 'open-arrow' });
  await page.getByRole('button', { name: 'Connect nodes', exact: true }).click();
  await dialog.locator('.connector-custom > summary').click();
  await expect(dialog.getByLabel('Connection end marker', { exact: true })).toHaveValue('open-arrow');
});


test('PDF keeps endpoint size independent of connector line width', async ({ page }) => {
  await open(page);
  await page.getByLabel('Connection line width', { exact: true }).selectOption('4');
  await page.getByLabel('Connection start marker', { exact: true }).selectOption('triangle');
  await page.getByLabel('Connection end marker', { exact: true }).selectOption('diamond');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const bytes = await readFile((await download.path())!);
  const source = bytes.toString('latin1');
  expect(source).toMatch(/^%PDF-1\.4/);
  const forms = [...source.matchAll(/\/Subtype \/Form\b[\s\S]*?\/Matrix \[([^\]]+)\]/g)];
  expect(forms).toHaveLength(2);
  // PDF's outer marker matrix scales by the edge width; its form matrix must cancel
  // that scale to preserve the 14.5px marker used in SVG and the editing canvas.
  for (const form of forms) {
    const matrix = form[1].trim().split(/\s+/).map(Number);
    expect(matrix[0] * 4).toBeCloseTo(14.5 / 12, 4);
    expect(matrix[3] * 4).toBeCloseTo(14.5 / 12, 4);
  }
});
