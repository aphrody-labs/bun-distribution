<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/winclean (anciennement @aphrody-code/winclean)

Bun client for the Aphrody OS kernel: 182 typed Windows computer-use and OS-control
tools routed through the same local endpoint as MCP, A2A, CLI and GUI.

```ts
import { Winclean } from "@aphrody/winclean";

using wc = Winclean.open();
const obs = (await wc.computerObserve({ windowHandle: 0 })).ok();
await Bun.write("window.png", obs.images[0]!.bytes);
await wc.computerClick({ windowHandle: 0, x: 120, y: 48 });
const os = (await wc.call("get_os_info")).json();
```

- Calls use the local kernel endpoint selected by `@aphrody/os`. This package is a
  private compatibility facade; new code must import `KernelClient` from `@aphrody/os`.
- `callSync` and direct DLL loading are intentionally removed.
- `src/generated.ts` and `src/catalog.ts` mirror the canonical Rust catalog
  (`packages/bun-windows-winclean/src/tools.json`); regenerate them, `generated.rs` and the
  migration ledger with `bun scripts/aphrody/tools/os/scripts/generate-winclean-catalog.ts`
  (`--check` verifies). Do not edit them by hand.
- Gaming profile: the `gaming_*` tools (GPU window capture, frame pacing, raw input, Steam
  launch, read-only optimisation checks); see `packages/bun-windows-winclean/README.md`.
- Tests: `bun test`.

See [`docs/winclean-native-import.md`](../../docs/winclean-native-import.md).
