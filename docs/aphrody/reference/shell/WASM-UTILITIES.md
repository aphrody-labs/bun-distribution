<!-- SPDX-License-Identifier: Apache-2.0 -->
# WASM shell utility registry

The table below comes from the registry printed by
`scripts/build/rust/cargo-serial.sh run -p aphrody-shell-wasm-utils --example catalog`.
The `own` implementations operate on pipeline bytes and `aphrody-shell-vfs`; they do not
access the host filesystem. Only a small option subset is supported. The gated golden
test uses `APHRODY_COREUTILS_BIN` to compare shared fixtures with the pinned uutils
0.12.0 multicall binary.

| Utility | Source |
| --- | --- |
| `basename` | `own` |
| `cat` | `own` |
| `cut` | `own` |
| `dirname` | `own` |
| `echo` | `own` |
| `false` | `own` |
| `head` | `own` |
| `printf` | `own` |
| `seq` | `own` |
| `sort` | `own` |
| `tail` | `own` |
| `tee` | `own` |
| `tr` | `own` |
| `true` | `own` |
| `uniq` | `own` |
| `wc` | `own` |

`ls`, `cd`, `mkdir`, `rm`, `cp`, `mv` and `touch` remain in the local shell's
filesystem builtins. The registry overrides its older `echo`, `cat` and `wc`
implementations and supplies the other commands.
