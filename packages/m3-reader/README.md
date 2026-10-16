<!-- SPDX-License-Identifier: Apache-2.0 -->
# @aphrody/m3-reader

Material 3 React readers for paged and vertical manga and illustrated books. This package owns the reader UI, paging, virtual scrolling, zoom, fullscreen, thumbnails, keyboard controls, and lightbox focus. It does not own an asset server, editorial API, persistence, or OCR policy.

Import `@aphrody/m3-reader/styles.css` once in the host stylesheet. The host must load Tailwind 4 and scan the package's `dist` directory with `@source`, as with other Aphrody M3 component packages. CSS colors use Material 3 `--md-sys-color-*` roles, with readable fallbacks. The reader can also be themed through `--reader-surface`, `--reader-on-surface`, `--reader-accent`, `--reader-on-accent`, and `--reader-outline`.

`MangaReader` accepts page URLs, direction, adjacent chapter links, an asset resolver, an optional mirror resolver, and callbacks for page addressing. `CaptionedReader` accepts numbered pages, an abortable transcription loader, a transcription renderer, image optimization callbacks, and a preload count. `CollectionReader` owns edition and chapter controls; the host supplies its edition grouping and chapter renderer. The host supplies domain-specific loading and rendering.

The `/source` export serves TypeScript sources to hosts that transpile the package themselves (Next, Bun); the root export points to the compiled `dist`. Hosts remain responsible for asset routing, API links, reading history, on-demand transcription retrieval, OCR warnings, correction links, and Markdown rendering.
