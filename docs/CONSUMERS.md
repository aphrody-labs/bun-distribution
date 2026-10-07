<!-- SPDX-License-Identifier: Apache-2.0 -->

# Runtime consumers

Yolo produces the precompiled native runtime and lightweight SDK. Aphrody keeps
application behavior and consumes pinned archives; sibling repositories are not
Bun workspace members. The current Web consumer is delivered in Aphrody commit
`22f0c8f06`, with evidence in
its receipt.

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

The SDK is the workspace member `@aphrody/runtime-sdk` (`packages/engine/runtime`);
workspace consumers depend on it through `workspace:*`. Repositories outside the
workspace receive it through the single archive channel, like every other
`@aphrody/*` package:

```sh
yolo ops aphrody-packages prepare --package @aphrody/runtime-sdk --destination <dir> --apply
```

Archives are canonical and named by their SHA-256; the consumer pins them in its
`config/aphrody-packages.json` (not in repo) and refuses drift. Packing disables package hooks,
refuses dirty sources and never compiles native engines.

The runtime artifacts a workspace may activate are pinned separately in
`tools/config/native-runtime.json` (`yolo ops native-runtime`): acquiring sources does
not qualify a runtime library.

## Runtime artifact and rollout

Build/package native artifacts through the existing serialized owner and build
factory. Install/verify/rollback with the release owner; never hand-edit `current`
or `previous`. Pin compatible runtime and SDK revisions/hashes, run consumer
contracts and report installation separately from product activation.

`runtime:desktop` and `runtime:browser` remain reserved until their producer and
consumer gates pass. Keep Obscura/V8 while those capabilities are required.
Rollback reverts the consumer pin/change and selects a compatible installed
artifact through the release owner.
