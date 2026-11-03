import Link from "next/link";
import { PRODUCT } from "@/lib/config";

export function PublicGuide({ title, description, path, relatedPath, relatedTitle, children }: {
  title: string;
  description: string;
  path: string;
  relatedPath: string;
  relatedTitle: string;
  children: React.ReactNode;
}) {
  const url = `${PRODUCT.siteUrl}${path}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [{
      "@type": "Person",
      "@id": `${PRODUCT.siteUrl}/#creator`,
      name: "Alvin Huang",
      url: "https://alvinhua.ng",
    }, {
      "@type": "WebSite",
      "@id": `${PRODUCT.siteUrl}/#website`,
      name: PRODUCT.name,
      url: `${PRODUCT.siteUrl}/`,
    }, {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: title,
      description,
      url,
      mainEntityOfPage: url,
      inLanguage: "en",
      author: { "@id": `${PRODUCT.siteUrl}/#creator` },
      isPartOf: { "@id": `${PRODUCT.siteUrl}/#website` },
    }, {
      "@type": "BreadcrumbList",
      itemListElement: [{ "@type": "ListItem", position: 1, name: PRODUCT.name, item: `${PRODUCT.siteUrl}/` }, { "@type": "ListItem", position: 2, name: title, item: url }],
    }],
  };

  return (
    <div className="public-shell">
      <a className="public-skip" href="#main-content">Skip to content</a>
      <header className="public-header">
        <Link className="public-brand" href="/" aria-label={`${PRODUCT.name} home`}><span className="brand-mark" aria-hidden="true">◇</span>{PRODUCT.name}</Link>
        <nav aria-label="Main navigation"><Link href="/privacy">Privacy</Link><Link href="/app" prefetch={false}>Open editor <span aria-hidden="true">↗</span></Link></nav>
      </header>
      <main id="main-content" className="guide-content">
        <nav className="guide-breadcrumb" aria-label="Breadcrumb"><Link href="/">{PRODUCT.name}</Link><span aria-hidden="true">/</span><span aria-current="page">{title}</span></nav>
        <article>
          <header className="guide-heading"><h1>{title}</h1><p className="guide-intro">{description}</p><p className="guide-byline">By <a href="https://alvinhua.ng" rel="author">Alvin Huang</a></p></header>
          {children}
        </article>
        <aside className="guide-related" aria-label="Related guide"><h2>Related guide</h2><Link href={relatedPath}>{relatedTitle} →</Link></aside>
        <div className="guide-editor"><Link className="public-primary" href="/app" prefetch={false}>Open editor <span aria-hidden="true">→</span></Link><p>Free. No account, ads, or analytics. Export JSON to keep an editable backup.</p></div>
      </main>
      <footer className="public-footer"><Link href="/">{PRODUCT.name}</Link><span>Built with &lt;3 by <a href="https://alvinhua.ng">Alvin Huang</a></span><a href="https://github.com/alvinhhh/flowchart-studio">GitHub</a><Link href="/privacy">Privacy &amp; local storage</Link></footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    </div>
  );
}
