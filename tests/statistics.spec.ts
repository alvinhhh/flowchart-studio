import { expect, test } from '@playwright/test';

const totals = { startedAt: '2026-11-03T12:00:00.000Z', visitors: 12345, chartsCreated: 4567, chartsShared: 89 };

test('homepage shows all-time totals and identifies the fixed uptime target', async ({ page }) => {
  await page.route('**/api/stats', route => route.fulfill({ json: totals }));
  await page.goto('/');
  const statistics = page.getByRole('region', { name: 'Site statistics' });
  await expect(statistics.locator('dd')).toHaveText(['12,345', '4,567', '89', '99.99%']);
  await expect(statistics.locator('dt')).toHaveText(['Visitors', 'Charts created', 'Charts shared', 'Uptime target']);
  await expect(statistics).toContainText('All-time counts since Nov 3, 2026');
  await statistics.getByRole('link', { name: 'How counts work' }).click();
  await expect(page.locator('#site-statistics')).toContainText('browser profiles seen, not unique people');
  await expect(page.locator('#site-statistics')).toContainText('not a measurement of availability');
});

test('failed or malformed statistics do not appear as zero usage', async ({ page }) => {
  for (const response of [{ status: 503, json: { error: 'Unavailable' } }, { status: 200, json: { ...totals, visitors: -1 } }]) {
    await page.route('**/api/stats', route => route.fulfill(response));
    await page.goto('/');
    const statistics = page.getByRole('region', { name: 'Site statistics' });
    await expect(statistics).toContainText('Counts temporarily unavailable.');
    await expect(statistics.locator('dd')).toHaveText(['—', '—', '—', '99.99%']);
    await page.unroute('**/api/stats');
  }
});

test('zero is a valid count and the four counters fit on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route('**/api/stats', route => route.fulfill({ json: { ...totals, visitors: 0, chartsCreated: 0, chartsShared: 0 } }));
  await page.goto('/');
  const statistics = page.getByRole('region', { name: 'Site statistics' });
  await expect(statistics.locator('dd')).toHaveText(['0', '0', '0', '99.99%']);
  const overflow = await statistics.evaluate(element => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
});
