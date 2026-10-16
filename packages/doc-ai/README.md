<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/doc-ai

Documentation and translation module of the Aphrody repository (command line: `yolo doc-ai`). It translates
Markdown, generates Lit component API guides, and syncs the root `docs/` folder.
The online backend uses Google Vertex AI through `@ai-sdk/google-vertex` and
`ai`; an offline fallback is available when Vertex credentials are absent.

## Commands

```bash
yolo doc-ai translate <file_or_dir> [lang]   # translate one .md file or a dir (recursive)
yolo doc-ai generate <ts_file> [out_file]    # generate a Lit component API guide
yolo doc-ai sync [lang]                      # translate every monorepo docs/ folder
yolo doc-ai --help                           # full usage
```

From the monorepo root, the wrapper scripts are wired in:

```bash
bun run docs:translate <file_or_dir> [lang]   # yolo ops docs assist translate -> yolo doc-ai translate
bun run docs:ai                               # yolo ops docs assist sync -> yolo doc-ai sync
```

Translations are written next to each source as `<name>.<lang>.md` (default
language `fr`).

## Configuration

| Env var                              | Effect                                           |
| ------------------------------------ | ------------------------------------------------ |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google ADC credential file used by Vertex AI. |
| `GOOGLE_CLOUD_PROJECT` or `APHRODY_VERTEX_PROJECT` | Vertex AI project and online mode. |
| `GOOGLE_CLOUD_LOCATION` or `APHRODY_VERTEX_LOCATION` | Vertex AI region (default `us-central1`). |
| `DOC_AI_MODEL` | Override the model (default `gemini-2.5-flash`). |
| `DOC_AI_REQUEST_TIMEOUT_MS` | Per-request network timeout (default `60000`). |

Without credentials, `generate`/`translate` fall back to a deterministic static
template so the pipeline stays runnable offline and in CI.

## Develop

```bash
bun run build # Bun-native build
bun run typecheck # Bun-native bun check
bun run test         # bun test
```
