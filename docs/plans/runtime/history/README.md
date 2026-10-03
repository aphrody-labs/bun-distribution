<!-- SPDX-License-Identifier: Apache-2.0 -->
# Documents before the unified runtime plan

Archived on 2026-10-03 at the owner’s request. Copies are byte-for-byte originals.
The current authority is [the root plan](../../../../PLAN.md).
Historical relative links inside these exact copies retain their original repository-root base;
resolve them from `<repo>`, not from this archive directory.

| Original | Archive | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `PLAN.md` | [PLAN-before-unified-runtime-2026-10-03.md](PLAN-before-unified-runtime-2026-10-03.md) | 147626 | `c7dbb19bc3ae0761f6204182f274f5bffcb4df01740f5ed779ab033cb447190b` |
| `AGENTS.md` | [AGENTS-before-unified-runtime-2026-10-03.md](AGENTS-before-unified-runtime-2026-10-03.md) | 9511 | `482970ba7395f3fcf3f0526a6e1b37c7a92d213b709fb8ea7fff270b9da78fd1` |

## Transition validation

- Exact hashes of both archived originals verified against the pre-edit receipt.
- Nine current Markdown files and 41 relative links verified in the paired checkouts.
- Existing Aphrody CLAUDE.md/GEMINI.md symlinks still resolve to the rewritten AGENTS.md.
- Scoped Git whitespace checks pass; Yolo `mdbook build docs` passes.
- Aphrody `bun run docs:check` fails: generated STATE, docs README, UPSTREAMS,
  ecosystem files, documentation inventory and llms index are stale. These shared
  generated surfaces were not regenerated in this documentation-only batch.
- No Cargo build, runtime test, engine migration or performance measurement run.
- Aphrody has no configured origin remote at this transition; no remote created.

Private Codex instructions/handoff and the Aphrody domain instruction/memory
files were aligned separately, with previous existing instructions retained in
private backups. This does not synchronize provider databases or other agents'
private conversations. Yolo producer plan/instructions/memory are maintained in
its own repository.
