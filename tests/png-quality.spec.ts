import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

interface CanvasStats { active: boolean; widths: number[]; heights: number[]; reads: number; draws: number; blobs: number }
declare global { interface Window { pngCanvasStats: CanvasStats } }

function fixture(background: 'graph' | 'dots' = 'graph') {
  return {
    schemaVersion: 1, documentId: 'png-quality-fixture', title: 'PNG quality',
    createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', revision: 0,
    nodes: [
      { id: 'start', type: 'terminal', position: { x: 0, y: 0 }, width: 180, height: 80, label: 'Start Ω', notes: '', style: { color: 'neutral' } },
      { id: 'finish', type: 'process', position: { x: 600, y: 0 }, width: 180, height: 80, label: 'Finish café', notes: '', style: { color: 'blue' } },
      { id: 'text', type: 'process', position: { x: 372, y: 140 }, width: 180, height: 80, label: 'Café Ω →', notes: '', style: { color: 'violet' } },
    ],
    edges: [{ id: 'arrow', source: 'start', target: 'finish', sourceHandle: 'right', targetHandle: 'left', label: '', style: { color: 'blue' } }],
    drawings: [{ id: 'stroke', width: 8, color: 'rose', points: [{ x: 350, y: 90, pressure: 0.5 }, { x: 480, y: 120, pressure: 0.7 }, { x: 590, y: 100, pressure: 0.4 }] }],
    viewport: { x: 80, y: 80, zoom: 1 }, settings: { snapToGrid: true, gridVisible: true, background },
  };
}

async function instrumentCanvas(page: Page) {
  await page.addInitScript(() => {
    window.pngCanvasStats = { active: false, widths: [], heights: [], reads: 0, draws: 0, blobs: 0 };
    for (const name of ['drawImage', 'getImageData'] as const) {
      const original = CanvasRenderingContext2D.prototype[name];
      Object.defineProperty(CanvasRenderingContext2D.prototype, name, { configurable: true, value: function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        const stats = window.pngCanvasStats;
        if (stats.active) {
          stats.widths.push(this.canvas.width); stats.heights.push(this.canvas.height);
          if (name === 'drawImage') stats.draws++; else stats.reads++;
        }
        return Reflect.apply(original, this, args);
      } });
    }
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', { configurable: true, value: function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (window.pngCanvasStats.active) window.pngCanvasStats.blobs++;
      return Reflect.apply(toBlob, this, args);
    } });
  });
}

async function importFixture(page: Page, value: ReturnType<typeof fixture>) {
  await page.goto('/app');
  await page.locator('input[type="file"]').setInputFiles({ name: 'png-quality.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(value.title);
}

async function exportFile(page: Page, format: 'SVG' | 'PNG' | 'JSON') {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: `Export ${format}`, exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
  return readFile((await download.path())!);
}

function svgBounds(svg: string) {
  const values = svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number);
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

function pngSize(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function beginCanvasRecording(page: Page) {
  await page.evaluate(() => { window.pngCanvasStats.active = true; });
}

async function assertBoundedCanvas(page: Page) {
  const stats = await page.evaluate(() => { window.pngCanvasStats.active = false; return window.pngCanvasStats; });
  expect(stats.draws).toBeGreaterThan(0);
  expect(stats.reads).toBeGreaterThan(0);
  expect(Math.max(...stats.widths)).toBeLessThanOrEqual(2052);
  expect(Math.max(...stats.heights)).toBeLessThanOrEqual(132);
  expect(stats.blobs).toBe(0);
}

async function compareReferenceCrops(page: Page, svg: string, png: Buffer, crops: Array<{ x: number; y: number; width: number; height: number }>) {
  const size = pngSize(png);
  return page.evaluate(async ({ svg, png, size, crops }) => {
    async function load(source: string) {
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not decode exported image')); image.src = source; });
      return image;
    }
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    root.setAttribute('width', String(size.width)); root.setAttribute('height', String(size.height));
    const url = URL.createObjectURL(new Blob([root.outerHTML], { type: 'image/svg+xml' }));
    try {
      const [reference, exported] = await Promise.all([load(url), load(`data:image/png;base64,${png}`)]);
      return crops.map(crop => {
        const canvas = document.createElement('canvas'); canvas.width = crop.width; canvas.height = crop.height;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(reference, -crop.x, -crop.y);
        const expected = context.getImageData(0, 0, crop.width, crop.height).data;
        context.clearRect(0, 0, crop.width, crop.height);
        context.drawImage(exported, -crop.x, -crop.y);
        const actual = context.getImageData(0, 0, crop.width, crop.height).data;
        let different = 0, content = 0, maxDifference = 0;
        for (let index = 0; index < actual.length; index += 4) {
          const difference = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(actual[index + channel] - expected[index + channel])));
          if (difference > 8) different++;
          maxDifference = Math.max(maxDifference, difference);
          if (expected[index] < 200 || expected[index + 1] < 200 || expected[index + 2] < 200) content++;
        }
        return { differentFraction: different / (crop.width * crop.height), content, maxDifference };
      });
    } finally { URL.revokeObjectURL(url); }
  }, { svg, png: png.toString('base64'), size, crops });
}

test('PNG uses four pixels per diagram unit and keeps text, arrows, graph paper and freehand across tiles', async ({ page }) => {
  test.setTimeout(90_000);
  await instrumentCanvas(page);
  await importFixture(page, fixture());
  const svg = (await exportFile(page, 'SVG')).toString('utf8');
  const bounds = svgBounds(svg);
  await beginCanvasRecording(page);
  const png = await exportFile(page, 'PNG');
  expect(pngSize(png)).toEqual({ width: Math.floor(bounds.width * 4), height: Math.floor(bounds.height * 4) });
  await assertBoundedCanvas(page);
  // These crops cross a vertical tile edge, horizontal band edges, and their intersection.
  const samples = await compareReferenceCrops(page, svg, png, [
    { x: 2000, y: 112, width: 96, height: 48 },
    { x: 2000, y: 336, width: 96, height: 64 },
    { x: 2000, y: 632, width: 96, height: 96 },
    { x: 1952, y: 896, width: 192, height: 96 },
    { x: 2536, y: 336, width: 96, height: 64 },
  ]);
  for (const sample of samples) expect(sample.differentFraction, JSON.stringify(sample)).toBeLessThan(0.01);
  for (const sample of samples.slice(1)) expect(sample.content).toBeGreaterThan(10);
});

test('PNG exceeds the former pixel limit while using small canvases and includes distant content on dots', async ({ page }) => {
  test.setTimeout(90_000);
  await instrumentCanvas(page);
  const value = fixture('dots');
  value.nodes = value.nodes.slice(0, 2); value.nodes[1].position = { x: 1200, y: 600 };
  value.drawings = []; value.edges = [];
  await importFixture(page, value);
  const svg = (await exportFile(page, 'SVG')).toString('utf8');
  const bounds = svgBounds(svg);
  await beginCanvasRecording(page);
  const png = await exportFile(page, 'PNG');
  const size = pngSize(png);
  expect(size).toEqual({ width: Math.floor(bounds.width * 4), height: Math.floor(bounds.height * 4) });
  expect(size.width * size.height).toBeGreaterThan(18_000_000);
  expect(size.width * size.height).toBeLessThanOrEqual(64_000_000);
  expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(16_384);
  await assertBoundedCanvas(page);
  const samples = await compareReferenceCrops(page, svg, png, [
    { x: 2000, y: 112, width: 96, height: 48 },
    { x: size.width - 800, y: size.height - 520, width: 560, height: 320 },
  ]);
  for (const sample of samples) expect(sample.differentFraction, JSON.stringify(sample)).toBeLessThan(0.01);
  expect(samples[1].content).toBeGreaterThan(100);
});

test('a diagram beyond readable PNG limits reports SVG or PDF and preserves the editable document', async ({ page }) => {
  const value = fixture();
  value.nodes[0].position = { x: -50_000, y: -50_000 }; value.nodes[1].position = { x: 50_000, y: 50_000 };
  value.title = 'Keep spread diagram';
  await importFixture(page, value);
  const before = JSON.parse((await exportFile(page, 'JSON')).toString('utf8'));
  const pngDownloads: string[] = [];
  page.on('download', download => { if (download.suggestedFilename().endsWith('.png')) pngDownloads.push(download.suggestedFilename()); });
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /too large.*PNG.*SVG or PDF/i })).toBeVisible();
  await expect(page.getByText('Exporting PNG…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(value.title);
  const after = JSON.parse((await exportFile(page, 'JSON')).toString('utf8'));
  expect(after).toEqual(before);
  expect(pngDownloads).toEqual([]);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Diagram title', exact: true })).toHaveValue(value.title);
  const reopened = JSON.parse((await exportFile(page, 'JSON')).toString('utf8'));
  expect(reopened.nodes).toEqual(before.nodes);
  expect(reopened.drawings).toEqual(before.drawings);
});
