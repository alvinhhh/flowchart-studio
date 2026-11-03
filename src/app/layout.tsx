import type { Metadata } from "next";
import { PRODUCT } from "@/lib/config";
import { NODE_TYPES } from "@/lib/shapes";
import VisitCounter from "@/components/visit-counter";
import "./globals.css";
import "./public.css";

export const metadata: Metadata = {
  metadataBase: new URL(PRODUCT.siteUrl),
  title: {
    default: `Free programming flowchart maker | ${PRODUCT.name}`,
    template: `%s | ${PRODUCT.name}`,
  },
  description: `Free programming flowchart maker with ${NODE_TYPES.length} shapes, branches, and loops. No account or ads. Save locally and export JSON, PNG, SVG, or PDF.`,
  applicationName: PRODUCT.name,
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: PRODUCT.name,
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "Arial, Helvetica, sans-serif" }}><VisitCounter />{children}</body>
    </html>
  );
}
