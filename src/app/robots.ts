import type { MetadataRoute } from "next";
import { PRODUCT } from "@/lib/config";

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${PRODUCT.siteUrl}/sitemap.xml`,
  };
}
