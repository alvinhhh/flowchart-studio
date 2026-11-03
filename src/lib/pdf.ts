const POINTS_PER_PIXEL = 72 / 96;
const MAX_PAGE_SIZE = 14_400;
const MIN_PAGE_SIZE = 72;
const FONT_NAME = 'FlowchartPDFSans';
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PdfLayout {
  pageWidth: number;
  pageHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  scale: number;
}

/** Keep canvas text at its natural size instead of shrinking the entire diagram onto A4. */
export function pdfLayout(width: number, height: number): PdfLayout {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('The diagram has invalid export dimensions. Correct the diagram, then try again.');
  }
  const scale = Math.min(POINTS_PER_PIXEL, MAX_PAGE_SIZE / Math.max(width, height));
  const imageWidth = width * scale;
  const imageHeight = height * scale;
  const pageWidth = Math.max(MIN_PAGE_SIZE, imageWidth);
  const pageHeight = Math.max(MIN_PAGE_SIZE, imageHeight);
  return { pageWidth, pageHeight, imageWidth, imageHeight, scale,
    imageX: (pageWidth - imageWidth) / 2, imageY: (pageHeight - imageHeight) / 2 };
}

type FontData = { base64: string; coverage: [number, number][] };
let fontPromise: Promise<FontData> | undefined;

function exportFont(): Promise<FontData> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const [fontResponse, coverageResponse] = await Promise.all([
        fetch('/fonts/NotoSans-Medium.ttf', { signal: AbortSignal.timeout(20_000) }),
        fetch('/fonts/pdf-sans-coverage.json', { signal: AbortSignal.timeout(20_000) }),
      ]);
      if (!fontResponse.ok || !coverageResponse.ok) throw new Error('Font download failed');
      const [buffer, coverage] = await Promise.all([
        fontResponse.arrayBuffer(), coverageResponse.json() as Promise<[number, number][]>,
      ]);
      const face = new FontFace(FONT_NAME, buffer);
      await face.load();
      document.fonts.add(face);
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      }
      return { base64: btoa(binary), coverage };
    })().catch(() => {
      fontPromise = undefined;
      throw new Error('The PDF font could not load. Reconnect and try again, or export SVG.');
    });
  }
  return fontPromise;
}

/** Unsupported scripts and emoji use the browser's shaping and font fallback, one label at a time. */
function labelImage(text: Element): SVGImageElement {
  const fontSize = Number(text.getAttribute('font-size')) || 14;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not render a PDF label. Try exporting SVG.');
  const font = `500 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.font = font;
  context.textAlign = 'center';
  const lines = [...text.querySelectorAll('tspan')].map(span => ({
    value: span.textContent ?? '', x: Number(span.getAttribute('x')), y: Number(span.getAttribute('y')),
  }));
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const line of lines) {
    const metrics = context.measureText(line.value);
    left = Math.min(left, line.x - Math.max(metrics.actualBoundingBoxLeft, metrics.width / 2));
    right = Math.max(right, line.x + Math.max(metrics.actualBoundingBoxRight, metrics.width / 2));
    top = Math.min(top, line.y - Math.max(metrics.actualBoundingBoxAscent, fontSize));
    bottom = Math.max(bottom, line.y + Math.max(metrics.actualBoundingBoxDescent, fontSize * 0.3));
  }
  left -= 3; top -= 3; right += 3; bottom += 3;
  const width = right - left, height = bottom - top;
  // Resolution follows the original label size, never the size of the complete page.
  const scale = Math.min(8, 8192 / Math.max(width, height), Math.sqrt(8_000_000 / (width * height)));
  if (!Number.isFinite(scale) || scale < 1) {
    throw new Error('A label is too large for PDF export. Shorten it, or export SVG.');
  }
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  try {
    context.scale(scale, scale);
    context.font = font;
    context.textAlign = 'center';
    context.fillStyle = text.getAttribute('fill') ?? '#172033';
    for (const line of lines) context.fillText(line.value, line.x - left, line.y - top);
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('x', String(left));
    image.setAttribute('y', String(top));
    image.setAttribute('width', String(width));
    image.setAttribute('height', String(height));
    image.setAttribute('href', canvas.toDataURL('image/png'));
    return image;
  } finally {
    canvas.width = 0; canvas.height = 0;
  }
}

/** Convert the generated scene to PDF paths and embedded text, with local Unicode label fallback. */
export async function svgToPdf(markup: string): Promise<Uint8Array<ArrayBuffer>> {
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  if (svg.localName !== 'svg' || svg.querySelector('parsererror')) throw new Error('The PDF scene is invalid. Try exporting SVG.');
  const viewBox = svg.getAttribute('viewBox')?.split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4) throw new Error('The PDF scene has no valid dimensions.');
  const layout = pdfLayout(viewBox[2], viewBox[3]);
  const [{ jsPDF }, { svg2pdf }, font] = await Promise.all([
    import('jspdf'), import('svg2pdf.js'), exportFont(),
  ]);
  await document.fonts.ready;
  const pdf = new jsPDF({
    orientation: layout.pageWidth > layout.pageHeight ? 'landscape' : 'portrait',
    unit: 'pt', format: [layout.pageWidth, layout.pageHeight],
    compress: true, putOnlyUsedFonts: true, floatPrecision: 6,
  });
  pdf.addFileToVFS('NotoSans-Medium.ttf', font.base64);
  pdf.addFont('NotoSans-Medium.ttf', FONT_NAME, 'normal');
  svg.setAttribute('font-family', FONT_NAME);
  for (const text of svg.querySelectorAll('text')) {
    const normalized = (text.textContent ?? '').normalize('NFC');
    const supported = !/[\p{Mark}\p{Cf}]/u.test(normalized) && [...normalized].every(character => {
      const point = character.codePointAt(0)!;
      return font.coverage.some(([start, end]) => point >= start && point <= end);
    });
    if (supported) {
      text.setAttribute('font-family', FONT_NAME);
      text.setAttribute('font-weight', 'normal');
      for (const span of text.querySelectorAll('tspan')) span.textContent = (span.textContent ?? '').normalize('NFC');
    } else text.replaceWith(labelImage(text));
  }
  await svg2pdf(svg, pdf, { x: layout.imageX, y: layout.imageY,
    width: layout.imageWidth, height: layout.imageHeight,
    loadExternalStyleSheets: false, loadImages: /^data:image\/png;base64,/ });
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  // Transparent label images use PDF 1.4 soft masks. jsPDF defaults to a 1.3 header;
  // replacing it with an equally sized header preserves all cross-reference offsets.
  bytes.set(new TextEncoder().encode('%PDF-1.4'));
  return bytes;
}
