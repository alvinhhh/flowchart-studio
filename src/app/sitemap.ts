import type { MetadataRoute } from "next";
import { PRODUCT } from "@/lib/config";

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/privacy', '/guides/how-to-draw-a-flowchart', '/guides/flowchart-symbols'].map(path => ({ url: `${PRODUCT.siteUrl}${path}` }));
}
