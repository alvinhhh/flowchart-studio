import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  const date = '2026-11-02T00:00:00.000Z';
  const fixture = {
    schemaVersion: 1, documentId: 'mac-shortcuts', title: 'Mac shortcuts', createdAt: date, updatedAt: date, revision: 0,
    nodes: ['a', 'b'].map((id, index) => ({ id, type: 'process', position: { x: 40 + index * 280, y: 100 }, width: 176, height: 80, label: `Step ${id}`, notes: '', style: { color: 'neutral' } })),
    edges: [{ id: 'a-b', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left', label: 'Proceed', style: { color: 'neutral' } }],
    viewport: { x: 80, y: 60, zoom: 1 }, settings: { snapToGrid: false, gridVisible: true },
  };
  await page.goto('/app');
  await page.locator('input[type="file"]').setInputFiles({ name: 'shortcuts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(fixture.title);
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
}

test('literal Command shortcuts select, duplicate, undo, redo and delete a connected group on macOS', async ({ page }) => {
  await prepare(page);
  await page.locator('.react-flow__node[data-id="a"]').click();
  await page.locator('.react-flow__node[data-id="b"]').click({ modifiers: ['Meta'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  await page.keyboard.press('Meta+d');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.keyboard.press('Shift+Meta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await page.keyboard.press('Meta+a');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge.selected')).toHaveCount(2);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('Command+A and Command+Z in a label field operate on text without changing the graph', async ({ page }) => {
  await prepare(page);
  await page.locator('.react-flow__node[data-id="a"]').click();
  const field = page.getByRole('textbox', { name: 'Node label', exact: true });
  await field.fill('Editable text');
  await field.press('Meta+a');
  const selection = await field.evaluate(element => {
    const textarea = element as HTMLTextAreaElement;
    return [textarea.selectionStart, textarea.selectionEnd];
  });
  expect(selection).toEqual([0, 'Editable text'.length]);
  await field.press('Backspace');
  await expect(field).toHaveValue('');
  await field.press('Meta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await field.fill('Committed text edit');
  await field.press('Tab');
  await page.locator('.react-flow__node[data-id="a"]').click();
  await page.keyboard.press('Meta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Node label', exact: true })).toHaveValue('Step a');
});
