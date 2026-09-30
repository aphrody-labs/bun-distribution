<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody manga

The aphrody-manga crate owns Aphrody's manga page API, CDN transport, and
versioned review result. With its optional koharu feature, page stages run
through the standalone `aphrody-koharu` checkout, via `koharu-library`.
Without that feature, model operations return an explicit Unavailable error.

The native library accepts exact encoded PNG, JPEG, or WebP bytes through
MangaPipeline::process_image_bytes and returns MangaPageOutput.
detect_image_bytes runs only Koharu detection. The full operation runs
detection, OCR, translation, inpainting, and Koharu PNG/PSD export;
model/runtime failures propagate as errors. Options select the target
language and CPU/GPU device. With the Koharu feature, callers may supply
typed PipelineConfig and ProvidersConfig overrides. Otherwise Koharu's own
persisted configuration is loaded. Provider settings are skipped when
options are serialized and are never present in page-result/v1.

Build a CLI with the native pipeline:

~~~sh
cargo build -p aphrody --features koharu
~~~

`aphrody manga models` reads Koharu's pipeline model choices directly from
`PipelineConfig::model_catalog()`. Add `--translation` to ask Koharu's
translator for its current local and configured provider models. These choices
are distinct from the pinned, digest-verified artifacts in `aphrody model
catalog`; the latter is only for weights managed by Aphrody's model store.

`aphrody manga preferences show` reads the same Koharu configuration as the
desktop UI and `koharu-sdk preferences.get` (`~/.koharu/config.toml`). It
reports credential presence without returning secret values. To replace a
section, use `preferences set-pipeline FILE`, `set-providers FILE`, or
`set-typesetting FILE` with the corresponding Koharu JSON shape. Provider
credentials use Koharu's native secret store through `preferences credential
PROVIDER --stdin` or `--clear`; no credential is accepted as a CLI argument.
The commands are available when the CLI is built with `--features koharu`.

For an existing Shenron manga manifest, supply its stable page ID and original
scan digest. The input digest is computed over the exact encoded image bytes
passed to Koharu. An optional --image-sha256 asserts that digest before model
initialization:

~~~sh
aphrody manga pipeline normalized-page.jpg --kind manga --page-id DB:vol1:1 --source-sha256 <original-scan-sha256> --image-sha256 <processed-image-sha256> --json -o page.psd > candidate.jsonl
~~~

For a normalized databook review image, identify the numeric record and plate:

~~~sh
aphrody manga pipeline normalized-plate.jpg --kind databook --entity-id 312 --plate-number 1 --source-sha256 <original-scan-sha256> --image-sha256 <processed-image-sha256> --json -o plate.psd > candidate.jsonl
~~~

Add `--ocr-result page-ocr.json` to the local `pipeline` command to project
that same completed Koharu run into the shared
`aphrody.ocr.result/v2` contract owned by `aphrody-ocr-core`. The option
requires a manifest page identity, original source digest, and
`--image-sha256`; the latter is checked against the exact encoded input bytes
before Koharu runs. The OCR record retains the input path, checked digest,
selected OCR model, page regions as quadrilateral blocks, confidence and
processing provenance. Its attempt duration covers the full Koharu pipeline.
An empty or incomplete transcription is `needs-review`, never an automatic
`no-text` editorial verdict. The existing page-result/v1 candidate remains
the richer manga geometry and translation record. Shenron binds both outputs
to its own manifest and review process; Aphrody does not deposit either. The
CLI creates the OCR JSON only when the target path does not already exist.

The emitted aphrody.manga.page-result/v1 JSON has source.kind, page identity,
original sourceSha256, exact Koharu input imageSha256, MIME/dimensions,
original-pixel region bounds/polygons, linked OCR and translation text with
confidence/model provenance, Koharu pipeline version, and optional cleanup
overlay digest. An image URL or numeric chapter ID alone does not establish a
Shenron manga manifest page ID. The record is an untrusted review candidate;
Shenron owns manifest binding, visual review, editorial acceptance, and writes.

The aphrody manga chapter and databook commands can also emit the same
versioned JSON with --json. CDN fetches use original encoded bytes; they do
not reproduce Shenron's normalized review images unless the supplied input and
digests prove that identity. For Shenron's normalized images, use the local
pipeline command shown above.
