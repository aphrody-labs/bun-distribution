<!-- SPDX-License-Identifier: Apache-2.0 -->
# @aphrody-code/winclean (compatibilité locale)

Bun client for the Aphrody OS kernel: 166 typed Windows computer-use and OS-control
tools routed through the same local endpoint as MCP, A2A, CLI and GUI.

```ts
import { Winclean } from "@aphrody-code/winclean";

using wc = Winclean.open();
const obs = (await wc.computerObserve({ windowHandle: 0 })).ok();
await Bun.write("window.png", obs.images[0]!.bytes);
await wc.computerClick({ windowHandle: 0, x: 120, y: 48 });
const os = (await wc.call("get_os_info")).json();
```

- Calls use the local kernel endpoint selected by `@aphrody/os`. This package is a
  private compatibility facade; new code must import `KernelClient` from `@aphrody/os`.
- `callSync` and direct DLL loading are intentionally removed.
- `src/generated.ts` mirrors the canonical Rust catalog; do not edit it by hand.
- Tests: `bun test`.

See [`docs/reference/os/winclean-native-import.md`](../../../../reference/os/winclean-native-import.md).
