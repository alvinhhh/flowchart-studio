import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

const PUBLIC_ORIGIN = 'https://flowchart.lol';
const guides = [
  {
    path: '/guides/how-to-draw-a-flowchart',
    title: 'How to draw a programming flowchart',
    related: '/guides/flowchart-symbols',
    headings: ['What is a programming flowchart?', '1. Write the steps before drawing', '2. Choose a symbol for each kind of step', '3. Connect steps and label decision branches', '4. Draw a loop back to its condition', '5. Trace the diagram and save a backup'],
  },
  {
    path: '/guides/flowchart-symbols',
    title: 'Flowchart symbols and their meanings',
    related: '/guides/how-to-draw-a-flowchart',
    headings: ['Start with four basic symbols', 'Common flowchart shapes', 'Arrows show the direction of control', 'Decision symbols need clear outcomes', 'Loops use decisions and return arrows', 'Choose extra symbols when they add meaning'],
  },
];

function structuredNodes(value: unknown): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    const object = item as Record<string, unknown>;
    if (object['@type']) nodes.push(object);
    Object.values(object).forEach(visit);
  };
  visit(value);
  return nodes;
}

const hasType = (item: Record<string, unknown>, type: string) => item['@type'] === type || (Array.isArray(item['@type']) && item['@type'].includes(type));

async function downloadJSON(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as {
    title: string; nodes: Array<{ label: string; notes: string }>;
  };
}

async function storedLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open('flowchart-studio');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('diagrams', 'readonly');
      const rows = transaction.objectStore('diagrams').getAll();
      rows.onsuccess = () => resolve(rows.result.flatMap((doc: { nodes: Array<{ label: string }> }) => doc.nodes.map(node => node.label)));
      rows.onerror = () => reject(rows.error);
      transaction.oncomplete = () => db.close();
    };
  }));
}

test('server HTML explains the free editor and exposes canonical metadata without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    const html = await response!.text();
    expect(html).toContain('Free programming');
    expect(html).toContain('Where are my flowcharts saved?');
    expect(html).toContain('application/ld+json');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Free programming\s+flowchart maker/);
    await expect(page.locator('.public-lead')).toContainText('Save locally in your browser');
    await expect(page.getByRole('heading', { name: 'How to draw a flowchart', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Common questions', exact: true })).toBeVisible();
    await page.getByText('Is the editor free?', { exact: true }).click();
    const freeAnswer = page.locator('details[open]').filter({ hasText: 'Is the editor free?' }).locator('p');
    await expect(freeAnswer).toBeVisible();
    await expect(freeAnswer).toContainText(/free/i);
    await expect(freeAnswer).toContainText(/no account/i);
    await expect(freeAnswer).toContainText(/no[^.]*ads|without ads/i);
    await expect(freeAnswer).toContainText(/no[^.]*analytics|without analytics/i);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBeTruthy();
    const canonicalURL = new URL(canonical!);
    expect(canonicalURL.origin).toBe(PUBLIC_ORIGIN);
    expect(canonicalURL.pathname).toBe('/');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /programming flowcharts?/i);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical!);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    const schema = structuredNodes((await page.locator('script[type="application/ld+json"]').allTextContents()).map(text => JSON.parse(text)));
    const application = schema.find(item => hasType(item, 'WebApplication'));
    expect(application?.isAccessibleForFree).toBe(true);
    expect(schema.find(item => hasType(item, 'WebSite'))?.url).toBe(`${PUBLIC_ORIGIN}/`);
    expect(schema.find(item => hasType(item, 'Person'))).toMatchObject({ name: 'Alvin Huang', url: 'https://alvinhua.ng' });
    const offers = schema.filter(item => hasType(item, 'Offer'));
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every(offer => (offer.price === 0 || offer.price === '0') && offer.priceCurrency === 'USD')).toBe(true);
    await page.goto('/app');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${canonicalURL.origin}/app`);
  } finally { await context.close(); }
});

test('robots allows public discovery and the sitemap contains only public pages', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const rules = await robots.text();
  expect(rules).toMatch(/^User-Agent:\s*\*$/im);
  expect(rules).toMatch(/^Allow:\s*\/$/im);
  expect(rules).not.toMatch(/^Disallow:\s*\/$/im);
  expect(rules).toMatch(/^Sitemap:\s*https?:\/\/[^\s]+\/sitemap.xml$/im);
  expect(rules).toContain(`Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`);
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const locations = Array.from((await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g), match => new URL(match[1]));
  expect(locations.every(url => url.origin === PUBLIC_ORIGIN)).toBe(true);
  expect(locations.map(url => url.pathname).sort()).toEqual(['/', '/privacy', ...guides.map(guide => guide.path)].sort());
});

test('both guides load complete content, canonical metadata and article breadcrumbs directly without JavaScript', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    for (const guide of guides) {
      const response = await page.goto(guide.path);
      expect(response?.status(), guide.path).toBe(200);
      const html = await response!.text();
      expect(html).toContain(guide.headings.at(-1));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(guide.title);
      await expect(page.locator('article h2')).toHaveText(guide.headings);
      await expect(page.locator('article')).toBeVisible();
      await expect(page).toHaveTitle(new RegExp(guide.title));
      const canonical = `${PUBLIC_ORIGIN}${guide.path}`;
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical);
      await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /flowchart/i);
      await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toContainText(guide.title);
      await expect(page.getByRole('link', { name: 'Open editor', exact: true }).first()).toHaveAttribute('href', '/app');
      await expect(page.getByRole('complementary', { name: 'Related guide', exact: true }).getByRole('link')).toHaveAttribute('href', guide.related);
      const schema = structuredNodes((await page.locator('script[type="application/ld+json"]').allTextContents()).map(text => JSON.parse(text)));
      expect(schema.find(item => hasType(item, 'Article'))).toMatchObject({ headline: guide.title, url: canonical, mainEntityOfPage: canonical, author: { '@id': `${PUBLIC_ORIGIN}/#creator` } });
      expect(schema.find(item => hasType(item, 'BreadcrumbList'))?.itemListElement).toEqual([
        expect.objectContaining({ '@type': 'ListItem', position: 1, item: `${PUBLIC_ORIGIN}/` }),
        expect.objectContaining({ '@type': 'ListItem', position: 2, name: guide.title, item: canonical }),
      ]);
      if (guide.path.endsWith('how-to-draw-a-flowchart')) {
        await expect(page.locator('pre')).toContainText('while i <= 3:');
        await expect(page.getByRole('img', { name: /^Flowchart for printing the numbers 1 through 3/ })).toBeVisible();
        await expect(page.locator('figcaption')).toContainText('The output is 1, 2, then 3.');
      } else {
        const table = page.getByRole('table', { name: 'Common symbols, uses, and example labels', exact: true });
        await expect(table).toBeVisible();
        await expect(table.locator('tbody tr')).toHaveCount(7);
        for (const symbol of ['Start / End', 'Process', 'Decision', 'Input / Output', 'Function', 'Database', 'Connector']) await expect(table.getByRole('rowheader', { name: new RegExp(symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
      }
      const name = guide.path.split('/').at(-1);
      await page.screenshot({ path: testInfo.outputPath(`${name}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`${name}-mobile.png`), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  } finally { await context.close(); }
});

test('public pages and guides have no serious accessibility violations, and guides fit a narrow viewport', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  for (const route of ['/', '/privacy', ...guides.map(guide => guide.path)]) {
    if (route.startsWith('/guides/')) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect.soft(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact ?? '')), `Accessibility violations on ${route}`).toEqual([]);
    if (route.startsWith('/guides/')) await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `Horizontal overflow on ${route}`).toBeLessThanOrEqual(1);
  }
  expect(browserErrors).toEqual([]);
});

test('editing, local saving, and JSON export transmit no diagram content or HTTP requests', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const sockets: string[] = [];
  page.on('request', request => {
    if (/^https?:/.test(request.url())) requests.push({ url: request.url(), method: request.method(), body: request.postData() });
  });
  page.on('websocket', socket => sockets.push(socket.url()));
  const secret = 'Private planning label — 49b624e0';
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  const label = page.getByRole('textbox', { name: 'Node label', exact: true });
  await label.fill(secret);
  await label.press('Tab');
  await expect.poll(() => storedLabels(page)).toContain(secret);
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible();
  const downloaded = await downloadJSON(page);
  expect(downloaded.nodes.some(node => node.label === secret)).toBe(true);
  await page.waitForTimeout(750);
  expect(requests.filter(request => `${request.url} ${request.body ?? ''}`.includes(secret))).toEqual([]);
  expect(requests).toEqual([]);
  expect(sockets).toEqual([]);
});

test('a narrow editor has usable Shapes, closable Properties, and a keyboard-closable Help dialog', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toBeVisible();
  const shapes = page.getByRole('button', { name: 'Shapes', exact: true });
  await expect(shapes).toBeVisible();
  await shapes.click();
  await expect(shapes).toHaveAttribute('aria-expanded', 'true');
  const palette = page.getByRole('complementary', { name: 'Shapes', exact: true });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('button', { name: /^Add / })).toHaveCount(32);
  await palette.getByRole('button', { name: 'Add Process', exact: true }).click();
  const properties = page.getByRole('complementary', { name: 'Properties', exact: true });
  await expect(properties).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Node label', exact: true })).toBeVisible();
  await properties.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(properties).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  const helpTrigger = page.getByRole('button', { name: 'Help', exact: true });
  await helpTrigger.focus();
  await helpTrigger.press('Enter');
  const help = page.getByRole('dialog', { name: 'Help', exact: true });
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mobile-editor.png'), fullPage: true });
  await expect(helpTrigger).toBeFocused();
});

test('quota exhaustion keeps edits and JSON export available without an automatic retry loop', async ({ page }) => {
  await page.addInitScript(() => {
    const windowState = window as unknown as { quotaAttempts: number };
    windowState.quotaAttempts = 0;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'diagrams') {
        windowState.quotaAttempts += 1;
        throw new DOMException('Quota exhausted for browser test', 'QuotaExceededError');
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await page.goto('/app');
  await expect(page.getByRole('alert').filter({ hasText: /storage is full/i })).toBeVisible();
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  const label = page.getByRole('textbox', { name: 'Node label', exact: true });
  await label.fill('Recover this unsaved diagram');
  await label.press('Tab');
  await expect(page.getByRole('group', { name: 'Process: Recover this unsaved diagram', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Save failed' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toHaveCount(0);
  const downloaded = await downloadJSON(page);
  expect(downloaded.nodes.some(node => node.label === 'Recover this unsaved diagram')).toBe(true);
  const attempts = await page.evaluate(() => (window as unknown as { quotaAttempts: number }).quotaAttempts);
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => (window as unknown as { quotaAttempts: number }).quotaAttempts)).toBe(attempts);
});
