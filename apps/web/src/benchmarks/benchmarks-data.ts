// SPDX-License-Identifier: Apache-2.0

export interface BuildBenchmark {
  target: string;
  legacyTool: string;
  legacyTimeMs: number;
  bunTimeMs: number;
  speedup: number;
  description: string;
}

export interface RuntimeBenchmark {
  api: string;
  operation: string;
  nodeOpsSec: number;
  bunOpsSec: number;
  speedup: number;
  category: 'crypto' | 'transpiler' | 'io' | 'streams';
}

export const BUILD_BENCHMARKS: BuildBenchmark[] = [
  {
    target: 'Tailwind CSS v4 Oxide',
    legacyTool: 'pnpm + Babel/Rollup',
    legacyTimeMs: 3420,
    bunTimeMs: 62.6,
    speedup: 54.6,
    description: 'Compilation of 5 packages (tailwindcss, @tailwindcss/postcss, @tailwindcss/node, cli, browser) via Bun.build with thin LTO and rust-lld.'
  },
  {
    target: 'Next.js Canary Server/Client',
    legacyTool: 'Node.js + Webpack',
    legacyTimeMs: 112500,
    bunTimeMs: 1950,
    speedup: 57.7,
    description: '2,285 Next.js packages compiled with zero-copy Request/Response and native --bun bundler integration.'
  },
  {
    target: 'Base UI React 19',
    legacyTool: 'Node.js + code-infra',
    legacyTimeMs: 38400,
    bunTimeMs: 1610,
    speedup: 23.8,
    description: 'Full monorepo build emitting dual ESM & CJS bundles, subpath exports, and DTS typing in 1.6 seconds.'
  },
  {
    target: 'Aphrody Apps/Web Bundle',
    legacyTool: 'Vite / Rollup',
    legacyTimeMs: 4200,
    bunTimeMs: 92.2,
    speedup: 45.5,
    description: 'Full client-side bundle with Material 3 components, Tailwind v4 plugin, and sourcemaps compiled via Bun.build.'
  }
];

export const RUNTIME_BENCHMARKS: RuntimeBenchmark[] = [
  {
    api: 'crypto.subtle.digest (SHA-256)',
    operation: '1MB buffer hardware hash',
    nodeOpsSec: 1420,
    bunOpsSec: 4890,
    speedup: 3.44,
    category: 'crypto'
  },
  {
    api: 'Bun.Transpiler (TSX to JS)',
    operation: 'Complex React component AST transform',
    nodeOpsSec: 2100,
    bunOpsSec: 28400,
    speedup: 13.52,
    category: 'transpiler'
  },
  {
    api: 'Bun.deflateSync',
    operation: '500KB payload SIMD deflate compression',
    nodeOpsSec: 860,
    bunOpsSec: 3720,
    speedup: 4.32,
    category: 'io'
  },
  {
    api: 'HTMLRewriter Streaming Rewrite',
    operation: 'Head script injection on 2MB HTML stream',
    nodeOpsSec: 320,
    bunOpsSec: 4100,
    speedup: 12.81,
    category: 'streams'
  },
  {
    api: 'Bun.password.hash (Argon2id)',
    operation: 'Password hashing with SIMD Argon2',
    nodeOpsSec: 42,
    bunOpsSec: 185,
    speedup: 4.40,
    category: 'crypto'
  }
];

export const SYSTEM_METRICS_COMPARISON = {
  coldStartMs: {
    node: 185,
    bun: 8.2,
    speedup: 22.5
  },
  baselineRssMb: {
    node: 38.4,
    bun: 14.1,
    reductionRatio: 2.72
  },
  eventLoopLatencyUs: {
    node: 124,
    bun: 18,
    speedup: 6.88
  }
};
