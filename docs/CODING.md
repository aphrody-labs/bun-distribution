# Coding conventions

Use concise English and Aphrody/Bun identity for first-party code. Imported
sources retain their licenses, notices and owner conventions. These rules govern
authored code; they do not certify package compliance or reproducible binaries.

| Scope | Rules | Source |
| --- | --- | --- |
| TypeScript | Two spaces, 120 columns, semicolons, trailing commas, minimal arrow parentheses | [Bun formatter](https://github.com/oven-sh/bun/blob/main/.prettierrc) |
| Rust | Default rustfmt, four spaces, Rust naming, rustdoc for public items, explicit errors, ownership and cleanup | [Linux Rust guidelines](https://docs.kernel.org/rust/coding-guidelines.html), [COSMIC rustfmt](https://github.com/pop-os/libcosmic/blob/master/rustfmt.toml) |
| C | Kernel tabs and braces, shallow control flow, focused functions | [Linux kernel coding style](https://docs.kernel.org/process/coding-style.html) |
| COSMIC UI | Application/Core/Message models and Element composition; preserve state, focus, inherited colors and pinned API limits | [Application template](https://github.com/pop-os/cosmic-app-template), [libcosmic API](https://pop-os.github.io/libcosmic/cosmic/) |
| Debian packages | Explicit files and dependencies, extension-free installed commands, separate configuration and artifacts, short symlinks, minimal permissions, checked command status | [Debian Policy: files](https://www.debian.org/doc/debian-policy/ch-files.html), [source packages](https://www.debian.org/doc/debian-policy/ch-source.html) |
| Sources and builds | Independent source owners, exact revisions, preserved notices, non-interactive builds | [Debian source policy](https://www.debian.org/doc/debian-policy/ch-source.html) |

Use guard clauses and shared cleanup. Document unsafe contracts and exported
symbols; comments should explain ownership constraints. Window event loops,
system calls and application resources stay with their existing owners. Check
the installed runtime declarations before adopting API flags.

`.editorconfig`, `bun-format.json` and `rustfmt.toml` enforce formatting. Use
Bun-native APIs and run `bun check`, `bun lint` and `bun fmt` directly.
Confirm technical choices against primary sources.

This guide was reviewed with `aphrody docs`, `aphrody awesome` and scoped
`aphrody git ingest`. Local source ingestion is owned by Bun MCP in this runtime.
