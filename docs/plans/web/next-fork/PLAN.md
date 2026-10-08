<!-- SPDX-License-Identifier: Apache-2.0 -->

# Fork Next.js — plan propriétaire

## Déplacé vers aphrody-labs/bun

Depuis le 2026-10-08, le plan Next.js sur Bun vit dans le fork Bun : [packages/bun-next/docs/PLAN.md](https://github.com/aphrody-labs/bun/blob/main/packages/bun-next/docs/PLAN.md)
(paquet `@aphrody/next-bun`, cibles Next 16.1.6 et `vendor/next.js` 16.5.0-canary.4). Il remplace ce plan
(ancien checkout `../yolo/vendor/next`, file P-NEXT-01..04) : route retenue `Bun.build` comme bundler de Next,
jalons J0..J6 avec leurs tests, constats Turbopack/`node`.

Côté aphrody restent les intégrations M3 : `m3/packages/m3-next` (withM3, M3Html/M3Root, thème, crawl, et
`m3-next` qui réexporte le runner de `@aphrody/next-bun/run`) et `m3/packages/m3-next-migrate` (migrateur
Next → hôte Bun/Tauri via `@aphrody/scaffold`, shims, codemod `mui-to-m3`, codemods next16/tailwind4 composés
depuis `@aphrody/next-bun/codemods`). `@aphrody/web-test/next` réexporte `@aphrody/next-bun/testing`.
