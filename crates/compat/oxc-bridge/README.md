<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Oxc bridge

This library preserves the Oxc bridge from `oxc/apps/aphrody-oxc` at revision
`31d5266e150ff17af52f0c2fc798cc27dc9a5a59`. It is an internal Rust library;
`aphrody-ffi` owns its dynamic artifact and reexports its C symbols. All Oxc
workspace dependencies use that same pinned fork revision.

ABI 1 exports `aphrody_oxc_abi_version`, `aphrody_oxc_format`,
`aphrody_oxc_minify`, `aphrody_oxc_lint` and `aphrody_oxc_free`. Format and
minify return JSON `{ "ok": true, "code": "..." }`; lint returns
`{ "ok": true, "diagnostics": ["..."] }` with Oxc's default rule set.
Failures return `{ "ok": false, "error": "..." }`. Inputs are NUL-terminated
UTF-8 source and filename strings. The filename extension selects JS/TS syntax.
Release every result exactly once with `aphrody_oxc_free`, which accepts null.

Bun consumers use `@aphrody/bun/oxc`, sharing the same lazy native handle as
other façade bindings. These synchronous operations do not replace Bun's
parser, bundler, test runner or CLI commands. Release packaging and platform
parity are separate acceptance gates.
