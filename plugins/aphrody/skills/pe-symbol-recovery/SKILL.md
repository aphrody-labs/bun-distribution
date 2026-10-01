---
name: pe-symbol-recovery
description: "Recover function/structure symbols in Windows PE and .NET binaries: stripped functions, call graphs, method tables, packed binaries. Use when asked what a stripped .exe/.dll does or to name its functions."
allowed-tools: Read, Grep, Glob, Bash
---

# PE Symbol Recovery (Windows / .NET)

> **Applies when:** a PE/.NET file is available and the `aphrody` CLI (`aphrody re ...`) or the kernel MCP tools `re_triage`, `re_sections`, `re_strings`, `re_disasm`, `analyze_pe` are connected. **Otherwise:** use `objdump`/`llvm-objdump`/`rizin`/Ghidra and say that the Aphrody triage step was skipped.

Recover meaningful function names, types, and call relationships from stripped Windows PE binaries. Use the `aphrody-re` crate (`crates/os/re`) through `aphrody re` and preserve evidence artifacts outside the product runtime path.

## When to Use

- A user pastes a `*.exe` / `*.dll` path and asks "what does this do?"
- Stripped binaries where IAT entries are obfuscated or resolved late.
- Mixed-mode .NET binaries (native + managed) where method tokens need cross-referencing with native call sites.
- Pre-debloat audit: confirm a `system32` binary's exports before nuking it.
- Comparing two builds of the same DLL to find changed code paths.

## When NOT to Use

- Live process introspection — use the process tools of the `aphrody-winclean` crate (`crates/os/winclean`) hosted by the kernel (`list_processes`, `mem_list_modules`).
- DLL hijacking detection — use the repository reverse-engineering commands and
  preserve the evidence artifact.
- Pure managed disassembly with full PDB available — `dnSpy` / `ilspycmd` are faster.

## Quick Start

```powershell
# Static triage through the canonical Aphrody reverse-engineering surface.
aphrody re triage C:\Windows\System32\target.dll
aphrody re sections C:\Windows\System32\target.dll
aphrody re strings C:\Windows\System32\target.dll
```

The Rust reverse-engineering surface owns the batch scan path; extend the canonical command or
kernel handler rather than introducing a parallel WinClean engine.

## Recovery Strategy (Priority Order)

1. **Export Address Table first** — `pe.ExportedFunctions` returns ordinal + name pairs. Always cheap.
2. **Import Address Table cross-reference** — every external call gives a _known_ symbol on the other side. Walk `pe.ImportedFunctions`.
3. **String references** — strings near a function often name it (`"failed to open registry key %s"` → likely `OpenRegKey`).
4. **Constants & syscall numbers** — Windows syscalls have stable numbers in modern builds; match against [j00ru's syscall table](https://j00ru.vexillium.org/syscalls/nt/64/) (URL not verified here; check it before relying on it).
5. **Paired-function inference** — alloc/free, lock/unlock, init/teardown, open/close. If you can name one, the partner is usually structurally adjacent.
6. **.NET metadata** — `MetadataReader` (System.Reflection.Metadata) exposes method tokens, type defs, signatures — works even after IL stripping if metadata stream is intact.
7. **Cross-reference clusters** — functions only called by one parent are probably helpers of that parent; name accordingly.

## Anti-Patterns

- ❌ Running unknown binaries to "see what they do" — static analysis first, always.
- ❌ Trusting export names blindly — packers rename exports to mimic system DLLs.
- ❌ Assuming x86_64 — many Windows components still ship ARM64EC stubs; check `pe.ImageNtHeaders.FileHeader.Machine`.
- ❌ Allocating per-instruction objects in Iced loops — use `Decoder.Decode(out Instruction)` with stack-only `Instruction` struct.

## WinClean Integration Points

| Component | Hook |
| --- | --- |
| `aphrody-re` (`crates/os/re`) | Primary static-analysis entry point and evidence producer. |
| Kernel `admin` subsystem (`crates/os/kernel/src/admin.rs`) and `crates/os/winclean` | Typed tools such as `analyze_pe`, `binary_parse_pe_header`, `binary_entropy_map`. |
| Rust integration tests | Add deterministic fixtures for PE triage and section/strings output. |

## Rationalizations to Reject

- "I'll just use `dumpbin` output" — dumpbin produces text; we need structured streams for cross-reference graphs.
- "The exports are obviously correct" — packers + obfuscators routinely lie.
- "We can run it in a sandbox to confirm" — dynamic analysis belongs in another skill; this one is static-first.

## Further Reading

- PeNet docs: https://github.com/secana/PeNet
- Iced: https://github.com/icedland/iced
- Rust Windows APIs and kernel subsystem contracts govern this code.

## Authoring Notes

Original, Windows-PE-specific content.
