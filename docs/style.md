# Upstream conventions

Use concise English and Aphrody/Bun identity. Imported sources retain their
licenses and owner conventions. These references govern authored code.

| Scope | Rules | Source |
| --- | --- | --- |
| TypeScript | Two spaces, 120 columns, trailing commas, minimal arrow parentheses | [Bun formatter](https://github.com/oven-sh/bun/blob/main/.prettierrc) |
| Rust | Stable rustfmt, explicit ownership and cleanup, imports grouped per module | [Kernel Rust](https://docs.kernel.org/rust/coding-guidelines.html), [COSMIC](https://github.com/pop-os/libcosmic/blob/master/rustfmt.toml) |
| C | Kernel tabs and braces, shallow control flow, focused functions | [Linux kernel](https://docs.kernel.org/process/coding-style.html) |
| Sources/builds | Independent dependencies, exact revisions, preserved notices and non-interactive builds | [Debian Policy](https://www.debian.org/doc/debian-policy/ch-source.html) |

Use guard clauses and shared cleanup. Comments explain ownership constraints.
.editorconfig, .oxfmtrc.json and rustfmt enforce formatting.

Reviewed through `aphrody docs`, `aphrody awesome` and scoped remote
`aphrody git ingest`. Local ingestion is owned by Bun MCP in this runtime.
This language-specific mapping does not certify Debian packages or reproducible
native binaries.
