# Koharu capability map for Shenron

Source-level comparison prepared 2026-09-27 from Shenron `main` at
`ecc02b07` and Koharu base revision `c697b31e` in the local `aphrody-koharu` working tree; the Shenron adapter status was
updated 2026-09-28 from the current working tree. The operational counts below are
the state recorded by Aphrody AI's 2026-09-27 `docs/plans/ai/ROADMAP-AGENT-PILLARS.md` and
2026-09-25 `ADMIN-REPORTS.md`; this work did not query PostgreSQL or a live
service to refresh them.

Koharu source paths below are relative to the Shenron repository root, under
the sibling `../aphrody-koharu` checkout. This is a local-only working tree
with no Git remote, not a CI/release source. Its architecture describes a desktop app in
which a typed Tauri bridge drives an in-process page pipeline. The pipeline
stages are detection, OCR, translation, and inpainting; Koharu owns its scene
patches, project state, model runtime, translator, and agent. See
`../aphrody-koharu/packages/docs/en/development/architecture.mdx`,
`../aphrody-koharu/crates/koharu-pipeline/src/stage.rs`,
`../aphrody-koharu/crates/koharu-pipeline/src/stages/translation.rs`, and
`../aphrody-koharu/crates/koharu-ml/src/lib.rs`.

## Capability comparison

| Koharu surface | Shenron's existing capability and authority | Relationship and limit |
| --- | --- | --- |
| Image-based manga text detection and OCR | Shenron's manga corpus is recorded as 12,593/12,593 pages transcribed. Its OCR workflow uses stable page IDs, source/image hashes, structured results, and visual review; `packages/pipeline/scripts/_manga-ocr.ts` (not in repo) requires two independent image reads and an explicit coverage confirmation before an OCR result can reach editorial deposit. Databook OCR has 16,402 Japanese transcriptions recorded, with 2,528 pages still quarantined for source/OCR review. | `packages/shenron/pipeline/src/koharu.ts` validates `aphrody.manga.page-result/v1`, binds `sourceSha256` and exact Koharu input `imageSha256` to a Shenron manga manifest entry, and emits an unreviewed candidate. `pipeline koharu-candidate <manifest> <results.jsonl> <candidates.jsonl>` is the file handoff. It rejects non-manga results (including legacy `kind=image` detect output), unknown/duplicate page IDs, and hash mismatches. The output is not an OCR verdict, is not accepted by `parseMangaResults` or the deposit script as-is, and cannot clear databook quarantine or write editorial records. |
| Databook page detection/OCR candidate | The existing export identity is `{databookId,page}` (`apps/shenron/site/scripts/export-databooks-ocr.ts`); `depose-transcriptions.ts` uses the lot manifest as identity authority. The translation writer separately uses the same numeric identity, exact source text/image guards, `jugerTraduction`, and the write freeze (`_databooks-base.ts`). Legacy OCR manifests lack image hashes. | The exporter now emits v1 manifests with SHA-256 for both the original scan and exact resized JPEG. Process the exported JPEG locally with `aphrody manga pipeline <image> --kind databook --entity-id <databookId> --plate-number <page> --source-sha256 <original-scan-sha256> --image-sha256 <normalized-jpeg-sha256> --json`; do not use the catalog command that fetches the original CDN bytes for this manifest. `pipeline koharu-databook-candidate <manifest> <results.jsonl> <candidates.jsonl>` requires that hash-bearing manifest and Koharu `source.kind=databook`, `entityId`, and `plateNumber`; it binds both hashes and emits the distinct `shenron.databook.review-candidate/v1` with `decision=unreviewed`. Legacy manifests without hashes are refused; regenerate the export with `--force`. This is a sidecar candidate artifact only: it is not consumed by transcription/translation deposit, never changes OCR/translation quarantine, and performs no PostgreSQL/API writes. |
| Manga text-region/layout analysis | Shenron's roadmap says fine-grained dialogue-to-bubble mapping remains a manga backlog item. Its current transcriptions and page identities are domain records. | Both candidate schemas preserve Koharu region geometry, labels, detection labels/confidences, linked text, language/confidence values, per-stage provenance, and the cleanup-overlay digest. The manga adapter does not map geometry to Shenron's established `MangaOcrVisualReview` judgment, and neither adapter synthesizes an OCR/source review or translation acceptance. Separate reviewers must still inspect source pages and produce their existing review artifacts. |
| Japanese-to-French translation | The 2026-09-27 roadmap records 11,318 translated databook pages and 2,556 eligible pages remaining. `docs/guides/shenron/TRADUCTION-DATABOOKS.md` defines a supervised batch flow: filter out unhealthy OCR input, supply the lot-specific Dragon Ball lexicon, judge the French result, deposit transactionally, then rebuild derived RAG separately. `apps/shenron/site/src/lib/databooks-traduction.ts` implements input/output refusal checks. | Koharu's `koharu-translator` offers local and hosted model translation with target-language and provider configuration. This overlaps as a proposal generator, but no Shenron lexicon, quality judge, editorial provenance, or PostgreSQL writer is evidenced in that contract. Fluency or a successful Koharu translation stage is not an editorial acceptance. |
| Inpainting and translated page composition | Shenron stores transcriptions/translations as editorial data and keeps page images and publication in its own workflows. | Koharu's clean-plate image and typeset scene are project artifacts. They do not substitute for Shenron's versioned text fields or publication state. No conversion to Shenron's page/media record or review contract was found. |
| Scene revisions and project storage | Wiki/databook editorial changes are versioned in `public.wiki_revisions`; PostgreSQL is the canonical editorial store. | Koharu's scene revisions, patches, undo, and storage belong to Koharu project state. Similar revision concepts do not establish schema, authorship, provenance, rollback, or editorial equivalence with `wiki_revisions`. |
| RAG and knowledge | Shenron's RAG is derived from PostgreSQL/wiki/databook sources. The roadmap records 28,583 indexed passages and identifies RAG freshness/evaluation and manga-dialogue indexing as separate work. `docs/guides/shenron/TRADUCTION-DATABOOKS.md` requires rebuilding the databook RAG corpus after accepted deposits. | The inspected Koharu page pipeline is not a Shenron corpus or editorial source. No Koharu-to-Shenron RAG ingestion or shared index contract was found. RAG retrieval cannot approve OCR, translation, or canon. |

## Library source and Shenron candidate handoff

Koharu's page-processing source belongs to the standalone `aphrody-koharu`
workspace: `crates/koharu/koharu-library` provides the headless Rust document/pipeline
API, and `packages/koharu/sdk` currently declares `@aphrody/koharu-sdk` with a `./native`
entry that starts a `koharu-sdk` JSON-lines process. The observed SDK methods
include project/page queries, `pipeline.run`, and `page.result`; `page.result`
is typed as `unknown` in the current SDK source. This local package is not a
Shenron dependency: the workspace has no Git remote, the Rust library inherits
`publish = false`, the Bun SDK depends on `@aphrody/koharu-bridge` via
`workspace:*`, and no external package/binary release is available to pin.

Shenron's existing adapter consumes Aphrody's
`aphrody.manga.page-result/v1` JSONL, validates its source/page identity,
source and input-image digests, geometry, text and provenance, binds it to
Shenron's manifest, and emits an unreviewed manga or databook candidate
artifact. The native sidecar command now calls the independent `koharu-sdk`
binary directly:

```text
bun run pipeline koharu-native-candidate manga <manifest.json> <project-root> <project-name> <candidates.jsonl> [--sdk <binary>]
bun run pipeline koharu-native-candidate databook <manifest.json> <project-root> <project-name> <candidates.jsonl> [--sdk <binary>]
```

For each project page, it reads `page.sourceSha256` and `page.result` from the
same open native process. It selects a unique Shenron manifest entry only when
the SHA-256 of Koharu's persisted encoded page image equals the manifest's
`imageSha256`; it also rehashes the exported review image and checks its decoded
dimensions against the native result. Its mapper converts native regions,
texts, model provenance, and optional cleanup overlay digest into the existing
candidate schema. The manifest supplies Shenron page identity and the original
`sourceSha256`; the native SDK does not independently verify the original scan
or establish an editorial verdict. Imported PDF pages are bound by the SHA-256
of their rendered image, so a manifest for the PDF bytes alone cannot match.
The command requires a built `koharu-sdk` executable; no published binary or
cross-repo package dependency is claimed. Candidate generation remains a
sidecar only: it does not write PostgreSQL/API records, set review verdicts,
or clear quarantine; existing Shenron judges and editorial deposit remain
separate. Focused type checking passed; this integration has not been exercised
against a live native project.

Aphrody's `aphrody.ocr.result/v2` has a separate file handoff into the same
Shenron manga/databook review-candidate schemas:

```text
bun run pipeline aphrody-ocr-candidate <manga|databook> <manifest.json> <ocr-v2.jsonl> <candidates.jsonl>
```

The adapter requires each OCR record's exact input-image SHA-256 to match one
unique manifest entry and rehashes the exported review image. It retains OCR
markdown, ordered blocks, confidence, quality reasons, attempt provenance,
and a raw-output digest as `ocr` evidence. The manifest supplies Shenron's
editorial page identity and original-scan digest; `page_id` may equal the
manifest manga ID or `databook:<id>:<page>`, or equal `image.path` for a generic
PP-OCR batch. The latter is a scan-path trace, never an editorial identifier;
the unique manifest SHA-256 and rehashed image bind the page. The candidate's pipeline name denotes
the OCR v2 projection, not a processing engine or Koharu's four stages. Only `text` and
`needs-review` with transcription evidence are eligible; `no-text`,
`unreadable`, and `processing-error` fail the artifact. Its `decision` remains
`unreviewed`. For manga, `manga-revue-agents.ts prepare <run> --lot <n>
--sortie <reviews> --candidates <candidates.jsonl>` now consumes this artifact
as untrusted hints in the offline visual-review packet. It rechecks schema,
editorial identity, both manifest hashes, and the review-image bytes. The
separate visual transcription and coverage audit are still required by
`sceller`; this handoff is not approval or proof of a live Koharu OCR run.

## Editorial boundary

- Shenron's PostgreSQL records, source images, canonical Japanese lexicon,
  human/automatic judges, quarantine state, revisions, and publication rules
  remain authoritative. The boundary is described in
  `docs/architecture/shenron/APHRODY-ECOSYSTEM.md` and `docs/AGENTS.md` (not in repo).
- Aphrody/Koharu model output enters manga offline review only as an
  unreviewed candidate hint; the existing visual reviewers must still inspect
  the actual image and supply separate review artifacts. No adapter here writes
  to PostgreSQL/API or feeds an automatic verdict/deposit. Databook candidate
  artifacts have no offline review intake: `planches-a-relire.ts` reads a live
  PostgreSQL queue, while the transcription deposit consumes reviewed
  `{image,text}` JSONL rather than `shenron.databook.review-candidate/v1`.
  Do not use a Koharu pipeline run to resolve quarantined pages, mark
  a translation complete, change canon, or publish content.
- Databook candidate generation requires manifests emitted with the new v1
  hashes. This adds artifact-level source/image binding but does not establish
  a reviewed database snapshot, adjudicate source OCR, or clear quarantine.
  No production invocation or live service/database behavior was verified.
- There is no demonstrated completeness equivalence between Koharu's
  per-project processing pipeline and Shenron's manga/databook coverage,
  source review, lexicon alignment, revision history, or RAG corpus.

For the existing Aphrody–Shenron contracts and supported OCR/databook route,
see [`APHRODY-ECOSYSTEM.md`](APHRODY-ECOSYSTEM.md) and
[`TRADUCTION-DATABOOKS.md`](../../guides/shenron/TRADUCTION-DATABOOKS.md). This file is a focused
comparison snapshot, not a new workflow or operational inventory.
