import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`the ${viewport.width}px editor keeps its toolbar in one row and leaves the canvas usable`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/app');
    await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toBeVisible();
    const toolbar = page.locator('.editor-toolbar');
    const controls = ['Shapes', 'Undo', 'Redo', 'Actions'].map(name => toolbar.getByRole('button', { name, exact: true }));
    for (const control of controls) await expect(control).toBeVisible();
    const bounds = (await toolbar.boundingBox())!;
    expect(bounds.height).toBeLessThanOrEqual(64);
    const centers = await Promise.all(controls.map(async control => {
      const rect = (await control.boundingBox())!;
      return rect.y + rect.height / 2;
    }));
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    const canvas = (await page.locator('.react-flow__pane').boundingBox())!;
    if (viewport.width === 390) expect(canvas.height).toBeGreaterThanOrEqual(viewport.height * 0.7);
    const canvasTools = page.getByRole('toolbar', { name: 'Canvas tools', exact: true });
    const toolCenters = await Promise.all(['Pan', 'Select', 'Draw', 'Eraser'].map(async name => {
      const rect = (await canvasTools.getByRole('button', { name, exact: true }).boundingBox())!;
      return rect.y + rect.height / 2;
    }));
    expect(Math.max(...toolCenters) - Math.min(...toolCenters)).toBeLessThanOrEqual(1);
    await testInfo.attach('layout', { body: JSON.stringify({ viewport, toolbarHeight: bounds.height, canvasHeight: canvas.height, canvasRatio: canvas.height / viewport.height }), contentType: 'application/json' });
    await expect(page.getByRole('button', { name: 'Documents', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Local storage & help', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`mobile-editor-${viewport.width}.png`), fullPage: true });
  });
}

test('mobile Actions exposes settings and export, restores focus on Escape, and downloads JSON', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  const actions = page.getByRole('button', { name: 'Actions', exact: true });
  await actions.focus();
  await actions.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Actions', exact: true });
  await expect(dialog).toBeVisible();
  const snap = dialog.getByRole('checkbox', { name: 'Snap to grid', exact: true });
  const wasChecked = await snap.isChecked();
  await snap.setChecked(!wasChecked);
  await expect(snap).toBeChecked({ checked: !wasChecked });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Align shapes', exact: true })).toBeVisible();
  for (const format of ['JSON', 'SVG', 'PDF', 'PNG']) {
    await expect(dialog.getByRole('button', { name: `Export ${format}`, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: testInfo.outputPath('mobile-actions.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(actions).toBeFocused();
  await actions.press('Enter');
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(exported.nodes).toEqual([]);
  expect(exported.settings.snapToGrid).toBe(!wasChecked);
  await expect(dialog).toHaveCount(0);
});

test('mobile Shapes adds a node and leaves clear selection, Undo, and Redo available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  const shapes = page.getByRole('button', { name: 'Shapes', exact: true });
  await shapes.click();
  const palette = page.getByRole('complementary', { name: 'Shapes', exact: true });
  await expect(palette).toBeVisible();
  await palette.getByRole('button', { name: 'Add Process', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  const properties = page.getByRole('complementary', { name: 'Properties', exact: true });
  await expect(properties).toBeVisible();
  await properties.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(properties).toHaveCount(0);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
});

test('mobile Actions opens a usable connection dialog and connects two shapes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  for (const shape of ['Process', 'Decision']) {
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    const palette = page.getByRole('complementary', { name: 'Shapes', exact: true });
    await palette.getByRole('button', { name: `Add ${shape}`, exact: true }).click();
    await page.getByRole('complementary', { name: 'Properties', exact: true }).getByRole('button', { name: 'Clear selection', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('dialog', { name: 'Actions', exact: true }).getByRole('button', { name: 'Connect nodes', exact: true }).click();
  const connection = page.getByRole('dialog', { name: 'Connect nodes', exact: true });
  await expect(connection).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Actions', exact: true })).toHaveCount(0);
  await connection.getByRole('combobox', { name: 'From node', exact: true }).selectOption({ label: 'Process' });
  await connection.getByRole('combobox', { name: 'To node', exact: true }).selectOption({ label: 'Decision' });
  const label = connection.getByRole('textbox', { name: 'New connection label', exact: true });
  await label.fill('Continue');
  await expect(label).toBeFocused();
  await expect(label).toHaveValue('Continue');
  await connection.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(connection).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('the 320px Draw tools stay within the screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/app');
  const draw = page.getByRole('button', { name: 'Draw', exact: true });
  await draw.click();
  await expect(draw).toHaveAttribute('aria-pressed', 'true');
  const width = page.getByRole('combobox', { name: 'Pen width', exact: true });
  await expect(width).toBeVisible();
  await width.selectOption('6');
  await expect(width).toHaveValue('6');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  for (const control of [page.getByRole('toolbar', { name: 'Canvas tools', exact: true }), width, page.getByRole('combobox', { name: 'Pen color', exact: true })]) {
    await expect(control).toBeVisible();
    const bounds = (await control.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
  await page.screenshot({ path: testInfo.outputPath('mobile-draw-320.png'), fullPage: true });
});
