function siteOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute HTTP or HTTPS origin.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL must contain only an HTTP or HTTPS origin, with no credentials, path, query, or fragment.");
  }
  return url.origin;
}

export const PRODUCT = {
  name: "Flowchart Studio",
  siteUrl: siteOrigin(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  cloudPricing: {
    monthlyCents: 300,
    annualCents: 3000,
    currency: "USD",
    available: false,
  },
} as const;

export const SOCIAL_IMAGE = {
  url: "/opengraph-image?v=20261103",
  width: 1200,
  height: 630,
  alt: "Flowchart Studio — free flowchart editor with a branching example diagram",
} as const;
