<!-- SPDX-License-Identifier: Apache-2.0 -->

# Next.js + Vercel Rust crates

## Déplacé vers aphrody-labs/bun

Cette cartographie (crates `next-*`, `turbo-tasks*`, `turbopack*`) est reprise et mise à jour pour Next.js
16.5.0-canary.4 dans le fork Bun : [packages/bun-next/docs/PLAN.md](https://github.com/aphrody-labs/bun/blob/main/packages/bun-next/docs/PLAN.md), section « Next.js and Turbopack crates ».
Conclusion conservée : ne pas lier Turbopack dans un workspace Cargo ; la pièce utile est
`next-custom-transforms`, candidate à un plugin natif `onBeforeParse` de Bun.
