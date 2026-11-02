import type { Metadata } from "next";
import Link from "next/link";
import { PRODUCT } from "@/lib/config";

const description = "Make programming flowcharts with six shapes, labeled branches, and loops. Save locally in your browser and export JSON or PNG. No signup required.";

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
  ["Six shapes", "Start/end, process, decision, input/output, function, and note."],
  ["Branches and loops", "Connect steps, label decisions, and route a loop back to an earlier step."],
  ["Undo and redo", "Revise the chart without losing the previous step."],
  ["Local saves", "Keep projects in this browser with IndexedDB. No account required."],
  ["JSON files", "Download an editable backup and import it again later."],
  ["PNG export", "Download an image for a document, lesson, or code review."],
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
  const application = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: PRODUCT.name,
    url: `${PRODUCT.siteUrl}/app`,
    description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and a modern browser with IndexedDB.",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: features.map(([title, detail]) => `${title}: ${detail}`),
  };

  return (
    <div className="public-shell">
      <a className="public-skip" href="#main-content">Skip to content</a>
      <header className="public-header">
        <Link className="public-brand" href="/" aria-label={`${PRODUCT.name} home`}><span className="brand-mark" aria-hidden="true">◇</span>{PRODUCT.name}</Link>
        <nav aria-label="Main navigation"><Link href="/privacy">Privacy</Link><Link href="/app" prefetch={false}>Open editor <span aria-hidden="true">↗</span></Link></nav>
      </header>
      <main id="main-content">
        <section className="public-hero" aria-labelledby="home-title">
          <div className="hero-copy">
            <p className="public-eyebrow">PROGRAMMING FLOWCHARTS</p>
            <h1 id="home-title">Free programming<br className="desktop-break" /> flowchart maker</h1>
            <p className="public-lead">Draw an algorithm, map a decision, or work through a loop. Save in your browser and export an editable file or image.</p>
            <div className="hero-actions"><Link className="public-primary" href="/app" prefetch={false}>Start drawing free <span aria-hidden="true">→</span></Link><Link className="public-example-link" href="/app?example=1" prefetch={false}>Open example</Link></div>
            <p className="hero-detail">No signup. No cloud storage. JSON and PNG export.</p>
          </div>
          <figure className="public-example"><figcaption><span>Example</span><span>Branch &amp; loop</span></figcaption><ExampleDiagram /></figure>
        </section>
        <section className="public-features" aria-labelledby="features-title">
          <div className="section-heading"><h2 id="features-title">Drawing tools</h2><p>For algorithms, pseudocode, and program logic.</p></div>
          <div className="feature-grid">{features.map(([title, detail], index) => <div className="feature-item" key={title}><span className="feature-number" aria-hidden="true">0{index + 1}</span><div><h3>{title}</h3><p>{detail}</p></div></div>)}</div>
        </section>
        <div className="public-guide-grid">
          <section aria-labelledby="how-title"><h2 id="how-title">How to draw a flowchart</h2><ol className="public-steps"><li><strong>Add the steps.</strong> Use a process for an action and a decision for a condition.</li><li><strong>Connect the logic.</strong> Add arrows, label branches, and connect a later step back to an earlier one for a loop.</li><li><strong>Save a copy.</strong> Export JSON to keep editing later, or PNG to share the diagram.</li></ol></section>
          <section className="public-faq" aria-labelledby="faq-title"><h2 id="faq-title">Common questions</h2><details><summary>Is the editor free?</summary><p>Yes. The local editor, browser saves, and JSON and PNG exports are free. No account or payment is required.</p></details><details><summary>Where are my flowcharts saved?</summary><p>Projects are stored in IndexedDB in this browser on this device. Clearing site data or using a private browsing session can remove them. Export JSON backups for work you want to keep.</p></details><details><summary>Can I use it for branches and loops?</summary><p>Yes. Connect decision branches and label their arrows. Create a loop by connecting a later step to an earlier step. A connection directly from a node to itself is not supported.</p></details><details><summary>Does it turn a flowchart into code?</summary><p>No. This version is a diagram editor. It does not execute algorithms or generate source code.</p></details></section>
        </div>
      </main>
      <footer className="public-footer"><span>{PRODUCT.name}</span><Link href="/privacy">Privacy &amp; local storage</Link></footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(application).replace(/</g, "\\u003c") }} />
    </div>
  );
}
