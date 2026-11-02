import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function prepare(page: Page, portrait = false) {
  await page.addInitScript(() => {
    const state = window as unknown as { exportTypes: string[] };
    state.exportTypes = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = object => {
      if (object instanceof Blob) state.exportTypes.push(object.type);
      return original(object);
    };
  });
  await page.goto('/app');
  const date = '2026-11-02T00:00:00.000Z';
  const fixture = {
    schemaVersion: 1, documentId: 'export-formats', title: 'Print: review / 漢字', createdAt: date, updatedAt: date, revision: 0,
    nodes: [
      { id: 'resized', type: 'process', position: { x: -1200, y: -400 }, width: 380, height: 180, label: 'Review 漢字 🧭 <script>', notes: '', style: { color: 'blue' } },
      { id: 'end', type: 'terminal', position: { x: portrait ? -1100 : 900, y: portrait ? 1600 : -300 }, width: 180, height: 80, label: 'Complete', notes: '', style: { color: 'neutral' } },
    ],
    edges: [{ id: 'route', source: 'resized', target: 'end', sourceHandle: 'right', targetHandle: 'left', label: 'Go & check', style: { color: 'rose' } }],
    drawings: [{ id: 'ink', color: 'violet', width: 8, points: [{ x: -1300, y: -500, pressure: 0.5 }, { x: -1250, y: -450, pressure: 0.9 }] }],
    viewport: { x: 0, y: 0, zoom: 0.2 }, settings: { snapToGrid: false, gridVisible: true, background: 'graph' },
  };
  await page.locator('input[type="file"]').setInputFiles({ name: 'exports.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(fixture.title);
}

async function download(page: Page, format: 'SVG' | 'PDF') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: `Export ${format}`, exact: true }).click();
  const result = await pending;
  expect(await result.failure()).toBeNull();
  expect(result.suggestedFilename()).toBe(`Print- review - 漢字.${format.toLowerCase()}`);
  expect(await page.evaluate(() => (window as unknown as { exportTypes: string[] }).exportTypes.at(-1)))
    .toBe(format === 'SVG' ? 'image/svg+xml;charset=utf-8' : 'application/pdf');
  return readFile((await result.path())!);
}

test('SVG downloads the whole vector scene with resized geometry, escaped Unicode labels, ink and background', async ({ page }) => {
  await prepare(page);
  const bytes = await download(page, 'SVG');
  expect(bytes.length).toBeGreaterThan(1000);
  const svg = bytes.toString('utf8');
  const parsed = await page.evaluate(source => {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    const root = doc.documentElement;
    const resized = root.querySelector('g[transform="translate(-1200 -400)"]');
    return {
      parseErrors: doc.querySelectorAll('parsererror').length,
      namespace: root.namespaceURI,
      viewBox: root.getAttribute('viewBox')!.split(' ').map(Number),
      text: root.textContent,
      resizedPath: resized?.querySelector('path')?.getAttribute('d'),
      unsafe: root.querySelectorAll('script, foreignObject, image').length,
      ink: !!root.querySelector('[data-drawing-id="ink"]'),
      graph: !!root.querySelector('#background-graph'),
    };
  }, svg);
  expect(parsed.parseErrors).toBe(0);
  expect(parsed.namespace).toBe('http://www.w3.org/2000/svg');
  expect(parsed.viewBox[0]).toBeLessThan(-1300);
  expect(parsed.viewBox[1]).toBeLessThan(-500);
  expect(parsed.viewBox[0] + parsed.viewBox[2]).toBeGreaterThan(1080);
  expect(parsed.viewBox[1] + parsed.viewBox[3]).toBeGreaterThan(-220);
  expect(parsed.resizedPath).toContain('380');
  expect(parsed.resizedPath).toContain('180');
  expect(parsed.text).toContain('漢字');
  expect(parsed.text).toContain('🧭');
  expect(parsed.text).toContain('<script>');
  expect(parsed.text).toContain('Go & check');
  expect(parsed.unsafe).toBe(0);
  expect(parsed.ink).toBe(true);
  expect(parsed.graph).toBe(true);
});

for (const portrait of [false, true]) {
  test(`PDF downloads a complete ${portrait ? 'portrait' : 'landscape'} A4 image with valid binary references`, async ({ page }) => {
    await prepare(page, portrait);
    const bytes = await download(page, 'PDF');
    expect(bytes.length).toBeGreaterThan(5000);
    const pdf = bytes.toString('latin1');
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain(portrait ? '/MediaBox [0 0 595.28 841.89]' : '/MediaBox [0 0 841.89 595.28]');
    const image = pdf.match(/\/Subtype \/Image \/Width (\d+) \/Height (\d+).*?\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/s)!;
    expect(image).toBeTruthy();
    const width = Number(image[1]), height = Number(image[2]), length = Number(image[3]);
    expect(width * height).toBeLessThanOrEqual(16_000_000);
    expect(Math.max(width, height)).toBeGreaterThan(3000);
    expect(portrait ? height > width : width > height).toBe(true);
    const start = image.index! + image[0].length;
    const jpeg = bytes.subarray(start, start + length);
    expect(jpeg.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(jpeg.subarray(-2).toString('hex')).toBe('ffd9');
    const decoded = await page.evaluate(async base64 => {
      const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let colored = 0;
      for (let index = 0; index < pixels.length; index += 16) {
        if (Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 180) colored += 1;
      }
      const result = { width: bitmap.width, height: bitmap.height, colored };
      bitmap.close();
      return result;
    }, jpeg.toString('base64'));
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width, height });
    expect(decoded.colored).toBeGreaterThan(500);
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref)).toMatch(/^xref\n0 6\n/);
    pdf.slice(xref).split('\n').slice(3, 8).forEach((entry, index) => {
      expect(pdf.slice(Number(entry.slice(0, 10)))).toMatch(new RegExp(`^${index + 1} 0 obj\\n`));
    });
  });
}
