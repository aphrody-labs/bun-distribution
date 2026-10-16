<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- docs-links: external-paths — backtick paths in this dated document name files of the repository at the time it records (Shenron and Koharu moved to aphrody-labs/shenron on 2026-10-05), not of this checkout. -->
# Shared Shenron / Aphrody implementation — 2026-10-05

Aphrody owns common rendering and transport. Shenron retains Dragon Ball
presentation, bot/site policy, sessions, authorization and protected stores.

| Mechanism | Canonical owner | Consumers / compatibility |
| --- | --- | --- |
| Manga, databook, collection readers | `@aphrody/m3-reader` | `@shenron/ui/reader`, site adapters, M3 |
| Reader layout and Dragon Ball CSS | `@aphrody/m3-reader` | Existing Shenron CSS exports; live `--dbz-*` variables |
| Reader/site modal focus lifecycle | `@aphrody/m3-reader/use-focus-trap` | `@shenron/ui/use-focus-trap`, site hook |
| HTTP/JSON requests | `@aphrody/bun` (`src/http.ts`) | Shenron API, Aphrody compute, OCR/vision |
| AI wire value types | Shenron pipeline `ai/wire` and `ai/chat` | Historical compute facade uses type aliases |

The HTTP owner makes one request with cancellation and a deadline covering the
body. The clients retain their paths, signatures, schemas, persona prompts,
model choices, grounding, batching, permissions and historical error mappings.
API and OCR redirects are now refused like compute redirects, preventing an
implicit credential handoff. No subprocess or additional service is introduced.

The bot's pure rules and site domain source are untouched. Session-bearing chat
still uses the bot. The shared compute endpoint does not merge domain stores.
Six reader captures are identical; see reader qualification (`m3/packages/shenron-ui/QUALIFICATION.md`, not in repo).
No full-site pixel parity, RAG activation or native-host claim is inferred.

Validation:

- HTTP: 9 tests; compute/OCR compatibility: 52; pure generation/personas/eval:
  21 pass, 2 existing skips; UI: 49; canonical readers: 27.
- API suite: 46 pass, 1 pre-existing portability failure in two relative imports
  inside `packages/shenron/api/test/rag-live.test.ts`.
- Site subset: 19 pass, 2 failures requiring a fresh live RAG preload.
- Bot subset: 12 pass, 3 failures / 1 import error: live RAG preload unavailable
  and `@aphrody/discord-kit` runtime entry unavailable. No corpus prep was run.
- TypeScript passes in HTTP, API, pipeline, Shenron UI, M3 reader, app UI and site.
  Scoped strict oxlint/oxfmt pass. Five UI entry builds and Tailwind CSS pass.
- Normal Bun installation succeeds. Existing unrelated runtime SDK manifest and
  lock changes remain owned by their original batch. No new npm runtime dependency.
  No Rust source changes, Cargo build, production deployment or private-data migration.

Approximately 1,900 lines of copied reader/CSS/focus source are removed. Three
HTTP flows share one implementation and six duplicate facade value definitions
use existing wire types. This is source consolidation, with no runtime speed,
total bundle-size or full backend-convergence claim.
