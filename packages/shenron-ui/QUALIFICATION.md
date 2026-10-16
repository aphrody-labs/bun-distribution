<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shenron / M3 reader consolidation — 2026-10-05

The three copied readers now delegate to `@aphrody/m3-reader/source`.
Both CSS exports import that owner's styles and Dragon Ball skin. The public
reader names, types and host adapters are retained. Focus handling is shared
with M3; nested modals and fullscreen lifetime use the qualified common hooks.

Removed duplication: three React implementations, two stylesheets and a focus
hook. Together with the site's copied hook this removes approximately 1,900
lines of maintained copies. No content media, Dragon Ball theme values,
site routes, transcription providers or editorial rules were changed.
`swiper` and `@tanstack/react-virtual` belong to the reader dependency now;
their transitive runtime requirements remain.

Six Chromium 153 captures are byte-identical before/after: manga, databook
and collection at 1280×832 and 390×844. Fresh isolated browser contexts,
synthetic page media, identical browser/fonts/viewport and blocked external
requests. Collection selection also executes successfully. Zero page errors.
This proves reader parity on these scenes, not every site page or native Tauri.

| Reader / viewport | Before = after PNG SHA-256 |
| --- | --- |
| Manga 1280 | `5a6fa937fd049b377cc0f9d9384be0e7184e79ef789a2a126166362ef995eb93` |
| Databook 1280 | `614475421a3739a937047596db5d9ca47a2a0e615535f928baef8e09f8325dff` |
| Collection 1280 | `aa7dca7ac2869d75e6ac63630879b1d0b39abe1b85a91292380377b4c2d700f1` |
| Manga 390 | `b02770da88b2a9a60c77950776f7281e29e3863912c67e750850bc935064e023` |
| Databook 390 | `89bb82ce71f6e2e674037af0a14b1a02ef97d85ef1a1b6dbf44588c31f83e1c9` |
| Collection 390 | `6a2f6cd9808631c3ffe18f2b079ce5fd703260d88a47b56b7b1a10757c009e56` |

Validation: 49 Shenron UI tests and 27 reader tests pass. TypeScript passes for
both packages and the consuming site/app. Strict scoped lint and format pass.
The five-entry production browser build and Tailwind compilation pass; bundles
externalize dependencies, so their smaller entry size is not a payload saving.

Receipts and screenshots remain in the enclosing Aphrody checkout's ignored
`.coord/runs/shenron-aphrody-dedup`. No publication or host activation.
