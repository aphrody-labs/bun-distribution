<!-- SPDX-License-Identifier: Apache-2.0 -->
# Runtime consumers

Yolo produces the precompiled native runtime and lightweight SDK. Aphrody keeps
application behavior and consumes pinned archives; sibling repositories are not
Bun workspace members. The current Web consumer is delivered in Aphrody commit
`22f0c8f06`, with evidence in
[its receipt](../../aphrody/docs/migration/runtime-web-consumer-2026-10-03.json).

## Current Web contract

`engine.ts` and `service.ts` use the SDK-owned shared process supervisor. Engine
capture uses a bounded diagnostic tail; one-shot acquisition uses lossless raw
bytes with an explicit lifetime budget. Timeout, abort and overflow stop and
release the owned process. Native capture workers join before unload. Unix
process groups include descendants even after their leader exits; escaped groups
are outside ownership. Windows process-tree qualification remains open.

Linux x64 consumer gates: agent-browser 50, FUT 148, RG cron 174 and Web Test 41
tests pass. The 28 skipped tests retain their dataset or remote-CDP conditions.
This qualifies supervision, not distribution of Obscura, full product rollout,
desktop integration or JSC parity.

## Reproducible SDK packaging

The producer command reads committed SDK files at an exact revision, includes
the producer license and disables package hooks. It does not checkout a branch,
read dirty SDK files, include engines or invoke Cargo.

```sh
bun scripts/release/runtime_sdk_pack.ts --help
bun scripts/release/runtime_sdk_pack.ts /path/to/sdk-output --revision <full-commit>
```

The archive name includes the SHA-256 prefix; the adjacent JSON records the
complete hash, package version, size and source revision. Repeated snapshots
produce identical archive bytes. Symlink source entries and conflicting cached
archives are refused. Working tree edits remain intact.

Aphrody's Workspace owner must prepare this archive before frozen Bun installation
from `config/sibling-checkouts.json`. The configured revision and checksum are
independent requirements: acquiring sources does not qualify a runtime library.
The consumer's normal build uses this package, without compiling native engines.

## Runtime artifact and rollout

Build/package native artifacts through the existing serialized owner and build
factory. Install/verify/rollback with the release owner; never hand-edit `current`
or `previous`. Pin compatible runtime and SDK revisions/hashes, run consumer
contracts and report installation separately from product activation.

`runtime:desktop` and `runtime:browser` remain reserved until their producer and
consumer gates pass. Keep Obscura/V8 while those capabilities are required.
Rollback reverts the consumer pin/change and selects a compatible installed
artifact through the release owner.
