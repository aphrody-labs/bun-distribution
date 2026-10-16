# Aphrody Generation / Bun

`artcraft-cli` exposes this library's existing provider routing through bounded
JSON lines. Models, request validation, cost estimates, uploads and generation
remain with the router and its existing clients.

```sh
artcraft-cli doctor
artcraft-cli commands
artcraft-cli models
artcraft-cli run --timeout-ms 30000
```

Input: `{ "id": 1, "method": "image.draft", "params": { ... } }`.
Output: `{ "id": 1, "ok": true, "result": { ... } }`, or a stable error code.

`image`, `video`, `audio`, `mesh` and `splat` each expose `.draft` and `.generate`.
Drafts estimate costs without network access. Generate finalizes and submits
through the selected native provider. `jobs.list` delegates to the existing
session-job endpoint. Model lists come from the router enums.

Parameters deserialize the existing `Generate*RequestBuilder` types. Required
fields are `model`, `provider` and `request_mismatch_mitigation_strategy`; use
`error_out` when a provider/model mismatch should fail. References use tagged
objects such as `{ "urls": ["https://..."] }` or
`{ "media_file_tokens": ["mf_..."] }`. Optional `context.media_files` maps
media tokens to URLs; `context.characters` supplies video character mappings.
Debug request captures are excluded from output.

Credentials are supplied only through explicit environment injection:

- `APHRODY_GENERATION_COOKIES`; optional `APHRODY_GENERATION_API_HOST`:
  `storyteller`, `fakeyou` or `localhost:PORT`.
- `FAL_API_KEY`, `GMICLOUD_API_KEY`, `GROK_API_KEY`, `WORLDLABS_API_KEY`.
- `KINOVI_COOKIES`.
- `MIDJOURNEY_COOKIES`, `MIDJOURNEY_USER_ID`, `MIDJOURNEY_USER_AGENT`.

The CLI does not read credential stores, launch login windows or copy sessions.
Discovery and draft gates do not invoke paid providers. Remote methods require
the caller's configured provider credentials; access remains unqualified until
that caller explicitly executes them.

Limits: 1 MiB per request, 16 MiB input per process, 8 MiB per reply and 1,000
requests. One operation runs at a time. Input and operations have a 30-second
default deadline, configurable up to one hour. A timeout stops the local task;
it does not claim to cancel an already submitted provider job.

Build with the repository's native serialized Cargo owner:
`cargo build --release --locked --package artcraft_router --bin artcraft-cli`.
The imported library retains its existing source licenses and attribution.
