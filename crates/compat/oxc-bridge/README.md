<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Oxc bridge — Yolo owner

This library preserves the Oxc bridge originally imported from
`oxc/apps/aphrody-oxc` at revision `31d5266e150ff17af52f0c2fc798cc27dc9a5a59`.
Yolo owns its implementation; the package and C symbol identities stay unchanged.
The current Oxc dependencies inherit the Yolo workspace pin to upstream revision
`8c5a04ea0d5ca56e0d2d925f51f6b45669aa5e2a`: parser/minifier 0.152.0,
formatter 0.71.0 and linter 1.86.0. The original import revision is provenance,
not the current dependency pin.

It is an optional internal Rust library, with Rust 1.97 as its minimum version.
`aphrody-ffi` owns the existing dynamic artifact and reexports the C symbols;
the bridge adds no second dynamic library and does not enter Yolo's default
runtime dependency graph. Build its final C ABI artifact with an unwind profile
to preserve its panic-to-error boundary; `panic=abort` cannot recover a panic.

ABI 1 exports `aphrody_oxc_abi_version`, `aphrody_oxc_format`,
`aphrody_oxc_minify`, `aphrody_oxc_lint`, `aphrody_oxc_analyze`,
`aphrody_oxc_parse` and `aphrody_oxc_free`. Format and
minify return JSON `{ "ok": true, "code": "..." }`; lint returns
`{ "ok": true, "diagnostics": ["..."] }` with Oxc's default rule set.
Failures return `{ "ok": false, "error": "..." }`. Inputs are NUL-terminated
UTF-8 source and filename strings. The filename extension selects JS/TS syntax.
Release every result exactly once with `aphrody_oxc_free`, which accepts null.

Analyze returns `{ "ok": true, "result": ... }` with static module requests
and exports in source order, including TypeScript and wildcard exports. Parse
returns the official Oxc ESTree JSON program. Both use UTF-16 spans and return
`kind: "syntax"` for parser/semantic failures. JSON preserves BigInt/RegExp
metadata while their runtime `value` fields remain null.

Bun consumers keep `@aphrody/bun/oxc`, sharing the same lazy native handle as
other façade bindings. Yolo's `@aphrody/yolo-core/compiler` provides native
Oxc AST and module analysis; ordinary transpilation and bundling stay with
`Bun.Transpiler` and `Bun.build`. These synchronous bridge operations do not
replace Bun's parser, bundler, test runner or CLI commands. Source ownership
does not prove a rebuilt Bun builtin or an installed artifact. Release packaging
and platform parity are separate acceptance gates.
