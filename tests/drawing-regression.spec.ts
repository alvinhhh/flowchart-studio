import { expect, test, type Page } from '@playwright/test';

async function dispatchCaptureSequence(page: Page, ending: 'released-with-up' | 'released-without-up' | 'held-outside-up' | 'held-outside-hover' | 'held-overlay-hover' | 'held-cancel' | 'pointercancel' | 'escape' | 'blur') {
  await page.locator('.drawing-input').evaluate((element, ending) => {
    const rect = element.getBoundingClientRect();
    const pointer = (type: string, x: number, y: number, buttons: number, target: EventTarget = element, button = 0) => target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 891, pointerType: 'mouse', isPrimary: true,
      button, buttons, clientX: x, clientY: y, pressure: buttons ? .5 : 0,
    }));
    const start = { x: rect.x + 250, y: rect.y + 250 };
    pointer('pointerdown', start.x, start.y, 1);
    // The whole gesture ends before the next animation frame, like a quick loop.
    for (let i = 1; i <= 14; i++) {
      const angle = i / 14 * Math.PI * 1.9;
      pointer('pointermove', start.x + 31.5 * Math.cos(angle), start.y + 22 * Math.sin(angle), 1);
    }
    if (ending === 'pointercancel') pointer('pointercancel', 0, 0, 0);
    if (ending === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    if (ending === 'blur') window.dispatchEvent(new Event('blur'));
    const held = ending.startsWith('held-');
    pointer('lostpointercapture', 0, 0, held ? 1 : 0, element, -1);
    if (held) {
      pointer('pointermove', start.x + 35, start.y + 5, 1, window);
      if (ending === 'held-cancel') pointer('pointercancel', 0, 0, 0, window);
      else if (ending === 'held-outside-hover') pointer('pointermove', 0, 0, 0, window);
      else if (ending === 'held-overlay-hover') pointer('pointermove', 0, 0, 0);
      else pointer('pointerup', start.x + 38, start.y + 5, 0, window);
    } else if (ending !== 'released-without-up') {
      pointer('pointerup', start.x + 30, start.y, 0);
    }
    // A repeated late terminal event must not add a second stroke.
    if (ending !== 'released-without-up') pointer('pointerup', start.x + 30, start.y, 0, window);
  }, ending);
}

async function openDrawing(page: Page, size = 1, zoom = 1) {
  await page.goto('/app');
  const date = '2026-11-02T00:00:00.000Z';
  const fixture = { schemaVersion: 1, documentId: 'handwriting-regression', title: 'Handwriting regression', createdAt: date, updatedAt: date, revision: 0,
    nodes: [], edges: [], drawings: [], viewport: { x: 0, y: 0, zoom }, settings: { snapToGrid: false, gridVisible: false, background: 'blank' } };
  await page.locator('input[type="file"]').setInputFiles({ name: 'handwriting.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(fixture.title);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await page.getByRole('combobox', { name: 'Pen width', exact: true }).selectOption('3');
  await page.getByRole('button', { name: 'Draw', exact: true }).focus();
  const rect = (await page.locator('.drawing-input').boundingBox())!;
  const points = Array.from({ length: 16 }, (_, i) => ({ x: rect.x + 200 + i * 40 * size / 15, y: rect.y + 240 }));
  for (let i = 1; i <= 96; i++) {
    const angle = i / 96 * 1.8 * Math.PI;
    points.push({ x: rect.x + 200 + size * (20 + 20 * Math.cos(angle)), y: rect.y + 240 - size * 20 * Math.sin(angle) });
  }
  await page.evaluate(() => {
    const events: string[] = [];
    (window as unknown as { drawingEvents: string[] }).drawingEvents = events;
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
      window.addEventListener(type, event => events.push(`${event.type}:${'pointerType' in event ? event.pointerType : ''}`), true);
    }
  });
  return points;
}

async function inkCoverage(page: Page, selector: string) {
  return page.locator(selector).evaluate(element => {
    const path = element as SVGPathElement;
    const box = path.getBBox();
    let ink = 0;
    for (let x = box.x; x < box.x + box.width; x += .5) {
      for (let y = box.y; y < box.y + box.height; y += .5) {
        if (path.isPointInFill(new DOMPoint(x, y))) ink++;
      }
    }
    return ink;
  });
}

async function assertSavedInk(page: Page, before: number) {
  const events = await page.evaluate(() => (window as unknown as { drawingEvents: string[] }).drawingEvents);
  await expect(page.locator('.drawing-stroke'), JSON.stringify(events)).toHaveCount(1);
  await expect(page.locator('.drawing-preview')).toHaveCount(0);
  expect(await inkCoverage(page, '.drawing-stroke')).toBeGreaterThan(before * .95);
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('flowchart-studio');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('diagrams');
      const query = transaction.objectStore('diagrams').getAll();
      query.onsuccess = () => resolve(query.result.find(doc => doc.title === 'Handwriting regression')?.drawings.length ?? 0);
      transaction.oncomplete = () => db.close();
    };
  }))).toBe(1);
  const path = await page.locator('.drawing-stroke').getAttribute('d');
  await page.reload();
  await expect(page.locator('.drawing-stroke')).toHaveAttribute('d', path!);
}

test('a lowercase e retains its visible ink and persists when the mouse is released', async ({ page }) => {
  const points = await openDrawing(page);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  await expect(page.locator('.drawing-preview')).toBeVisible();
  const before = await inkCoverage(page, '.drawing-preview');
  expect(before).toBeGreaterThan(200);
  await page.mouse.up();
  await assertSavedInk(page, before);
});

test('tight lowercase e curves survive a fast mouse gesture with Draw focused', async ({ page }) => {
  const points = await openDrawing(page, .25);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (let i = 4; i < points.length; i += 4) await page.mouse.move(points[i].x, points[i].y);
  const endpoint = points.at(-1)!;
  await page.mouse.move(endpoint.x, endpoint.y);
  await expect(page.locator('.drawing-preview')).toBeVisible();
  const before = await inkCoverage(page, '.drawing-preview');
  expect(before).toBeGreaterThan(50);
  await page.mouse.up();
  await assertSavedInk(page, before);
});

test('a lowercase e retains its visible ink after a browser touch gesture ends', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Native touch dispatch uses the Chromium browser protocol.');
  const points = await openDrawing(page);
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }] });
  for (const point of points.slice(1)) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
  await expect(page.locator('.drawing-preview')).toBeVisible();
  const before = await inkCoverage(page, '.drawing-preview');
  expect(before).toBeGreaterThan(200);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await assertSavedInk(page, before);
});

for (const ending of ['released-with-up', 'released-without-up', 'held-outside-up', 'held-outside-hover', 'held-overlay-hover'] as const) {
  test(`capture loss ${ending} commits a quick loop exactly once and preserves its contact coordinates`, async ({ page }) => {
    await openDrawing(page);
    await dispatchCaptureSequence(page, ending);
    await expect(page.locator('.drawing-stroke')).toHaveCount(1);
    const bounds = await page.locator('.drawing-stroke').evaluate(element => {
      const box = (element as SVGPathElement).getBBox();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    expect(bounds.x).toBeGreaterThan(200);
    expect(bounds.y).toBeGreaterThan(200);
    expect(bounds.width).toBeLessThan(80);
    expect(bounds.height).toBeLessThan(60);
    expect(await inkCoverage(page, '.drawing-stroke')).toBeGreaterThan(200);
    await expect(page.locator('.drawing-preview')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.drawing-stroke')).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator('.drawing-stroke')).toHaveCount(1);
  });
}

for (const ending of ['pointercancel', 'escape', 'blur', 'held-cancel'] as const) {
  test(`${ending} still cancels a quick loop before capture loss`, async ({ page }) => {
    await openDrawing(page);
    await dispatchCaptureSequence(page, ending);
    await expect(page.locator('.drawing-stroke')).toHaveCount(0);
    await expect(page.locator('.drawing-preview')).toHaveCount(0);
    // A following normal stroke proves the cancelled gesture and listeners cleared.
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    const rect = (await page.locator('.drawing-input').boundingBox())!;
    await page.mouse.move(rect.x + 350, rect.y + 250);
    await page.mouse.down();
    await page.mouse.move(rect.x + 390, rect.y + 260);
    await page.mouse.up();
    await expect(page.locator('.drawing-stroke')).toHaveCount(1);
  });
}

for (const zoom of [.1, 1, 4]) {
  test(`1–8px e and o loops retain their ink at ${zoom} zoom`, async ({ page }) => {
    test.setTimeout(90_000);
    await openDrawing(page, 1, zoom);
    const rect = (await page.locator('.drawing-input').boundingBox())!;
    let count = 0;
    for (const width of [1, 3, 12]) {
      await page.getByRole('combobox', { name: 'Pen width', exact: true }).selectOption(String(width));
      for (const diameter of [1, 2, 4, 8]) {
        for (const letter of ['e', 'o']) {
          const center = { x: rect.x + 250 + (count % 8) * 30, y: rect.y + 220 + Math.floor(count / 8) * 35 };
          const points: { x: number; y: number }[] = [];
          if (letter === 'e') {
            for (let i = 0; i < 8; i++) points.push({ x: center.x - diameter / 2 + i * diameter / 7, y: center.y });
          }
          for (let i = letter === 'e' ? 1 : 0; i < 24; i++) {
            const angle = i / 24 * (letter === 'e' ? 1.8 : 2) * Math.PI;
            points.push({ x: center.x + diameter / 2 * Math.cos(angle), y: center.y - diameter / 2 * Math.sin(angle) });
          }
          await page.mouse.move(points[0].x, points[0].y);
          await page.mouse.down();
          for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
          await expect(page.locator('.drawing-preview')).toBeVisible();
          const before = await inkCoverage(page, '.drawing-preview');
          const previewPath = await page.locator('.drawing-preview').getAttribute('d');
          if (letter === 'o') await page.mouse.move(points[0].x, points[0].y);
          await page.mouse.up();
          await expect(page.locator('.drawing-stroke')).toHaveCount(++count);
          const saved = page.locator('.drawing-stroke').last();
          const after = await saved.evaluate(element => {
            const path = element as SVGPathElement, box = path.getBBox();
            let ink = 0;
            for (let x = box.x; x < box.x + box.width; x += .5) for (let y = box.y; y < box.y + box.height; y += .5) {
              if (path.isPointInFill(new DOMPoint(x, y))) ink++;
            }
            return ink;
          });
          expect(after, JSON.stringify({ letter, diameter, width, zoom, before, after, previewPath, committedPath: await saved.getAttribute('d') })).toBeGreaterThan(0);
          expect(after, JSON.stringify({ letter, diameter, width, zoom, before, after })).toBeGreaterThanOrEqual(before * .6);
        }
      }
    }
  });
}
