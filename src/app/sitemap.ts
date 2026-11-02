import type { MetadataRoute } from "next";
import { PRODUCT } from "@/lib/config";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${PRODUCT.siteUrl}/` }, { url: `${PRODUCT.siteUrl}/privacy` }];
}
