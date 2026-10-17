<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody (Python)

A keyless Python library for Google's AI Ultra stack — **Gemini, Cloud
Code, Vertex AI, image generation and a local voice loop** —
that authenticates with the credentials already present on the machine.
**No API key is ever required.**

aphrody reads the Antigravity / agy OAuth token from the platform store:

- **Linux**: `~/.gemini/antigravity-cli/antigravity-oauth-token` (agy CLI; set `APHRODY_AGY_OAUTH_FILE` to override)
- **Fallback**: `~/.config/aphrody/antigravity-token.json` or aphrody's private cache

The token is kept fresh by re-reading the store (and pull-through refresh when
Google rejects the refresh grant). It is used as a Bearer credential for Vertex
AI (`google-genai`) and the Cloud Code `v1internal` API.

The OAuth client id and endpoints are public; the user's tokens
are read at runtime, stored only under the git-ignored secrets dir
(`var/secrets/` inside the repo, else `~/.aphrody/`; override with
`APHRODY_SECRETS_DIR`), mode `0600`, and never embedded, logged, or committed.
The Antigravity client is a *confidential* desktop client, so aphrody refreshes
by re-reading the OS credential store (which the app keeps current) rather than
calling the token endpoint with a secret it does not have.

Linux is the supported development and release platform.

## Install

```console
$ uv sync --all-packages --locked  # inside the Python workspace
$ uv run --package aphrody-cli aphrody-python <command>
```

Optional extras:

| Extra | Pulls | Enables |
|-------|-------|---------|
| `aphrody[voice]` | `google-antigravity[voice]` (faster-whisper, kokoro-onnx, numpy, websockets) | `aphrody-python voice` |
| Workspace `dev` group | `pytest`, `pytest-httpx`, `ruff` | SDK tests and lint (`uv sync --group dev`) |

## CLI

Install the separate `aphrody-cli` distribution for `aphrody-python` and
`aphrody-python-google`. The SDK alone installs no command-line executables.

```console
$ aphrody-python whoami                       # signed-in Google account (email + name)
$ aphrody-python token                        # token status (scopes, expiry) — never prints the token
$ aphrody-python chat "Summarize OAuth in one line."          # Vertex AI (OAuth, keyless)
$ aphrody-python models                       # account tier / models (Cloud Code, with a tier fallback)
$ aphrody-python image gen "a banana spaceship, studio render" --out ship.png --size 4K   # Nano Banana Pro
$ aphrody-python image icon gen "rocket launch" --style rounded --out rocket.png --ico     # Material 3 icon + .ico
$ aphrody-python voice                        # local voice-to-voice loop (see below)
```

Output is always UTF-8 (JSON for structured results), so the CLI is safe to
script and to drive from sub-agents regardless of the host console code page.

Both generate text with no API key:

- **`chat`** → Vertex AI via the OAuth token (`gemini-2.5-flash` by default; pass
  `--model`). Best for programmatic, system-style prompting. Project resolves via
  `APHRODY_VERTEX_PROJECT` / `GOOGLE_CLOUD_PROJECT`.

### Voice (`aphrody-python voice`)

A fully local, keyless **voice-to-voice loop**, served to the browser:

```
browser mic ─ws→ Whisper STT ─→ Antigravity Agent (keyless) ─→ Kokoro TTS ─ws→ browser speaker
```

- **STT**: local faster-whisper (`base` by default, `--whisper-model`).
- **Brain**: the `google.antigravity` Agent — keyless, driven by the Antigravity
  token; it streams the reply sentence-by-sentence with barge-in/interrupt.
- **TTS**: local Kokoro ONNX; the model + voices auto-download to
  `~/.aphrody/models/` on first run (`--voice-name`, default `ff_siwis`, French).
- Serves a WebSocket on `ws://127.0.0.1:8789` and a localized web UI on
  `http://127.0.0.1:8790` (`--host`, `--port`, `--ui-port`, `--ui false`).

Requirements: install the `aphrody[voice]` extra, and make the Antigravity agent
**localharness** binary discoverable. That binary ships with the Antigravity
desktop app (e.g. `…/Antigravity/resources/bin/language_server.exe` on Windows);
point `ANTIGRAVITY_HARNESS_PATH` at it if it is not auto-discovered.

## Library

```python
from aphrody import AphrodyClient
from aphrody.vertex import GeminiVertex

# Cloud Code / userinfo over the raw authenticated client (OAuth):
with AphrodyClient.from_credential_manager() as client:
    print(client.userinfo()["email"])

# Text generation over Vertex AI (OAuth, keyless):
print(GeminiVertex().generate("Say hello in one word."))
```

### Aphrody Web Browser

```python
from aphrody import WebBrowserClient, list_actors, run_actor

with WebBrowserClient() as web:
    page = web.fetch("https://example.com", profile="http")
    # Any kernel tool is also available through web.call_tool(name, arguments).

actors = list_actors()
result = run_actor(actors[0].name, input={"url": "https://example.com"})
print(result.output, result.storage_dir)
```

`WebBrowserClient` connects to `aphrody-mcp`. Actor discovery and runs
use the installed Aphrody Web Browser executable. Set `APHRODY_WEB_BROWSER_BIN`
to select an explicit executable. Actor input travels in a temporary private
file, not process arguments. The result directory is retained for inspection;
callers remove it when no longer needed.

## Layout

| Module | Purpose |
|--------|---------|
| `aphrody._paths` | resolve the private secrets dir (`var/secrets/` ▸ `~/.aphrody`) |
| `aphrody.auth.tokens` | `OAuthToken` value type + expiry logic |
| `aphrody.auth.credential_store` | Windows Credential Manager + token-file source/cache |
| `aphrody.auth.oauth` | refresh / tokeninfo / userinfo |
| `aphrody.auth.credentials` | resolve a valid token → keyless google-auth `Credentials` |
| `aphrody.endpoints` | public hosts, client ids, scopes, method paths |
| `aphrody.client` | `AphrodyClient` — Bearer HTTP + Cloud Code methods |
| `aphrody.web_browser` | `WebBrowserClient` — kernel web tools over MCP |
| `aphrody.actors` | Actor discovery and execution from Python |
| `aphrody.vertex` | `GeminiVertex` — google-genai over Vertex AI |
| `aphrody.images` | Nano Banana Pro (Gemini 3 Pro Image) generation/edit/compose, 1K/2K/4K |
| `aphrody.prompts` | Nano Banana Pro prompt template library + enhancer (no deps) |
| `aphrody.optimize` | lossless PNG (oxipng) + WebP/AVIF re-encode — `aphrody[images]` |
| `aphrody.batch` | declarative concurrent bulk generation from a JSON spec |
| `aphrody.icons` | Material 3 icon generation + SVG→PNG→Windows `.ico` — `aphrody[icons]` |
| `aphrody.voice_server` | local Whisper↔Agent↔Kokoro voice loop + web UI |
| `aphrody.cli` | the `aphrody` command-line interface |

## License

Apache-2.0. Native ranking source is owned by the Aphrody Rust monorepo and built from its pinned, verified distribution artifact.

## SDK distributions

Public clients load on demand. `ActorClient` configures Actor discovery and
execution; `AuthenticatedDocsClient`, `AuthenticatedDriveClient`, and
`BlenderRunner` expose the document, file and Blender integrations directly.
Persistent clients support context managers and release connections they own.

The wheel includes the stable-ABI Rust ranking extension (built from the monorepo
crate `crates/aphrody-rust`, with its CycloneDX SBOM), native type stubs, `py.typed`
and the headless Blender scripts. Wheels are built inside the Aphrody monorepo
(`uv build --wheel`); the Rust source is not copied into this package.

```python
from aphrody import ActorClient

actors = ActorClient(timeout=120, discovery_timeout=10)
for actor in actors.list():
    print(actor.name)
```

The [SDK guide](https://github.com/aphrody-labs/aphrody/blob/main/py/docs/sdk/README.md)
and [validation guide](https://github.com/aphrody-labs/aphrody/blob/main/py/docs/sdk/validation.md)
describe installation, runtime configuration and distribution checks.

RAG cosine and rank fusion use the native canonical rag-core calculations.
The historical py_* math imports are compatibility aliases, not Python
implementations. Install the native SDK wheel before using RAG math; missing
extensions raise ImportError rather than selecting different calculations.
Reciprocal rank fusion uses one-based contributions: first rank is 1/(k+1).
