# Aphrody Oxc bridge

This `cdylib` exposes Oxc to the Aphrody Bun fork's `bun:aphrody` module through
`bun:ffi`. It is built from the current Oxc workspace, not a second parser in
Bun. Build with `cargo build -p aphrody-oxc-bridge`; the caller can set
`APHRODY_OXC_LIB` to the resulting library path.

ABI version 1 exports `aphrody_oxc_abi_version`, `aphrody_oxc_format`,
`aphrody_oxc_minify`, `aphrody_oxc_lint` and `aphrody_oxc_free`. Format and
minify return JSON `{ "ok": true, "code": "..." }`; lint returns
`{ "ok": true, "diagnostics": ["..."] }` using oxlint's default rule set.
Errors return `{ "ok": false, "error": "..." }`. Inputs are NUL-terminated
UTF-8 source and filename strings. The filename extension selects JS/TS syntax.
The caller must free each returned pointer exactly once with `aphrody_oxc_free`.

This bridge runs synchronously. It does not replace Bun's parser, `Bun.build`,
test runner, minifier or CLI commands. Those integrations need separate runtime
changes and parity checks.
