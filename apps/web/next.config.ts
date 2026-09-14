import type { NextConfig } from 'next';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // standalone só no Docker (symlinks falham no Windows sem privilégio)
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  transpilePackages: ['@afilados/shared', '@afilados/core'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};
export default nextConfig;
