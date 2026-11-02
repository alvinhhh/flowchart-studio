import { expect, test, type Page } from '@playwright/test';

type Point = { x: number; y: number };
type Node = { id: string; type: string; position: Point; width: number; height: number; label: string; notes: string; style: { color: string } };
type Edge = { id: string; source: string; target: string; sourceHandle: string; targetHandle: string; label: string; style: { color: string } };
type Diagram = { documentId: string; title: string; nodes: Node[]; edges: Edge[] };

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

function fixture() {
  const date = '2026-11-02T00:00:00.000Z';
  const nodes = ['terminal', 'decision', 'io', 'function', 'process'].map((type, index) => ({
    id: `node-${index}`, type, position: { x: 80, y: 80 }, width: type === 'decision' ? 180 : 176,
    height: type === 'decision' ? 120 : 80, label: `Step ${index + 1} 🧭`, notes: `Saved note ${index + 1}`, style: { color: index % 2 ? 'amber' : 'blue' },
  }));
  const edges = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [4, 1]].map(([source, target], index) => ({
    id: `edge-${index}`, source: `node-${source}`, target: `node-${target}`, sourceHandle: 'right', targetHandle: 'left', label: index === 5 ? 'Retry' : `Path ${index + 1}`, style: { color: 'neutral' },
  }));
  return { schemaVersion: 1, documentId: 'layout-fixture', title: 'Arrange branch merge cycle', createdAt: date, updatedAt: date, revision: 0,
    nodes, edges, viewport: { x: 80, y: 80, zoom: 1 }, settings: { snapToGrid: true, gridVisible: true } };
}

const positions = (diagram: Diagram) => diagram.nodes.map(node => ({ id: node.id, position: node.position }));
const handles = (diagram: Diagram) => diagram.edges.map(edge => ({ id: edge.id, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle }));
const nodeContents = (diagram: Diagram) => diagram.nodes.map(node => ({ id: node.id, type: node.type, width: node.width, height: node.height, label: node.label, notes: node.notes, style: node.style }));
const topology = (diagram: Diagram) => diagram.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, label: edge.label, style: edge.style }));

async function handle(page: Page, id: string, side: string): Promise<Point> {
  return page.locator(`.react-flow__node[data-id="${id}"] .react-flow__handle[data-handleid="${side}"]`).evaluate((element, side) => {
    const rect = element.getBoundingClientRect();
    const root = element.closest('.react-flow')!;
    const origin = root.getBoundingClientRect();
    const matrix = new DOMMatrix(getComputedStyle(root.querySelector('.react-flow__viewport')!).transform);
    const x = side === 'left' ? rect.left : side === 'right' ? rect.right : rect.left + rect.width / 2;
    const y = side === 'top' ? rect.top : side === 'bottom' ? rect.bottom : rect.top + rect.height / 2;
    return { x: (x - origin.left - matrix.e) / matrix.a, y: (y - origin.top - matrix.f) / matrix.a };
  }, side);
}

test('auto arrange separates a branch, merge and cycle while preserving data, attachments and one-step undo', async ({ page }, testInfo) => {
  const original = fixture();
  await page.goto('/app');
  await page.locator('input[type="file"]').setInputFiles({ name: 'layout.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(original.title);
  await expect.poll(async () => !!await saved(page, original.title)).toBe(true);
  const before = (await saved(page, original.title))!;
  await page.getByRole('button', { name: 'Auto arrange', exact: true }).click();
  await expect.poll(async () => positions((await saved(page, original.title))!)).not.toEqual(positions(before));
  const arranged = (await saved(page, original.title))!;
  expect(nodeContents(arranged)).toEqual(nodeContents(before));
  expect(topology(arranged)).toEqual(topology(before));
  for (let i = 0; i < arranged.nodes.length; i++) for (let j = i + 1; j < arranged.nodes.length; j++) {
    const a = arranged.nodes[i], b = arranged.nodes[j];
    expect(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y).toBe(true);
  }
  await expect(page.locator('.react-flow__edge')).toHaveCount(before.edges.length);
  for (const edge of arranged.edges) {
    const path = page.locator(`.react-flow__edge[data-id="${edge.id}"] .react-flow__edge-path`);
    await expect.poll(async () => {
      const source = await handle(page, edge.source, edge.sourceHandle);
      const target = await handle(page, edge.target, edge.targetHandle);
      const values = ((await path.getAttribute('d'))?.match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
      return Math.max(Math.abs(values[0] - source.x), Math.abs(values[1] - source.y), Math.abs(values.at(-2)! - target.x), Math.abs(values.at(-1)! - target.y));
    }).toBeLessThan(0.5);
  }
  await expect(page.getByRole('status')).toContainText('Saved');
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: 'outputs/auto-arrange-preview.png' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => positions((await saved(page, original.title))!)).toEqual(positions(before));
  expect(handles((await saved(page, original.title))!)).toEqual(handles(before));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => positions((await saved(page, original.title))!)).toEqual(positions(arranged));
  expect(handles((await saved(page, original.title))!)).toEqual(handles(arranged));
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(original.title);
  const reopened = (await saved(page, original.title))!;
  expect(positions(reopened)).toEqual(positions(arranged));
  expect(handles(reopened)).toEqual(handles(arranged));
  expect(reopened.documentId).toBe(before.documentId);
});

test('auto arrange is disabled for an empty diagram and a stale read-only copy', async ({ page, context }) => {
  await page.goto('/app');
  const button = page.getByRole('button', { name: 'Auto arrange', exact: true });
  await expect(button).toBeDisabled();
  await page.getByRole('textbox', { name: 'Diagram title', exact: true }).fill('Arrange read-only');
  await page.getByRole('textbox', { name: 'Diagram title', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await expect.poll(async () => (await saved(page, 'Arrange read-only'))?.nodes.length).toBe(1);
  await expect(button).toBeEnabled();
  const second = await context.newPage();
  await second.goto('/app');
  const title = second.getByRole('textbox', { name: 'Diagram title', exact: true });
  await expect(title).toHaveValue('Arrange read-only');
  await title.fill('Edited elsewhere');
  await title.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: /another tab|read-only/i })).toBeVisible();
  await expect(button).toBeDisabled();
});

test('the default example keeps its main path straight, separates decision branches and stays compact', async ({ page }, testInfo) => {
  await page.goto('/app?example=1');
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue('Order review');
  await expect.poll(async () => !!await saved(page, 'Order review')).toBe(true);
  const before = (await saved(page, 'Order review'))!;
  await page.getByRole('button', { name: 'Auto arrange', exact: true }).click();
  await expect(page.locator('.footer-notice')).toContainText(/arranged/i);
  await expect(page.getByRole('status')).toContainText('Saved');
  const arranged = (await saved(page, 'Order review'))!;
  expect(nodeContents(arranged)).toEqual(nodeContents(before));
  expect(topology(arranged)).toEqual(topology(before));
  const start = arranged.nodes.find(node => node.label === 'Order received')!;
  const review = arranged.nodes.find(node => node.label === 'Review order')!;
  const decision = arranged.nodes.find(node => node.label === 'Approved?')!;
  const center = (node: Node) => node.position.x + node.width / 2;
  expect(center(start)).toBeCloseTo(center(review), 4);
  expect(center(review)).toBeCloseTo(center(decision), 4);
  expect(start.position.y + start.height).toBeLessThan(review.position.y);
  expect(review.position.y + review.height).toBeLessThan(decision.position.y);
  const branches = arranged.edges.filter(edge => edge.source === decision.id && ['Yes', 'No'].includes(edge.label));
  expect(branches).toHaveLength(2);
  expect(new Set(branches.map(edge => edge.sourceHandle)).size).toBe(2);
  const top = Math.min(...arranged.nodes.map(node => node.position.y));
  const bottom = Math.max(...arranged.nodes.map(node => node.position.y + node.height));
  expect(bottom - top).toBeLessThanOrEqual(850);
  for (let i = 0; i < arranged.nodes.length; i++) for (let j = i + 1; j < arranged.nodes.length; j++) {
    const a = arranged.nodes[i], b = arranged.nodes[j];
    expect(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y).toBe(true);
  }
  if (testInfo.project.name === 'chromium') await page.screenshot({ path: 'outputs/default-auto-arrange.png' });
});
