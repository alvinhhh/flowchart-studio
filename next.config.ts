import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(process.env.FLOWCHART_STATIC_EXPORT === '1' ? { output: 'export' as const } : {}),
};
export default nextConfig;
