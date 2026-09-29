---
name: dpapi-timing-audit
description: "Audit DPAPI/BCrypt credential-decryption code for timing side channels: non-constant MAC compare, secret-dependent branches, elided zeroize."
allowed-tools: Read, Grep, Glob, Bash
---

# DPAPI Timing Audit

Credential-handling code in Aphrody (token stores, password vaults, OAuth refresh blobs) MUST be timing-safe. This skill enforces that.

## When to Use

- Reviewing changes to `crates/aphrody-winclean` credential handlers.
- Adding new MCP tools that touch `CryptUnprotectData`, `BCryptDecrypt`, or `SecureString`.
- Implementing a new authenticated-encryption verifier in any language (C#, Rust, C++).
- After an analyzer surfaces `CA5358` / `CA5350` / similar crypto warnings.
- Before a release that touches secret-handling code paths.

## When NOT to Use

- Pure performance tuning where no secrets are involved.
- Cosmetic refactors that don't change branching or memory layout.
- Code that only handles public, non-sensitive data.

## What to Audit (Three Buckets)

### Bucket 1 — Comparison Timing

A constant-time comparison runs in time proportional to _length_, never to _value_.

- ✅ `CryptographicOperations.FixedTimeEquals(span1, span2)` (.NET 6+, AOT-safe, source-gen aware)
- ✅ `subtle::ConstantTimeEq` (Rust `subtle` crate)
- ❌ `SequenceEqual(...)` — bails on first mismatch
- ❌ `memcmp(...)` — short-circuits
- ❌ `==` on `byte[]` — reference equality, but anyone porting to `byte[].SequenceEqual` introduces the bug

Walk every comparison of MAC tags, ciphertext, password hashes, token signatures.

### Bucket 2 — Branch on Secret

The control-flow graph must not depend on secret bytes.

- ❌ `if (decryptedFlag) { ... }` where `decryptedFlag` is derived from a key byte.
- ❌ `switch (b)` where `b` is a plaintext nibble.
- ❌ Early `return` inside an unrolled padding-check loop.

Use `CMOV`-equivalent constructs: masked select. In Rust, `subtle::ConditionallySelectable`. In C#, hand-rolled bit-mask:

```csharp
// b1 if mask==0xFF else b2 — branchless
byte select = (byte)((b1 & mask) | (b2 & ~mask));
```

Iced disassembly can confirm there is no `JE/JNE` on a secret-derived register inside the inner loop.

### Bucket 3 — Zeroize Lifecycle

After use, secrets must be wiped _and the wipe must not be optimized away_.

- ✅ `CryptographicOperations.ZeroMemory(span)` — JIT/AOT guarantee.
- ✅ `Span<byte>.Clear()` followed by GC.KeepAlive on the buffer.
- ✅ Rust `zeroize::Zeroize::zeroize(&mut buf)` (NOT `buf.iter_mut().for_each(|b| *b = 0)`)
- ❌ Plain assignment loops on `stackalloc Span<byte>` — `csc.exe` AOT often removes these as dead stores.

Audit IR / disassembly: after the supposed wipe, the memory must be re-read by `mov` from `[rsp+xxx]` to a register, OR a function call must consume it. Otherwise the compiler elided it.

## Tools

| Layer  | Tool                                                                  |
| ------ | --------------------------------------------------------------------- |
| C# AOT | `ilc` IL dump; `dotnet sos`; Iced disassembly of the published binary |
| Rust   | `cargo asm --rust`, `cargo expand`, `cargo +nightly miri`             |
| C++    | `clang -S -O2 -emit-llvm` + `llc`; Compiler Explorer (godbolt)        |
| Cross  | `objdump -d`, `dumpbin /DISASM`, `IDAPython`                          |

## WinClean-Specific Checklist

When a Rust credential handler is touched:

- [ ] DPAPI blob is read into a `Span<byte>` stack buffer, never `byte[]` heap.
- [ ] Master key is wiped via `CryptographicOperations.ZeroMemory` immediately after AEAD decrypt.
- [ ] AEAD tag check uses `FixedTimeEquals`.
- [ ] Decryption result `Span<byte>` is consumed by caller and zeroed on the way out.
- [ ] No debug logging of plaintext anywhere on the path.
- [ ] No `JsonSerializer.Serialize` of any object holding plaintext.

## Rationalizations to Reject

- "Timing attacks need network access" — local privilege escalation also benefits from sub-microsecond timing leaks (see Spectre-class).
- "The AEAD library handles it" — only if you use its constant-time verifier and never roll your own.
- "The compiler will optimize it correctly" — that is precisely the failure mode; AOT compilers regularly elide secret wipes.
- "I'll add a `volatile` and call it a day" — `volatile` in C# does not prevent dead-store elimination across method boundaries.

## Authoring Notes

WinClean original skill. Patterns informed by Trail of Bits' `constant-time-analysis` and `zeroize-audit` skills (CC BY-SA 4.0, https://github.com/trailofbits/skills), but text and toolchain mapping are original.
