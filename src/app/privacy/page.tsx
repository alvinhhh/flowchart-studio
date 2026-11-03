import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT } from "@/lib/config";

const description = `How ${PRODUCT.name} stores projects in your browser, handles optional 24-hour sharing, file imports and exports, and normal website requests.`;
export const metadata: Metadata = {
  title: "Privacy and local storage",
  description,
  alternates: { canonical: "/privacy" },
  openGraph: { title: "Privacy and local storage", description, url: "/privacy", type: "website", siteName: PRODUCT.name },
  twitter: { card: "summary_large_image", title: "Privacy and local storage", description },
};

export default function Privacy() {
  return <div className="public-shell">
    <a className="public-skip" href="#main-content">Skip to content</a>
    <header className="public-header"><Link className="public-brand" href="/"><span className="brand-mark" aria-hidden="true">◇</span>{PRODUCT.name}</Link><nav aria-label="Main navigation"><Link href="/">Home</Link><Link href="/app" prefetch={false}>Open editor <span aria-hidden="true">↗</span></Link></nav></header>
    <main id="main-content" className="privacy-content">
      <p className="public-eyebrow">PRIVACY</p><h1>Privacy and local storage</h1><p className="privacy-intro">{PRODUCT.name} is a local browser editor. There are no accounts, ads, or analytics. Editing and saving stay local. Optional sharing uploads an encrypted snapshot for 24 hours.</p>
      <section><h2>Project data stays in this browser</h2><p>The editor stores project names, shapes, connections, freehand drawings, and canvas settings in IndexedDB on this device. Editing, saving, importing, and exporting do not upload project data. Other devices and browser profiles only receive a copy if you share a link or file.</p><p>This is browser storage, not a backup service. Clearing site data, removing a browser profile, private browsing limits, storage eviction, or a device failure can remove projects. If local saving fails, the editor reports the failure. Export JSON copies for projects you want to keep.</p></section>
      <section><h2>Optional 24-hour sharing</h2><p>Choosing Share and then Create link uploads a snapshot containing the diagram title, shapes, labels, notes, connections, drawings, and canvas settings. The browser encrypts it with AES-GCM before upload. Cloudflare stores the encrypted snapshot; its decryption key is in the part of the share link after # and is not sent to the sharing API.</p><p>Anyone with the complete link can view the snapshot or save a separate copy. Treat the link as access to the diagram. Later edits to the original do not update it. Shared pages are marked not to be indexed by search engines.</p><p>Links expire 24 hours after creation. The sharing API checks the expiry on every read, and the stored snapshot is configured to expire automatically. We do not use snapshots for analytics or advertising. Expiry does not remove copies that recipients have already saved, screenshots, downloaded files, or links from browser history. Cloudflare’s handling of infrastructure logs and backups is governed by its policies.</p><p>Opening a shared diagram does not automatically save it in browser storage. Save a copy creates a separate local document. Diagrams larger than 512 KiB cannot be shared by link; export a file instead.</p></section>
      <section><h2>Files you import and export</h2><p>Imported JSON is read and checked in the browser. JSON, PNG, SVG, and PDF exports are generated in the browser and downloaded to the location you choose. These operations do not send the file contents to an external service. Copy and paste can use the system clipboard when the browser allows access. A file or clipboard selection you later share is subject to the recipient or service you choose.</p></section>
      <section><h2>Website requests</h2><p>Your browser still requests the application and its assets from the website host. The host may keep ordinary request logs, such as IP addresses, requested URLs, browser information, and request times. Log handling and retention depend on the hosting provider. Do not put private information in a page URL.</p><p>The application does not include analytics, advertising trackers, or external fonts. The sharing API receives encrypted snapshots and ordinary request information only when a link is created or opened. The complete share link, including its decryption key, is not sent in HTTP requests. It does not use cookies for sign-in or tracking.</p></section>
      <section><h2>Deleting local data</h2><p>Delete individual projects in the editor, or clear this site’s data in your browser settings to remove its saved projects. Deleting local projects does not delete downloaded files, recipients’ copies, or shared snapshots. Existing share links remain available until their 24-hour expiry.</p></section>
      <section><h2>Connection and shared devices</h2><p>An already loaded editor can continue working without a connection, but this version does not install an offline application cache. Reopening or reloading it offline is not guaranteed.</p><p>Anyone with access to the same browser profile may be able to open its projects. Use a separate browser profile or device when you need to keep work separate.</p></section>
    </main>
    <footer className="public-footer"><Link href="/">{PRODUCT.name}</Link><Link href="/app" prefetch={false}>Open editor</Link></footer>
  </div>;
}
