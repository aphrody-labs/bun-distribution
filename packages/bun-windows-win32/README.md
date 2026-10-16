# Bun OS Win32 metadata

`@aphrody/bun-windows-win32` owns the runtime descriptors, namespace metadata and shared family loader used by `bun:windows`.

Install a public DLL family to use its typed entrypoint:

```sh
bun add @aphrody/bun-windows-kernel32
```

```ts
import kernel32 from "@aphrody/bun-windows-kernel32";
console.log(kernel32.GetCurrentProcessId());
```

Each family package keeps its public name, declarations and exact dependency on this package. Its entrypoint delegates to the shared loader; function bindings and namespace descriptions remain lazy. The shared loader passes its own metadata instance to the native binding, so nested package installations work independently of the caller's directory.

Runtime family descriptors live in `families/`, and namespace descriptions live in `ns/`. Both are generated from Microsoft's Win32 metadata by `scripts/aphrody/win32/gen.ts`. Regenerate and check the same metadata source with:

```sh
bun scripts/aphrody/win32/gen.ts
bun scripts/aphrody/win32/gen.ts --check
```

The generated layouts target Windows x64. See `LICENSE-Microsoft.txt` for the metadata license.
