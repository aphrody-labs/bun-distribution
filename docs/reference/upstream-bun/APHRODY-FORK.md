# Aphrody Bun fork

This repository is the public Aphrody fork of [oven-sh/bun](https://github.com/oven-sh/bun). `main` is the Aphrody integration branch; `upstream/main` is the Bun source branch. The first fork addition is [`bun:aphrody`](../src/js/bun/aphrody.ts), with [types](../packages/bun-types/aphrody.d.ts) and [focused tests](../test/js/bun/resolve/aphrody.test.ts). The module is bundled into the fork binary, but it lazily loads three separately built Rust dynamic libraries through `bun:ffi`. A checkout or upstream Bun binary alone cannot run those native operations.

## Contributing and adding a module

Read Bun's [contribution guide](../../guides/upstream-bun/CONTRIBUTING.md), [repository agent rules](./AGENTS.md), [built-in module guide](../../products/upstream-bun/src/js/README.md), and [review rules](./REVIEW.md) before changing runtime code. Bun requires its pinned Rust nightly and LLVM version; `bun bd` builds the debug binary, and `bun bd test <file>` runs tests against that binary. Bun's build requires an installed release Bun as a bootstrap tool. Use `bun run build:release` for a release build. The upstream [online contribution guide](https://bun.com/docs/project/contributing) explains setup and code generation.

For a JavaScript built-in module, place source under `src/js/bun/`, register its specifier in `src/resolve_builtins/HardcodedModule.rs`, expose types under `packages/bun-types/` when public, and add focused tests under `test/js/bun/`. Built-in modules are preprocessed and bundled by `src/codegen/bundle-modules.ts`; they are not ordinary ESM files. Use string-literal `require()` for dependencies and `export default { ... }` for exports. Registering a specifier does not link an external Rust crate into Bun; native code needs an explicit ABI, ownership and build design.

The current `bun:aphrody` contract exports `moduleVersion`, `version`, `runCaptured`, `scanNodeProject`, `formatSource`, `minifySource`, and `lintSource`. It expects ABI 1 from `aphrody-ffi` (`APHRODY_FFI_LIB`), ABI 2 from `aphrody-n2b-native` (`N2B_NATIVE_LIB`), and ABI 1 from `aphrody-oxc-bridge` (`APHRODY_OXC_LIB`). Without explicit paths it looks beside the Bun executable. See the [platform map](../infra/APHRODY-BUN-PLATFORM.md) for ownership and the currently verified scope. Do not describe these libraries as statically linked or claim that `Bun.build`, `bun test`, or Bun's internal minifier uses Oxc today.

## Branch and upstream workflow

1. Keep `origin` pointed at `aphrody-code/bun` and `upstream` at `oven-sh/bun`. Record `git status --short`, `git rev-parse main`, and `git rev-parse upstream/main` before integration.
2. Fetch both remotes. Make work on a `claude/` feature branch from current `main`, as required by this repository's agent rules. Keep Aphrody changes as small, reviewable commits and preserve upstream authorship and notices.
3. Merge a new upstream main into a dedicated `claude/upstream-YYYYMMDD` branch from Aphrody `main`. Resolve conflicts against current APIs, build the debug binary, and run changed-scope tests. Do not force push shared branches or use GitHub's one-click sync if it would discard the Aphrody delta.
4. Merge reviewed work into Aphrody `main`; tag only a tested Aphrody artifact. Record the exact Bun, Oxc, N2B, and native-library revisions in Infra before distribution. A Bun upstream canary is a separate artifact and does not include `bun:aphrody`.

The minimum local gate for this module is `bun bd test test/js/bun/resolve/aphrody.test.ts`, plus type checks for public declarations. Cross-platform release artifacts and consumer selection remain open work. The fork deliberately keeps upstream Git history and does not publish a replacement npm package named `bun`; distribution needs its own verified artifact and name.
