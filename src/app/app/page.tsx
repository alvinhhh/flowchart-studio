import type { Metadata } from "next";
import { Suspense } from "react";
import Editor from "@/components/editor";
import { PRODUCT, SOCIAL_IMAGE } from "@/lib/config";

const description = "Draw and edit programming flowcharts. Projects save locally in your browser, with JSON, PNG, SVG, and PDF export.";
export const metadata: Metadata = {
  title: "Flowchart editor",
  description,
  alternates: { canonical: "/app" },
  robots: { index: false, follow: true },
  openGraph: { title: "Flowchart editor", description, url: "/app", type: "website", siteName: PRODUCT.name, images: [SOCIAL_IMAGE] },
  twitter: { card: "summary_large_image", title: "Flowchart editor", description, images: [SOCIAL_IMAGE] },
};

export default function EditorPage() {
  return <Suspense fallback={<main className="editor-loading" aria-busy="true">Loading editor…</main>}><Editor /></Suspense>;
}
