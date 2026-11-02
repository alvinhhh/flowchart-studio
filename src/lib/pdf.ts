const A4_SHORT = 595.28;
const A4_LONG = 841.89;
const MARGIN = 24;
const DPI = 300;

export interface PdfLayout {
  pageWidth: number;
  pageHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  pixelWidth: number;
  pixelHeight: number;
}

/** Fit the complete scene on one A4 page, with 24 point margins and a 300 dpi image. */
export function pdfLayout(width: number, height: number): PdfLayout {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('The diagram has invalid export dimensions. Correct the diagram, then try again.');
  }
  const landscape = width > height;
  const pageWidth = landscape ? A4_LONG : A4_SHORT;
  const pageHeight = landscape ? A4_SHORT : A4_LONG;
  const scale = Math.min((pageWidth - MARGIN * 2) / width, (pageHeight - MARGIN * 2) / height);
  const imageWidth = width * scale;
  const imageHeight = height * scale;
  return {
    pageWidth, pageHeight, imageWidth, imageHeight,
    imageX: (pageWidth - imageWidth) / 2,
    imageY: (pageHeight - imageHeight) / 2,
    pixelWidth: Math.max(1, Math.round(imageWidth * DPI / 72)),
    pixelHeight: Math.max(1, Math.round(imageHeight * DPI / 72)),
  };
}

/** A single RGB JPEG image in a one-page PDF. Text is rasterized by the browser for Unicode fidelity. */
export function jpegToPdf(jpeg: Uint8Array, layout: PdfLayout): Uint8Array<ArrayBuffer> {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
    throw new Error('The browser could not create a JPEG for the PDF. Try exporting SVG.');
  }
  if (Object.values(layout).some(value => !Number.isFinite(value) || value < 0)
    || layout.pageWidth <= 0 || layout.pageHeight <= 0 || layout.imageWidth <= 0 || layout.imageHeight <= 0
    || !Number.isInteger(layout.pixelWidth) || !Number.isInteger(layout.pixelHeight) || layout.pixelWidth < 1 || layout.pixelHeight < 1) {
    throw new Error('The PDF has invalid page dimensions. Try exporting SVG.');
  }
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets = [0];
  let length = 0;
  const append = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.byteLength;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    append(`${id} 0 obj\n${body}`);
    if (stream) { append('\nstream\n'); append(stream); append('\nendstream'); }
    append('\nendobj\n');
  };
  const number = (value: number) => Number(value.toFixed(6)).toString();
  append('%PDF-1.4\n');
  append(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(layout.pageWidth)} ${number(layout.pageHeight)}] /Resources << /XObject << /Scene 4 0 R >> >> /Contents 5 0 R >>`);
  object(4, `<< /Type /XObject /Subtype /Image /Width ${layout.pixelWidth} /Height ${layout.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>`, jpeg);
  const content = encoder.encode(`q\n${number(layout.imageWidth)} 0 0 ${number(layout.imageHeight)} ${number(layout.imageX)} ${number(layout.imageY)} cm\n/Scene Do\nQ\n`);
  object(5, `<< /Length ${content.byteLength} >>`, content);
  const xref = length;
  append(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${offset.toString().padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const result = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { result.set(chunk, position); position += chunk.byteLength; }
  return result;
}
