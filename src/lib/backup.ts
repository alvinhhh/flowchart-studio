import { strToU8, zipSync } from 'fflate';
import type { Diagram } from './diagram';

function backupBasename(title: string): string {
  const safe = title.normalize('NFC').trim()
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/^\.+|[. ]+$/g, '');
  let shortened = '';
  for (const character of Array.from(safe).slice(0, 80)) {
    if (strToU8(shortened + character).length > 180) break;
    shortened += character;
  }
  const base = shortened.replace(/[. ]+$/g, '') || 'diagram';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `diagram-${base}` : base;
}

/** Every entry is the same portable JSON used by the single-document export. */
export function createBackupArchive(documents: Diagram[]): Uint8Array {
  if (!documents.length) throw new Error('No saved diagrams were found.');
  const entries: Record<string, Uint8Array> = Object.create(null);
  const used = new Set<string>();
  for (const document of documents) {
    const base = backupBasename(document.title);
    let filename = `${base}.json`, suffix = 2;
    while (used.has(filename.toLowerCase())) filename = `${base} (${suffix++}).json`;
    used.add(filename.toLowerCase());
    entries[filename] = strToU8(`${JSON.stringify(document, null, 2)}\n`);
  }
  return zipSync(entries, { level: 0 });
}

export async function prepareAllBackups(flush: () => Promise<boolean>, list: () => Promise<Diagram[]>) {
  if (!(await flush())) throw new Error('The current diagram could not be saved. Download its JSON backup or save a separate copy, then retry all backups.');
  const documents = await list();
  return { bytes: createBackupArchive(documents), count: documents.length };
}

export function downloadBackupArchive(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `flowchart-backups-${new Date().toISOString().slice(0, 10)}.zip`;
  link.hidden = true;
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
