import { expect, test, type Page, type Request } from '@playwright/test';
import type { Diagram } from '../src/lib/diagram';

const origin = 'http://127.0.0.1:3000';
const shareId = 'a'.repeat(32);
const shareKey = Buffer.alloc(32, 7).toString('base64url');

function fixture(title = 'Private review 🧭'): Diagram {
  const timestamp = '2026-11-02T00:00:00.000Z';
  return {
    schemaVersion: 1, documentId: 'shared-fixture', title, createdAt: timestamp, updatedAt: timestamp, revision: 0,
    nodes: [
      { id: 'start', type: 'terminal', position: { x: 0, y: 0 }, width: 180, height: 80, label: 'Confidential start', notes: 'Private account note 92741', style: { color: 'neutral' } },
      { id: 'review', type: 'process', position: { x: 300, y: 0 }, width: 180, height: 80, label: 'Review 漢字', notes: '', style: { color: 'blue' } },
    ],
    edges: [{ id: 'continue', source: 'start', target: 'review', sourceHandle: 'right', targetHandle: 'left', label: 'Sensitive approval path', style: { color: 'neutral' }, waypoints: [{ x: 240, y: 120 }] }],
    drawings: [{ id: 'ink', width: 6, color: 'neutral', points: [{ x: 50, y: 150, pressure: 0.2 }, { x: 150, y: 180, pressure: 0.8 }, { x: 250, y: 140, pressure: 0.5 }] }],
    viewport: { x: 80, y: 80, zoom: 1 }, settings: { snapToGrid: true, gridVisible: true, background: 'graph' },
  };
}

async function storedDocuments(page: Page): Promise<Diagram[]> {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(db => db.name === 'flowchart-studio')) return [];
    return new Promise<Diagram[]>((resolve, reject) => {
      const request = indexedDB.open('flowchart-studio');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('diagrams')) { db.close(); resolve([]); return; }
        const transaction = db.transaction('diagrams', 'readonly');
        const query = transaction.objectStore('diagrams').getAll();
        query.onsuccess = () => resolve(query.result);
        query.onerror = () => reject(query.error);
        transaction.oncomplete = () => db.close();
      };
    });
  });
}

async function importFixture(page: Page, doc = fixture()) {
  await page.goto('/app');
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: 'share.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(doc.title);
  await expect.poll(async () => (await storedDocuments(page)).some(item => item.title === doc.title)).toBe(true);
  return (await storedDocuments(page)).find(item => item.title === doc.title)!;
}

async function openShare(page: Page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share diagram', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createShare(page: Page) {
  const dialog = await openShare(page);
  await dialog.getByRole('button', { name: 'Create link', exact: true }).click();
  const link = dialog.getByRole('textbox', { name: 'Share link', exact: true });
  await expect(link).toHaveValue(/\/share#([a-f0-9]{32})\.[A-Za-z0-9_-]+$/);
  return link.inputValue();
}

async function expectViewer(page: Page, title: string) {
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const canvas = page.getByRole('img', { name: `${title}. 2 shapes and 1 connections. Drag to pan. Use plus and minus to zoom, or zero to fit.`, exact: true });
  await expect(canvas).toBeVisible();
  const image = page.locator('.shared-canvas > img');
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const rendered = await image.evaluate(element => {
    const svg = new DOMParser().parseFromString(decodeURIComponent((element as HTMLImageElement).src.split(',')[1]), 'image/svg+xml');
    return {
      nodes: svg.querySelectorAll('g[transform^="translate("]').length,
      edges: svg.querySelectorAll('path[marker-end]').length,
      drawings: svg.querySelectorAll('path[data-drawing-id]').length,
      text: [...svg.querySelectorAll('text')].map(item => [...item.querySelectorAll('tspan')].map(line => line.textContent).join(' ')),
    };
  });
  expect(rendered.nodes).toBe(2);
  expect(rendered.edges).toBe(1);
  expect(rendered.drawings).toBe(1);
  expect(rendered.text).toEqual(expect.arrayContaining(['Confidential start', 'Review 漢字', 'Sensitive approval path']));
  await expect(page.getByText(/expires/i)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Process', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save a copy', exact: true })).toBeEnabled();
}

function apiRequests(page: Page) {
  const requests: Request[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request); });
  return requests;
}

test('explicit sharing uploads ciphertext and a fresh recipient can view and save an independent editable copy', async ({ page, browser }) => {
  const doc = fixture();
  const requests = apiRequests(page);
  const original = await importFixture(page, doc);
  expect(requests).toHaveLength(0);
  const url = await createShare(page);
  const post = requests.filter(request => request.method() === 'POST');
  expect(post).toHaveLength(1);
  const encrypted = post[0].postDataJSON();
  expect(Object.keys(encrypted).sort()).toEqual(['ciphertext', 'iv', 'version']);
  expect(encrypted.version).toBe(1);
  expect(typeof encrypted.iv).toBe('string');
  expect(typeof encrypted.ciphertext).toBe('string');
  const response = await post[0].response();
  expect(response?.status()).toBe(201);
  const receipt = await response!.json();
  expect(Date.parse(receipt.expiresAt) - Date.now()).toBeGreaterThan(24 * 60 * 60 * 1000 - 60_000);
  expect(Date.parse(receipt.expiresAt) - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  const key = new URL(url).hash.split('.')[1];
  for (const secret of [doc.title, doc.nodes[0].label, doc.nodes[0].notes, doc.edges[0].label, key]) {
    expect(post[0].postData()).not.toContain(secret);
    for (const request of requests) expect(request.url()).not.toContain(secret);
  }
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('textbox', { name: 'Diagram title', exact: true }).fill('Sender edited after sharing');
  await page.getByRole('textbox', { name: 'Diagram title', exact: true }).press('Enter');
  await page.locator('.react-flow__node').first().click();
  await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Sender changed this shape after sharing');
  await page.getByRole('textbox', { name: 'Node label', exact: true }).press('Tab');

  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    const recipientRequests = apiRequests(recipient);
    await recipient.goto(url);
    await expectViewer(recipient, doc.title);
    expect(await storedDocuments(recipient)).toEqual([]);
    const image = recipient.locator('.shared-canvas > img');
    const before = await image.getAttribute('src');
    await recipient.locator('.shared-canvas').click();
    await recipient.keyboard.press('Delete');
    await recipient.keyboard.press('ArrowRight');
    await expect(image).toHaveAttribute('src', before!);
    await recipient.reload();
    await expectViewer(recipient, doc.title);
    expect(await storedDocuments(recipient)).toEqual([]);
    expect(recipientRequests.every(request => request.method() === 'GET' && !request.url().includes(key))).toBe(true);
    await recipient.getByRole('button', { name: 'Save a copy', exact: true }).click();
    await expect(recipient).toHaveURL(/\/app$/);
    const title = recipient.getByRole('textbox', { name: 'Diagram title', exact: true });
    await expect(title).toBeVisible();
    await expect.poll(async () => (await storedDocuments(recipient)).length).toBe(1);
    const copy = (await storedDocuments(recipient))[0];
    expect(copy.documentId).not.toBe(original.documentId);
    const nodeContent = (item: Diagram['nodes'][number]) => ({ type: item.type, label: item.label, notes: item.notes, position: item.position, width: item.width, height: item.height, style: item.style });
    const edgeContent = (item: Diagram['edges'][number]) => ({ label: item.label, sourceHandle: item.sourceHandle, targetHandle: item.targetHandle, style: item.style, waypoints: item.waypoints });
    const drawingContent = (item: Diagram['drawings'][number]) => ({ width: item.width, color: item.color, points: item.points });
    expect(copy.nodes.map(nodeContent)).toEqual(doc.nodes.map(nodeContent));
    expect(copy.edges.map(edgeContent)).toEqual(doc.edges.map(edgeContent));
    expect(copy.drawings.map(drawingContent)).toEqual(doc.drawings.map(drawingContent));
    expect(copy.nodes.some(node => node.id === copy.edges[0].source)).toBe(true);
    expect(copy.nodes.some(node => node.id === copy.edges[0].target)).toBe(true);
    expect(copy.settings).toEqual(doc.settings);
    await title.fill('Recipient editable copy');
    await title.press('Enter');
    await expect.poll(async () => (await storedDocuments(recipient))[0]?.title).toBe('Recipient editable copy');
    await recipient.reload();
    await expect(title).toHaveValue('Recipient editable copy');
    await page.goto(url);
    await expectViewer(page, doc.title);
  } finally { await context.close(); }
});

test('opening a share and saving a copy preserve an existing local document and its content', async ({ page, browser }) => {
  await importFixture(page);
  const url = await createShare(page);
  const context = await browser.newContext();
  try {
    const recipient = await context.newPage();
    const existingFixture = fixture('Existing local work');
    existingFixture.nodes[0].label = 'Keep this local content';
    const existing = await importFixture(recipient, existingFixture);
    const before = await storedDocuments(recipient);
    await recipient.goto(url);
    await expectViewer(recipient, fixture().title);
    expect(await storedDocuments(recipient)).toEqual(before);
    await recipient.getByRole('button', { name: 'Save a copy', exact: true }).click();
    await expect(recipient).toHaveURL(/\/app$/);
    await expect.poll(async () => (await storedDocuments(recipient)).length).toBe(before.length + 1);
    const after = await storedDocuments(recipient);
    expect(after.find(doc => doc.documentId === existing.documentId)).toEqual(existing);
    expect(after.filter(doc => !before.some(old => old.documentId === doc.documentId))).toHaveLength(1);
    await recipient.getByRole('button', { name: 'Documents', exact: true }).click();
    await recipient.getByRole('dialog', { name: 'Documents', exact: true }).getByRole('button').filter({ hasText: 'Existing local work' }).click();
    await expect(recipient.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue('Existing local work');
    await expect(recipient.getByRole('group', { name: 'Start / End: Keep this local content', exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test('opening or cancelling Share sends nothing and a failed explicit upload can be retried', async ({ page }) => {
  const requests = apiRequests(page);
  const original = await importFixture(page);
  let dialog = await openShare(page);
  await expect(dialog).toContainText(/24 hours/i);
  await expect(dialog).toContainText(/encrypt/i);
  await expect(dialog).toContainText(/anyone|link/i);
  expect(requests).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(requests).toHaveLength(0);
  let attempts = 0;
  await page.route('**/api/shares', async route => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, json: { error: 'Sharing is temporarily unavailable.' } });
    else await route.continue();
  });
  dialog = await openShare(page);
  await dialog.getByRole('button', { name: 'Create link', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Share link', exact: true })).toHaveCount(0);
  expect((await storedDocuments(page)).find(doc => doc.documentId === original.documentId)).toEqual(original);
  await dialog.getByRole('button', { name: /Create link|Try again|Retry/, exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Share link', exact: true })).toHaveValue(/\/share#/);
  expect(attempts).toBe(2);
});

test('mobile Actions exposes Share and clipboard rejection leaves a selectable usable link', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('Clipboard unavailable', 'NotAllowedError')) } });
    document.execCommand = () => false;
  });
  await importFixture(page);
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('dialog', { name: 'Actions', exact: true }).getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share diagram', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Actions', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Create link', exact: true }).click();
  const link = dialog.getByRole('textbox', { name: 'Share link', exact: true });
  await expect(link).toHaveValue(/\/share#/);
  await expect(link).toHaveAttribute('readonly', '');
  const url = await link.inputValue();
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(link).toBeFocused();
  expect(await link.evaluate(element => {
    const input = element as HTMLInputElement;
    return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  })).toBe(url);
  await expect(dialog.getByRole('status')).toHaveText('Select and copy the link.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

for (const scenario of [
  { name: 'expired', status: 410, message: 'This share link has expired.', expected: /expired/i },
  { name: 'missing', status: 404, message: 'This share link was not found.', expected: /not found|unavailable|expired/i },
  { name: 'temporarily unavailable', status: 503, message: 'Sharing is temporarily unavailable.', expected: /unavailable|try again|load/i },
]) {
  test(`a ${scenario.name} share shows an error without creating or replacing local documents`, async ({ page }) => {
    await importFixture(page, fixture('Keep local work during errors'));
    const before = await storedDocuments(page);
    await page.route(`**/api/shares/${shareId}`, route => route.fulfill({ status: scenario.status, json: { error: scenario.message } }));
    await page.goto(`/share#${shareId}.${shareKey}`);
    await expect(page.getByRole('main').getByRole('alert')).toContainText(scenario.expected);
    await expect(page.getByRole('button', { name: 'Save a copy', exact: true })).toHaveCount(0);
    await expect(page.locator('.shared-canvas > img')).toHaveCount(0);
    expect(await storedDocuments(page)).toEqual(before);
  });
}

test('an incorrect decryption key cannot expose a diagram or save a local copy', async ({ page }) => {
  await importFixture(page);
  const url = new URL(await createShare(page));
  const [id] = url.hash.slice(1).split('.');
  const before = await storedDocuments(page);
  const requests = apiRequests(page);
  await page.goto(`${origin}/share#${id}.${shareKey}`);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(/decrypt|key|invalid|open/i);
  await expect(page.getByRole('button', { name: 'Save a copy', exact: true })).toHaveCount(0);
  await expect(page.locator('.shared-canvas > img')).toHaveCount(0);
  expect(await storedDocuments(page)).toEqual(before);
  expect(requests.every(request => !request.url().includes(shareKey) && !request.postData()?.includes(shareKey))).toBe(true);
});
