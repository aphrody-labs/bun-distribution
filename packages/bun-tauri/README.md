# @aphrody/tauri

The Aphrody Tauri API, consolidated plugin guest bindings and Bun sidecar bridge.
The native crates live in a separate Cargo workspace in this directory; they are
not built into the Bun executable.

```sh
bun add @aphrody/tauri
```

```ts
import { menu, window, webviewWindow } from "@aphrody/tauri";
import { invoke } from "@aphrody/tauri/api/core";
import { Store } from "@aphrody/tauri/plugins/store";
import { bunFetch } from "@aphrody/tauri/bun";
```

All API namespaces are also available from `@aphrody/tauri/api`. Plugin guest
bindings require the corresponding feature and initialization of the native
`tauri-plugin-aphrody` crate. These APIs run inside a Tauri webview; installing
the JavaScript package alone does not create a native application.

The Bun server launched by the native plugin can use
`serveForTauri` from `@aphrody/tauri/server`. It binds the server to the plugin's
selected loopback port. The webview calls that server through the Bun IPC bridge.

Native checks run from this directory with `cargo check -p
tauri-plugin-aphrody --tests` and `cargo test -p tauri-plugin-aphrody`.
