import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ['@koharu/bridge', '@aphrody/koharu-ui'],
  output: 'export',
  images: {
    unoptimized: true,
  },
}

export default nextConfig
