import type { Metadata } from "next";
import { PRODUCT } from "@/lib/config";
import "./globals.css";
import "./public.css";

export const metadata: Metadata = {
  metadataBase: new URL(PRODUCT.siteUrl),
  title: {
    default: `Free programming flowchart maker | ${PRODUCT.name}`,
    template: `%s | ${PRODUCT.name}`,
  },
  description: "Draw programming flowcharts with branches and loops. Save in your browser and export JSON or PNG. Free, with no account required.",
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
      <body style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>{children}</body>
    </html>
  );
}
