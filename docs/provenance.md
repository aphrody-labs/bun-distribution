# Source provenance

The [Storytold inventory](https://github.com/orgs/storytold/repositories?q=sort%3Aname-asc)
contained 60 repositories on 2026-10-13. Selection favored active creative
engines, reusable components and explicit open source licenses.

| Capability | Source library |
| --- | --- |
| Generation | artcraft |
| Images | photocraft |
| Photo processing | lightcraft |
| Vectors | vectorcraft |
| Layout | designcraft |
| Interface layouts | figcraft |
| Video | filmcraft |
| Compositing | effectcraft |
| Audio | soundcraft |
| PDF | pdfcraft |
| Documents | wordcraft |
| Slides | deckcraft |
| Tables | gridcraft |
| CAD | cadcraft |
| Shared Rust libraries | craft-libs |
| Fonts | craft-fonts |

Config records source URLs and revisions. GitHub forks preserve full history;
local checkouts may be shallow. Source code uses MIT OR Apache-2.0. Fonts retain
their own licenses, including OFL. LICENSE, NOTICE and ATTRIBUTION files apply.
Reserved upstream logos and restricted assets are excluded from the shell.

Fair-source services, unlicensed prototypes, archived sources, datasets and
model repositories are excluded. Future frontend distribution must apply its
source NOTICE, which identifies restricted assets.

Our runtime is Bun 1.4.4 at `2ae8fc65fba1d05c423a2433b1195835109942b6`.
Its declared sourceUrl belongs to our fork; this does not verify an archive hash.
The SDK uses published commit `939c835adf6479bc1014da3843cda4ae29851dbd`.
It contains our Tauri v3 alpha.4 fork, versioned 1.4.4. The npm SDK was unavailable,
so JS and Rust resolve the pinned source. Native CLI: `aphrody tauri`.
