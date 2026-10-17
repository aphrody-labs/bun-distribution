# DBXV2 reverse engineering (bun-re, WASM, FFI, Shenron)

One capability merges four former owners:

| Owner | Role now |
|---|---|
| `packages/dbxv2` (Python toolkit, submodule) | Reference implementation and format catalogue (`formats.json`, `DATA.md`, `docs/`). Kept for `serve`, `rag`/`llm`/`caption` (Gemini), `tools clone` and `setup`, which have no Rust port. |
| `crates/re` (`bun-re`, feature `dbxv2`) | The port of every other Python pass: `bunre dbxv2 map|reverse|extract|tex|audio|text|models|parse|index|classify|search|stats|sav|report`, with the gameplay readers (BAC/BCM/BCS/BDM/BSA/EAN/EMM/ESK) ported from pyxenoverse offset for offset. |
| `packages/re` (Bun fork of morluto/rea) + `packages/re/replica` | Binary-analysis tooling and the Replica skills; DBXV2 reuses it for the `reverse` pass only. |
| Shenron (`packages/shenron-*`) | Consumer of the in-memory surface below. |

## In-memory surface

`bun_re::game::api` (features `dbxv2` or `wasm`) works on bytes only:

- `identify(bytes, name)`: magic first, extension second, with the `formats.json` category.
- `cpk_list` / `cpk_extract`: plain `CPK ` archives through the canonical `aphrody-nie-formats` reader (CRILAYLA decompressed).
- `summarize(bytes, name)`: JSON for EMB, EMD (counts per part), ESK, CMS, CUS, PUP, MSG and the gameplay formats.
- `audio_to_wav(bytes)` (feature `dbxv2`): HCA, ADX, AWB and embedded-AWB ACB to PCM16 WAV, one per subsong.
- `xz_decode(bytes)` and `decode_asset(bytes, name)`: pure-Rust xz (`lzma-rs`, no C dependency, so also in the wasm build) and gzip decoding of stored assets; `read_asset(root, kind, cpk, path)` (feature `dbxv2`) reads from a local assets tree.

## Assets tree and origin

The private dump is reorganised by `scripts/aphrody/tools/infra/dbxv2-assets-layout.ts` into `<kind>/<cpk>/<path>` (`kind` = models, textures, audio, video, text, data) and served by the mesh-only nginx origin (`infra/config/host/nginx/private/dbxv2-assets.conf`, `10.200.77.1:8794`). Storage contract:

- `models`, `textures`, `data`, `text`: stored once as `<path>.xz` (`xz -9e --threads=1`, about 30% smaller than gzip -9 on EMD). Clients request `/<kind>/<cpk>/<path>.xz`; the origin returns the xz stream untouched as `application/x-xz` (no `Content-Encoding`, no gzip/gunzip) and the client decodes it. A `<path>.gz` can only remain while a conversion is unfinished; it is still served inflated.
- `audio`, `video`: raw, requested without suffix (`/video/` supports ranges).
- `meta/index.jsonl`: one line per file with `cpk`, `path`, `kind`, `size` (original bytes), `gzip` (true only for a leftover `.gz`), `compression` (`"xz"`/`"gzip"`, absent for raw) and `stored` (bytes on disk).
- Every `.xz` is decoded and its length compared with `size` before the previous copy is deleted.

Decoding: `bun_re::game::api::{xz_decode, decode_asset, read_asset}`, `shenron_dbxv2_xz_decode` / `shenron_dbxv2_read_asset` (C ABI), `wasm_xz_decode` (wasm), and in `@shenron/dbxv2` `xzDecode` on both loaders, `loadDbxv2Ffi().readAssetFile(root, kind, cpk, path)` (sync, local tree) and `createAssetReader(origin, loader).readAsset(kind, cpk, path)` (async, local directory or `http(s)://` origin; `assetUrl()` builds the request URL).

## WebAssembly

`wasm_identify_format`, `wasm_summarize`, `wasm_triage_cpk`, `wasm_extract_cpk_file` (feature `wasm`) and `wasm_xz_decode`, `wasm_audio_to_wav` (adds `dbxv2`) in `crates/re/src/game/wasm.rs`. Build with `wasm-pack build crates/re --target web --features wasm`. Typed loader: `loadDbxv2Wasm` in `@shenron/dbxv2`.

## C ABI

`crates/shenron-dbxv2` (cdylib + rlib) exports `shenron_dbxv2_{abi_version,version,last_error,buf_free,identify,cpk_list,cpk_extract,summarize,audio_to_wav}`. Results come back through an out buffer (`ptr`, `len`) freed with `shenron_dbxv2_buf_free`; status is 0, -1 (error, see `last_error`) or -2 (panic). Typed `bun:ffi` loader: `loadDbxv2Ffi` in `packages/shenron-dbxv2` (library from `SHENRON_DBXV2_LIB` or `target/{release,debug}`).

## Not in scope

EEPK/EMP effects, USM video demux in the in-memory surface (the file-based export already remuxes USM), IDB and quest formats are catalogued only: the Python toolkit never parsed them either. Game assets are never committed; the private dump on the VPS is read-only verification data.
