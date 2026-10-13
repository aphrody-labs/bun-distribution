# Upstream conventions

Use Linux kernel, Debian, COSMIC and Bun upstream conventions.

Rust uses default rustfmt, four spaces, Rust naming,
rustdoc documentation and explicit errors. Document unsafe contracts and
exported symbols. Window event loops, system calls and application resources
remain with their owners.

TypeScript follows Bun upstream: two spaces, width 120, semicolons, trailing
commas and unparenthesized single arrow parameters. Use the APIs available
in the actual installed runtime; consult its declarations before adding flags.

COSMIC follows Application/Core/Message models and Element composition.
Preserve focus, state, inherited colors, compact navigation and pinned API limits.

Debian packaging uses explicit files and dependencies, extension-free installed
commands, separate configuration and artifacts, short symlinks, minimal permissions
and checked command status.

Use Bun-native APIs and commands.
review aggressive findings before accepting any source change. Run `bun check`,
`bun lint` and `bun fmt` directly. Confirm technical choices in primary sources.

References:

- [Linux Rust guidelines](https://docs.kernel.org/rust/coding-guidelines.html).
- [Debian Policy: files](https://www.debian.org/doc/debian-policy/ch-files.html).
- [Bun upstream formatter](https://github.com/oven-sh/bun/blob/main/.prettierrc).
- [COSMIC application template](https://github.com/pop-os/cosmic-app-template).
- [libcosmic API](https://pop-os.github.io/libcosmic/cosmic/).
