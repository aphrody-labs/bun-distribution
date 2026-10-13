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

The configured Windows runtime is Bun 1.4.4 at
`c62d01d81506a8b78b1d39b44d17edc81b4a6355`. The selected local executable
reported the Aphrody release URL and SHA-256
`f85c2517fc4eca8a4e82c15f3897ae39376ab8b9f338eee1bae5f383cc27a52a`.
This local digest does not authenticate the downloaded release archive. Linux
runtime pins remain target-specific and separately qualified.
The SDK uses published commit `939c835adf6479bc1014da3843cda4ae29851dbd`.
It contains our Tauri v3 alpha.4 fork, versioned 1.4.4. The npm SDK was unavailable,
so JS and Rust resolve the pinned source. Native CLI: `aphrody tauri`.
