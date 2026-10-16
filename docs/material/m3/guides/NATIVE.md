# Native library (`bun_rs` / `aphrody-ffi`)

`@aphrody/bun` is the Bun FFI wrapper over the Rust M3 code: token sheets (`m3Css`), Material
Symbols rendering (`m3Icon`, `m3IconNames`), Sass (`sassRustPlugin`), spec validation and scene
rendering. Importing it opens a native library; nothing in this repository compiles that library.

| Consumer | Uses |
| --- | --- |
| `@aphrody/m3` | `m3:*.css` sheets, `m3 tokens`, `.scss` loading (loaded lazily, `src/native.ts`) |
| `@aphrody/m3-theme` | `generate.ts` and the sheet conformance tests |
| `@aphrody/m3-icons` | every server entry (`index`, `react`, `lit`, `plugin`, `codegen`); the `browser*` entries never load it |
| `@aphrody/m3-design` | `validateSpec` |
| `@aphrody/canvas` | `drawM3Scene*` (optional peer) |

## Which file is opened

- npm `@aphrody/bun@3.3.x` (this repository's lockfile): `node_modules/.bun/@aphrody+bun@<v>/node_modules/@aphrody/bun/native/bun_rs.<so|dylib|dll>`.
- aphrody workspace build (`packages/interop/native`): `native/<triple>/libaphrody_ffi.<suffix>`,
  `native/libaphrody_ffi.<suffix>`, or with `APHRODY_FFI_DEV=1` the aphrody `target/` directory;
  `APHRODY_FFI_LIB` overrides it.

Both are the `aphrody-ffi` cdylib of the aphrody repository (`crates/interop/ffi`), which links the
`bun_rs_*` exports of `crates/ui/bun`.

## Build and link

Cargo is run only by the integrating build owner, serialized:

```sh
# in ~/aphrody
scripts/build/rust/cargo-serial.sh build --release --locked -p aphrody-ffi --features gpu
```

Then, in this repository:

```sh
bun scripts/native.ts status          # installed @aphrody/bun copies and the library they open
bun scripts/native.ts link            # plan: symlink the verified library into every copy
bun scripts/native.ts link --apply
```

`native.ts` resolves the library through the yolo producer SDK loader
(`@aphrody/runtime-sdk/ffi`, `nativeLibrary`, read from `$YOLO_ROOT/packages/runtime`): `--lib <file>`,
`$APHRODY_FFI_LIB`, `$BUN_RS_LIB`, the executable directory, `~/.local/bin`, `~/.local/lib/aphrody`, then
`target/{release,debug}` of `$APHRODY_ROOT` (default: the enclosing aphrody checkout, else `~/aphrody`).
A candidate counts only when it dlopens and exports `bun_rs_version`.

## Tests without the library

Suites that need the library skip with the loader's reason printed once per file
(`[@aphrody/m3-theme] native suites skipped: ...`): `packages/m3/test/native.test.ts`,
`packages/m3-theme/test/sheets.test.ts`, `packages/m3-icons/test/icons.test.ts` and the real-library
check of `scripts/native.test.ts`. Everything else, including the `m3 new` scaffold build, runs on a
deterministic sheet generator and needs no native code.
