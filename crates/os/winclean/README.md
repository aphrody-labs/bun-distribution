<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-winclean

Rust-owned compatibility surface exposing all 166 Windows computer-use and OS-control tools as typed Rust calls — one blocking
and one `*_async` method per tool, `serde` argument structs with builder setters, and
`ToolResult { ok, json, text, images }`.

```rust
use aphrody_winclean::{ComputerClickArgs, ComputerObserveArgs};

let wc = aphrody_winclean::shared()?;
let obs = wc.computer_observe(&ComputerObserveArgs::new().window_handle(0))?.ok()?;
std::fs::write("window.png", &obs.images()[0].bytes)?;
wc.computer_click(&ComputerClickArgs::new().window_handle(0).x(120).y(48))?.ok()?;
```

- Types and the embedded catalog (`catalog()`, `TOOL_NAMES`) compile on Linux and
  Windows; `Winclean::load` returns the in-process Rust client on every target.
- `src/generated.rs` and `src/tools.json` are the canonical checked-in Rust catalog and bindings.
- Production routing is owned by `aphrody-kernel` and the Rust dispatch in this crate. There is
  no DLL discovery, C ABI loader, NativeAOT runtime, or managed fallback.
- Example: `cargo run -p aphrody-winclean --example observe`.

See [`docs/winclean-native-import.md`](../../docs/winclean-native-import.md).
