# YOLO Core Library (`@aphrody/yolo-core`)

Native Bun owners shared by the Yolo CLI, MCP server and HTTP API. Public subpaths
cover `sys`, `vfs`, `vendor`, `runtime`, `verify`, `server`, `tools` (alias `mcp`), `fleet`,
`scaffold`, `curation`, `coord`, `distribution`, `host`, `units`, `ledger`,
`monitor`, `redis`, `gemma4` and `pm`.

## Unified dependency synchronization

The `pm` owner implements the first dependency-acquisition tranche of the
Bun/uv/Cargo manager requested in [GOAL](../../GOAL.md). It detects manifests,
requires existing locks and installed global binaries, and returns a read-only
preflight by default. Applying a ready plan runs each manager sequentially under
the existing native runtime supervisor. Cargo uses Aphrody's serialization wrapper.

```ts
import { planPackageSync, syncPackages } from "@aphrody/yolo-core/pm";

const controller = new AbortController();
const plan = await planPackageSync({ root: "/path/to/project", offline: true });
const result = await syncPackages({
  root: plan.root,
  offline: true,
  apply: true,
  signal: controller.signal,
});
```

The same operation is available through the single `aphrody-mcp` (hosting `yolo tool`) as `yolo_package_sync` and
through `POST /api/tools/call` on `yolo api`:

```json
{
  "name": "yolo_package_sync",
  "arguments": {
    "path": ".",
    "managers": "bun,uv,cargo",
    "offline": true,
    "apply": false
  }
}
```

Bun uses `--frozen-lockfile --ignore-scripts`; uv uses `--locked` and disables
Python downloads; Cargo uses `fetch --locked`. Authentication and shared caches
remain with their existing owners. Failed preflight applies nothing; a failed
manager stops subsequent managers. Native process ownership handles timeout and
cancellation. Apply needs an installed compatible native runtime. The initial
qualified platform is Linux x64; Windows descendant ownership remains open.

Add/remove/update operations, tool installation, engine selection, builds and
publication are outside this tranche. Lock creation belongs to the native manager;
missing or stale locks are reported instead of silently regenerated.

## Transport and persistence contracts

MCP and HTTP share tool definitions and argument validation; OpenAPI comes from
one owner. Each transport retains its Redis stores. HTTP file operations contain
both resolved paths and symlink targets within the workspace. HTTP mutation
requests honor configured tokens and reject untrusted browser origins.

`RedisVectorStore` persists copied Float32 vectors with validated dimensions,
metadata and cosine KNN filtering. Its exact search reads candidates in O(N);
it does not implement a Redis Search ANN index. `RedisTrainDb` persists validated
instruction/triple records and reports type/split counts. Pending offline writes,
deletes and clears reconcile on reconnect; the memory overlay is volatile across
process restarts. `persistenceState` and `sync()` expose that distinction.

Gemma profiles and memory estimates are explicitly unverified repository profiles.
Formatting is a text template, not a numeric tokenizer. `UnifiedInferenceEngine`
uses configured OpenAI-compatible providers for inference, incremental SSE and
`/embeddings`; errors propagate without simulated success. Local/OpenAI backends
require an endpoint, and mock inference requires explicit injection. No model
weights, tokenizer, native numerical inference or training are qualified here.
Text vector search requires an injected real embedder; callers can also supply
`queryVector` directly. The deterministic embedding utility is synthetic.

Monitors honor configured intervals, serialize cycles/probes and drain on stop.
Tests use explicit beacon paths, disposable repositories and isolated Redis/HTTP
servers. Scan fingerprints cover raw bytes in stable order; ledger fingerprints
cover file content. Vendor status reads complete refs, including packed refs and
worktrees; generated catalogs distinguish source and host-runtime revisions.

Evidence: [package-manager qualification](../../docs/package-manager-2026-10-04.json).
