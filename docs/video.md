# Bun video integration

Video is the current priority. The source library is pinned to FilmCraft
`87b845138e2cecf43e97e2c2e011b820a6e70ecd` (0.7.2, MIT OR Apache-2.0).
Its Rust workspace remains independent.

The fork adds Bun-native JavaScript helpers. Rust and Cargo remain identical to
the upstream baseline `cee1feb185e675a108f78067f71ad86a640ace3d`, also used by
the parallel native codec owner.

## Owners

| Capability                                     | Owner                               |
| ---------------------------------------------- | ----------------------------------- |
| Project loading, schemas 1–15 and atomic saves | filmcraft-format                    |
| Exact time and rational frame rates            | filmcraft-time                      |
| Container probing and codecs                   | filmcraft-codecs / filmcraft-media  |
| Editing and command validation                 | filmcraft-engine                    |
| Rendering and export                           | filmcraft-render / filmcraft-export |
| Native Bun metadata and frame API              | Bun.Video                           |
| Typed process boundary                         | @aphrody/bun-video-project          |

The adapter calls the existing headless CLI with structured arguments and JSON.
It adds output limits, cancellation and typed operations. Rust retains project
migrations, editing rules, codecs and export. No FFmpeg subprocess or copied
decoder is introduced.

Failed native operations retain structured results and failure status. Export
uses a new destination directory to isolate filenames derived by native formats.

Tick values use 254,016,000,000 units per second. Ticks and IDs span i64/u64;
the JSON boundary preserves large integers as bigint. JSONL serialization emits
their exact decimal representation rather than rounded Numbers.

## Commands

```sh
bun run video doctor
bun run video:build
bun run video commands
bun run video probe /path/to/media.mp4
bun run video inspect /path/to/project.fcproj sequence
```

Use `.local/config.json` to select an existing `filmcraft-cli` binary, or build
the pinned library through the native workspace owner. API calls do not build
the engine implicitly. Save destinations are explicit; protected provider
stores, captures and datasets are outside this integration.

The selected Bun 1.4.4 runtime at
`c62d01d81506a8b78b1d39b44d17edc81b4a6355` exposes `Bun.Video` with its
FilmCraft decoder and system image backend. The typed adapter delegates media
decoding, transformed frames, bounded frame batches, PCM audio, GIF and MP4
remux to that runtime. FilmCraft remains the owner of projects, timelines,
commands and rendering workflows. API availability does not qualify individual
codecs or media output accuracy. See [qualification](qualification.md).
The current Linux x64 runtime reports no native video provider, so the same
adapter reports unavailable there until that target includes and qualifies it.
