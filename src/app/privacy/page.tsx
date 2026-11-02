import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT } from "@/lib/config";

const description = `How ${PRODUCT.name} stores projects in your browser, handles file imports and exports, and uses normal website requests.`;
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
      <p className="public-eyebrow">PRIVACY</p><h1>Privacy and local storage</h1><p className="privacy-intro">{PRODUCT.name} is a local browser editor. There are no accounts, cloud project storage, analytics, or external API integrations in this version.</p>
      <section><h2>Project data stays in this browser</h2><p>The editor stores project names, shapes, connections, freehand drawings, and canvas settings in IndexedDB on this device. Project data is not uploaded to an application server. Other devices and other browser profiles do not receive a copy.</p><p>This is browser storage, not a backup service. Clearing site data, removing a browser profile, private browsing limits, storage eviction, or a device failure can remove projects. If local saving fails, the editor reports the failure. Export JSON copies for projects you want to keep.</p></section>
      <section><h2>Files you import and export</h2><p>Imported JSON is read and checked in the browser. JSON, PNG, SVG, and PDF exports are generated in the browser and downloaded to the location you choose. These operations do not send the file contents to an external service. Copy and paste can use the system clipboard when the browser allows access. A file or clipboard selection you later share is subject to the recipient or service you choose.</p></section>
      <section><h2>Website requests</h2><p>Your browser still requests the application and its assets from the website host. The host may keep ordinary request logs, such as IP addresses, requested URLs, browser information, and request times. Log handling and retention depend on the hosting provider. Do not put private information in a page URL.</p><p>The application does not include analytics, advertising trackers, external fonts, or external API calls. It does not use cookies for sign-in or tracking.</p></section>
      <section><h2>Deleting local data</h2><p>Delete individual projects in the editor, or clear this site’s data in your browser settings to remove its saved projects. Deleting local projects does not delete JSON, PNG, SVG, or PDF files you have downloaded or shared.</p></section>
      <section><h2>Connection and shared devices</h2><p>An already loaded editor can continue working without a connection, but this version does not install an offline application cache. Reopening or reloading it offline is not guaranteed.</p><p>Anyone with access to the same browser profile may be able to open its projects. Use a separate browser profile or device when you need to keep work separate.</p></section>
    </main>
    <footer className="public-footer"><Link href="/">{PRODUCT.name}</Link><Link href="/app" prefetch={false}>Open editor</Link></footer>
  </div>;
}
