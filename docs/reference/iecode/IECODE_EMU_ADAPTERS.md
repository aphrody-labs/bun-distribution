# `iecode-emu` adapter audit

The four Python repositories here are historical format/extraction/modding
tools, not `iecode-emu` runtime dependencies. They are candidates for thin
compatibility adapters while the durable implementations move to the Rust
owners in the `iecode-emu` architecture. The machine-readable inventory is
[`iecode-emu-adapters.json`](./iecode-emu-adapters.json).

## Minimal common interface

The contract is in-process only. A Python implementation exposes
`capabilities()` and `call(request)`; a Rust implementation exposes the same
logical calls through [`iecode-emu-adapter.h`](./iecode-emu-adapter.h):

```text
capabilities(adapter_id) -> Capabilities
call(request)            -> Response
```

The request contains `schema`, `adapter`, `operation`, `input`, and `options`.
The response contains `schema`, `adapter`, `operation`, `outputs`, and
`diagnostics`. Inputs and outputs are typed buffers held in memory. No adapter
may start a shell, spawn a subprocess, discover game data implicitly, download
it, or install it.

This contract is intentionally small: `iecode-emu` can replace each Python
implementation behind the same operation and capability IDs without changing
callers. It is a migration seam, not a claim that the legacy scripts already
implement this ABI.

## Absorption map

| Adapter | Current role | Candidate Rust owner | Current gap |
| --- | --- | --- | --- |
| `buscador-inazuma` | NDS ROM inspection, PKB/PAC extraction, sprite/model search | `nie-formats` + `nie-explore` | GUI-only entrypoint; no stable machine API |
| `iestrikers` | DOL symbol lookup, disassembly, asset ripping, progress | `nie-pe` + `nie-re` + `nie-forge` | ppcdis/native toolchain and user DOL are external |
| `inazuma-eleven-go-mapenv` | Mapenv compile/decompile | `nie-formats` + `nie-explore` | needs buffer API for host calls |
| `inz-cond` | Level-5 condition decode/encode/generation | `nie-formats` + `nie-viola` | needs typed library calls |

The `status` values in the manifest deliberately say `legacy-adapter-audit`:
they identify a migration seam, not completed Rust parity. No adapter is
allowed to silently turn missing game data or a missing native toolchain into a
successful empty result.

The separate [`iecode-emu-migration.json`](./iecode-emu-migration.json) records the
Rust owner and migration phase. These manifests contain no ROM, DOL, mapenv,
archive, or condition dump.
