import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

async function prepare(page: Page, portrait = false) {
  await page.addInitScript(() => {
    const state = window as unknown as { exportTypes: string[]; labelImages: string[] };
    state.exportTypes = [];
    state.labelImages = [];
    const originalImage = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const result = originalImage.apply(this, args);
      if (result.startsWith('data:image/png;')) state.labelImages.push(result);
      return result;
    };
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
      { id: 'end', type: 'terminal', position: { x: portrait ? -1100 : 900, y: portrait ? 1600 : -300 }, width: 180, height: 80, label: 'Complete Ω Ж', notes: '', style: { color: 'neutral' } },
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

/** Read classic xref entries by byte offset, independently of the exporter's object order. */
function pdfObjects(bytes: Buffer) {
  const source = bytes.toString('latin1');
  const start = source.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
  expect(start, 'PDF has a final cross-reference pointer').toBeTruthy();
  const xref = Number(start![1]);
  expect(source.slice(xref)).toMatch(/^xref\s/);
  const lines = source.slice(xref).split(/\r?\n/);
  const offsets: { id: number; offset: number }[] = [];
  let cursor = 1;
  while (lines[cursor] && !lines[cursor].startsWith('trailer')) {
    const header = lines[cursor++].trim().match(/^(\d+) (\d+)$/);
    expect(header, 'xref subsection header').toBeTruthy();
    const first = Number(header![1]), count = Number(header![2]);
    for (let index = 0; index < count; index++) {
      const entry = lines[cursor++].match(/^(\d{10}) (\d{5}) ([nf])\s*$/);
      expect(entry, 'valid byte-based xref entry').toBeTruthy();
      if (entry![3] === 'n') {
        const offset = Number(entry![1]);
        const id = first + index;
        expect(source.slice(offset)).toMatch(new RegExp(`^${id} ${Number(entry![2])} obj\\b`));
        offsets.push({ id, offset });
      }
    }
  }
  offsets.sort((left, right) => left.offset - right.offset);
  return offsets.map(({ id, offset }, index) => {
    const object = source.slice(offset, offsets[index + 1]?.offset ?? xref);
    const stream = object.match(/stream\r?\n/);
    const dictionary = stream ? object.slice(0, stream.index) : object;
    let content: Buffer | undefined;
    if (stream) {
      const length = Number(dictionary.match(/\/Length\s+(\d+)\b/)?.[1]);
      expect(Number.isInteger(length), 'stream byte length').toBe(true);
      const begin = offset + stream.index! + stream[0].length;
      const raw = bytes.subarray(begin, begin + length);
      expect(source.slice(begin + length)).toMatch(/^\s*endstream/);
      content = /\/FlateDecode\b/.test(dictionary) ? inflateSync(raw) : raw;
    }
    return { id, dictionary, content };
  });
}

for (const portrait of [false, true]) {
  test(`PDF downloads a complete ${portrait ? 'portrait' : 'landscape'} vector scene at its native size`, async ({ page }) => {
    await prepare(page, portrait);
    const svg = (await download(page, 'SVG')).toString('utf8');
    const viewBox = svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number);
    const outbound: string[] = [];
    page.on('request', request => {
      if (request.method() !== 'GET') outbound.push(`${request.method()} ${request.url()}`);
    });
    const bytes = await download(page, 'PDF');
    await mkdir('outputs', { recursive: true });
    const artifact = `outputs/pdf-quality-${portrait ? 'portrait' : 'landscape'}`;
    await Promise.all([writeFile(`${artifact}.pdf`, bytes), writeFile(`${artifact}.svg`, svg)]);
    expect(bytes.length).toBeGreaterThan(5000);
    const source = bytes.toString('latin1');
    expect(source.slice(0, 9)).toMatch(/^%PDF-1\.[4-7]\s/);
    expect(source.slice(-32)).toMatch(/%%EOF\s*$/);
    const objects = pdfObjects(bytes);
    const pages = objects.filter(object => /\/Type\s*\/Page\b/.test(object.dictionary));
    expect(pages).toHaveLength(1);
    const media = pages[0].dictionary.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(media).toBeTruthy();
    const pageWidth = Number(media![1]), pageHeight = Number(media![2]);
    expect(pageWidth).toBeCloseTo(viewBox[2] * 0.75, 4);
    expect(pageHeight).toBeCloseTo(viewBox[3] * 0.75, 4);
    expect(portrait ? pageHeight > pageWidth : pageWidth > pageHeight).toBe(true);
    // Both fixtures exceed A4; fitting the scene onto A4 would shrink the labels.
    expect(Math.max(pageWidth, pageHeight)).toBeGreaterThan(1400);
    expect(/\/FontFile2\s+\d+ 0 R/.test(source), 'PDF embeds its text font').toBe(true);
    expect(/\/ToUnicode\s+\d+ 0 R/.test(source), 'PDF includes a Unicode text map').toBe(true);
    const unicodeMaps = objects.filter(object => object.content?.includes(Buffer.from('begincmap')))
      .map(object => object.content!.toString('latin1')).join('\n');
    expect(unicodeMaps).toMatch(/<03a9>/i);
    expect(unicodeMaps).toMatch(/<0416>/i);
    expect(/\/PatternType\s+1\b/.test(source), 'PDF preserves the graph background pattern').toBe(true);
    const graphics = objects.filter(object => object.content && !/\/Subtype\s*\/Image\b|\/Length1\b/.test(object.dictionary))
      .map(object => object.content!.toString('latin1')).join('\n');
    expect(graphics).toMatch(/(?:^|\n)[-\d. ]+ m(?:\r?\n|$)/);
    expect(graphics).toMatch(/(?:^|\n)[-\d. ]+ [lc](?:\r?\n|$)/);
    expect(graphics).toMatch(/\bBT\b[\s\S]*?\bTf\b[\s\S]*?\bTj\b[\s\S]*?\bET\b/);
    const images = objects.filter(object => /\/Subtype\s*\/Image\b/.test(object.dictionary));
    expect(images.length, 'unsupported Unicode labels have a local bitmap fallback').toBeGreaterThan(0);
    for (const image of images) {
      expect(image.dictionary).not.toContain('/DCTDecode');
      const width = Number(image.dictionary.match(/\/Width\s+(\d+)/)![1]);
      const height = Number(image.dictionary.match(/\/Height\s+(\d+)/)![1]);
      expect(width).toBeLessThan(4000);
      expect(height).toBeLessThan(1000);
      expect(width / height, 'label images are not full-scene snapshots').toBeGreaterThan(2);
    }
    const fallback = await page.evaluate(async () => {
      const sources = (window as unknown as { labelImages: string[] }).labelImages;
      return Promise.all(sources.map(async source => {
        const bitmap = await createImageBitmap(await (await fetch(source)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let transparent = 0, ink = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] === 0) transparent++;
          else if (pixels[index + 3] > 100 && Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 180) ink++;
        }
        const result = { width: bitmap.width, height: bitmap.height, transparent, ink };
        bitmap.close();
        return result;
      }));
    });
    expect(fallback.length).toBeGreaterThan(0);
    for (const label of fallback) {
      expect(label.width).toBeGreaterThan(100);
      expect(label.height).toBeGreaterThanOrEqual(112);
      expect(label.transparent).toBeGreaterThan(label.width * label.height * 0.1);
      expect(label.ink).toBeGreaterThan(500);
      expect(images.some(image => Number(image.dictionary.match(/\/Width\s+(\d+)/)![1]) === label.width
        && Number(image.dictionary.match(/\/Height\s+(\d+)/)![1]) === label.height), 'rendered fallback is embedded in the PDF').toBe(true);
    }
    expect(outbound, 'export never sends diagram data to a service').toEqual([]);
  });
}
