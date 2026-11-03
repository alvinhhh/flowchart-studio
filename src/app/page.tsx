import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT } from "@/lib/config";

const description = "Free programming flowchart maker with 32 shapes, branches, and loops. No account, ads, or analytics. Save locally and export JSON, PNG, SVG, or PDF.";

export const metadata: Metadata = {
  title: { absolute: `Free programming flowchart maker | ${PRODUCT.name}` },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: "Free programming flowchart maker",
    description,
    url: "/",
    type: "website",
    siteName: PRODUCT.name,
  },
  twitter: { card: "summary_large_image", title: "Free programming flowchart maker", description },
};

const features = [
  ["32 shapes", "Flowchart symbols, data storage, documents, connectors, and notes."],
  ["Branches and loops", "Connect steps, label decisions, and route a loop back to an earlier step."],
  ["Editing tools", "Resize, group, lock, align, and copy shapes. Undo or redo completed edits."],
  ["Local saves", "Keep projects in this browser with IndexedDB. No account required."],
  ["JSON files", "Download an editable backup and import it again later."],
  ["PNG, SVG, and PDF", "Export an image, a scalable vector file, or a printable page."],
];

function ExampleDiagram() {
  return (
    <svg className="example-diagram" viewBox="0 0 460 410" role="img" aria-labelledby="diagram-title diagram-description">
      <title id="diagram-title">Programming flowchart example</title>
      <desc id="diagram-description">Start, set a counter to zero, check whether the counter is less than three, run a process and increment the counter on the yes branch, loop to the check, and end on the no branch.</desc>
      <defs>
        <marker id="example-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 7 3.5 0 7" fill="currentColor" /></marker>
        <pattern id="example-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#ddd" /></pattern>
      </defs>
      <rect width="460" height="410" fill="url(#example-dots)" />
      <g fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#example-arrow)">
        <path d="M220 74V108" /><path d="M220 154V185" /><path d="M220 259V302" />
        <path d="M266 222H375V348" /><path d="M132 325H73V173H220V185" />
      </g>
      <g fill="white" stroke="currentColor" strokeWidth="1.5">
        <rect x="165" y="36" width="110" height="38" rx="19" />
        <rect x="151" y="108" width="138" height="46" rx="3" />
        <path d="m220 185 46 37-46 37-46-37Z" />
        <rect x="132" y="302" width="174" height="46" rx="3" />
        <rect x="320" y="348" width="110" height="38" rx="19" />
      </g>
      <g fill="currentColor" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="13">
        <text x="220" y="60">Start</text><text x="220" y="136">i = 0</text><text x="220" y="227">i &lt; 3?</text>
        <text x="220" y="330">Process; i = i + 1</text><text x="375" y="372">End</text>
        <text x="238" y="283" fontSize="11">Yes</text><text x="300" y="212" fontSize="11">No</text>
      </g>
    </svg>
  );
}

export default function Home() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [{
      "@type": "WebSite",
      "@id": `${PRODUCT.siteUrl}/#website`,
      name: PRODUCT.name,
      url: `${PRODUCT.siteUrl}/`,
      inLanguage: "en",
      publisher: { "@id": `${PRODUCT.siteUrl}/#creator` },
    }, {
      "@type": "Person",
      "@id": `${PRODUCT.siteUrl}/#creator`,
      name: "Alvin Huang",
      url: "https://alvinhua.ng",
    }, {
    "@type": "WebApplication",
    "@id": `${PRODUCT.siteUrl}/#application`,
    name: PRODUCT.name,
    url: `${PRODUCT.siteUrl}/app`,
    mainEntityOfPage: `${PRODUCT.siteUrl}/`,
    isPartOf: { "@id": `${PRODUCT.siteUrl}/#website` },
    creator: { "@id": `${PRODUCT.siteUrl}/#creator` },
    sameAs: "https://github.com/alvinhhh/flowchart-studio",
    description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and a modern browser with IndexedDB.",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: ["No account required", "No ads or analytics", "Local editing with optional encrypted 24-hour sharing", ...features.map(([title, detail]) => `${title}: ${detail}`)],
    }],
  };

  return (
    <div className="public-shell">
      <a className="public-skip" href="#main-content">Skip to content</a>
      <header className="public-header">
        <Link className="public-brand" href="/" aria-label={`${PRODUCT.name} home`}><span className="brand-mark" aria-hidden="true">◇</span>{PRODUCT.name}</Link>
        <nav aria-label="Main navigation"><Link href="/guides/how-to-draw-a-flowchart">Guides</Link><Link href="/privacy">Privacy</Link><Link href="/app" prefetch={false}>Open editor <span aria-hidden="true">↗</span></Link></nav>
      </header>
      <main id="main-content">
        <section className="public-hero" aria-labelledby="home-title">
          <div className="hero-copy">
            <h1 id="home-title">Free programming<br className="desktop-break" /> flowchart maker</h1>
            <p className="public-lead">Draw algorithms, decisions, and loops with 32 shapes. Free, with no account, ads, or analytics. Save locally in your browser, or share an encrypted snapshot with a link that expires in 24 hours.</p>
            <div className="hero-actions"><Link className="public-primary" href="/app" prefetch={false}>Open editor <span aria-hidden="true">→</span></Link><Link className="public-example-link" href="/app?example=1" prefetch={false}>Open example</Link></div>
            <p className="hero-detail">JSON backups. PNG, SVG, and PDF export.</p>
          </div>
          <figure className="public-example"><figcaption><span>Example</span><span>Branch &amp; loop</span></figcaption><ExampleDiagram /></figure>
        </section>
        <section className="public-features" aria-labelledby="features-title">
          <div className="section-heading"><h2 id="features-title">Drawing tools</h2><p>For algorithms, pseudocode, and program logic.</p></div>
          <div className="feature-grid">{features.map(([title, detail], index) => <div className="feature-item" key={title}><span className="feature-number" aria-hidden="true">0{index + 1}</span><div><h3>{title}</h3><p>{detail}</p></div></div>)}</div>
        </section>
        <div className="public-guide-grid">
          <section aria-labelledby="how-title"><h2 id="how-title">How to draw a flowchart</h2><ol className="public-steps"><li><strong>Add the steps.</strong> Use a process for an action and a decision for a condition.</li><li><strong>Connect the logic.</strong> Add arrows, label branches, and connect a later step back to an earlier one for a loop.</li><li><strong>Save a copy.</strong> Export JSON to keep editing later, or PNG, SVG, or PDF to share the diagram.</li></ol><div className="guide-links"><Link href="/guides/how-to-draw-a-flowchart">Drawing steps, branches, and loops →</Link><Link href="/guides/flowchart-symbols">Flowchart symbols and examples →</Link></div></section>
          <section className="public-faq" aria-labelledby="faq-title"><h2 id="faq-title">Common questions</h2><details><summary>Is the editor free?</summary><p>Yes. The editor, browser saves, and JSON, PNG, SVG, and PDF exports are free. No account or payment is required. There are no ads or analytics.</p></details><details><summary>Where are my flowcharts saved?</summary><p>Projects are stored in IndexedDB in this browser on this device. Editing and saving do not upload diagram content. Creating a share link uploads an encrypted snapshot that expires after 24 hours. Clearing site data or using a private browsing session can remove your work. Export JSON backups for work you want to keep.</p></details><details><summary>Can I share a diagram?</summary><p>Yes. Choose Share to create an encrypted snapshot with a link that expires after 24 hours. Anyone with the link can view it or save a separate copy. Later edits do not update the snapshot.</p></details><details><summary>Can I use it for branches and loops?</summary><p>Yes. Connect decision branches and label their arrows. Create a loop by connecting a later step to an earlier step. A connection directly from a node to itself is not supported.</p></details><details><summary>Does it turn a flowchart into code?</summary><p>No. This version is a diagram editor. It does not execute algorithms or generate source code.</p></details></section>
        </div>
      </main>
      <footer className="public-footer"><span>{PRODUCT.name}</span><span>Built with &lt;3 by <a href="https://alvinhua.ng">Alvin Huang</a></span><a href="https://github.com/alvinhhh/flowchart-studio">GitHub</a><Link href="/guides/flowchart-symbols">Flowchart symbols</Link><Link href="/privacy">Privacy &amp; local storage</Link></footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    </div>
  );
}
