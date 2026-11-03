import { expect, test } from '@playwright/test';

// This suite uses an isolated Pages worker and local D1/KV, never production counters.
test.beforeEach(async ({ baseURL }) => {
  test.skip(!baseURL?.startsWith('http://127.0.0.1:8788'), 'Requires the local metrics worker');
});

test('a browser is counted once; only first saved content and successful shares increase totals', async ({ page, request }) => {
  const stats = async () => (await request.get('/api/stats', { headers: { 'Cache-Control': 'no-cache' } })).json();
  const before = await stats();
  const events: Array<{ body: Record<string, unknown>; headers: Record<string, string> }> = [];
  page.on('request', event => {
    if (new URL(event.url()).pathname === '/api/metrics') events.push({ body: event.postDataJSON(), headers: event.headers() });
  });
  await page.goto('/app');
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toBeVisible();
  await expect.poll(async () => (await stats()).visitors).toBe(before.visitors + 1);
  expect((await stats()).chartsCreated).toBe(before.chartsCreated);
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await expect.poll(async () => (await stats()).chartsCreated).toBe(before.chartsCreated + 1);
  await page.getByRole('textbox', { name: 'Node label', exact: true }).fill('Content stays local');
  await page.getByRole('textbox', { name: 'Node label', exact: true }).press('Tab');
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  expect(await stats()).toMatchObject({ visitors: before.visitors + 1, chartsCreated: before.chartsCreated + 1, chartsShared: before.chartsShared });
  for (const event of events) {
    expect(Object.keys(event.body).sort()).toEqual(['day', 'id', 'type']);
    expect(event.body.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(event.headers.referer || '').toBe('');
    expect(JSON.stringify(event.body)).not.toContain('Content stays local');
  }
  expect(events.map(event => event.body.type).sort()).toEqual(['chart_created', 'visit']);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.getByRole('button', { name: 'Create link', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Share link', exact: true })).toHaveValue(/\/share#/);
  await expect.poll(async () => (await stats()).chartsShared).toBe(before.chartsShared + 1);
});

test('privacy opt-out prevents client metrics while editing and saving remain usable', async ({ page, request }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true }));
  const before = await (await request.get('/api/stats')).json();
  let requests = 0;
  page.on('request', event => { if (new URL(event.url()).pathname === '/api/metrics') requests++; });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Add Process', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  expect(requests).toBe(0);
  expect(await (await request.get('/api/stats')).json()).toMatchObject(before);
});
