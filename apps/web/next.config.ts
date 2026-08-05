import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@wildfire/db'],
  // Next.js' output file tracing volgt Prisma's dynamische engine-lookup niet
  // vanzelf (monorepo + pnpm store-hash), dus de rhel-openssl-3.0.x-engine
  // ontbreekt anders in de serverless bundle op Vercel.
  outputFileTracingIncludes: {
    '/**/*': ['../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/*.node'],
  },
}

export default nextConfig
