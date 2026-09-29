
# bun-ffi — Rust ↔ Bun FFI bridge

Build the binding layer that lets Bun call into a native Rust library and back.
The target is a Rust `cdylib` (`.so`/`.dylib`/`.dll`) whose `extern "C"` symbols
Bun loads via `bun:ffi`'s `dlopen`, plus the TypeScript wrapper that declares
each symbol's signature and converts values.

Bun's FFI is **not** generic libffi — for every symbol you declare, Bun JIT‑compiles
a bespoke C trampoline (via embedded TinyCC) that reads JS arguments directly out
of the JSC call frame, bit‑casts them to native C types, calls your symbol, and
bit‑casts the return back to a `JSValue`. That is why it's fast, and why **the
declared signature must exactly match the Rust ABI** — a mismatch is a
hard‑to‑debug crash, not a type error.

## When `bun:ffi` is the right tool

`bun:ffi` is best for **prototyping and self‑contained numeric/buffer APIs**: fast
to set up, no build step beyond `cargo build`, no codegen. Reach for **N‑API
(`napi-rs` → `.node`)** instead when you need: rich JS object graphs, async work
that integrates with the event loop, exceptions that propagate as JS errors,
production stability (Bun's docs label `bun:ffi` "experimental"), or the same
addon to also run on Node. This skill covers `bun:ffi`; for the N‑API path and a
decision matrix, point the user at the `../SKILL.md` (decision matrix). For turning the
result into a publishable, multi‑platform package, see `references/rs-to-ts.md`.

## Workflow

Follow these steps in order. Each later step depends on the ABI decisions made
earlier, so don't skip ahead.

1. **Scaffold the cdylib.** Run `scripts/scaffold.sh <name>` (or do it by hand):
   a `Cargo.toml` with `[lib] crate-type = ["cdylib"]`, a `src/lib.rs`, and a
   `bun` wrapper file. The scaffold also emits a `build.ts` that compiles the
   crate and resolves the platform library path via `suffix`.

2. **Design the C ABI surface.** Decide the `extern "C"` functions. Keep the
   boundary **flat and C‑shaped**: scalars, pointers, lengths. Do not pass Rust
   enums, `String`, `Vec`, `Option`, tuples, or `#[repr(Rust)]` structs across it
   — they have no stable layout. Read `references/bun-ffi/type-mapping.md` for the exact
   Rust ↔ `FFIType` ↔ JS table before writing any signature.

3. **Write the Rust `extern "C"` functions.** Every exported fn is
   `#[unsafe(no_mangle)] pub extern "C" fn` (on older toolchains `#[no_mangle]`)
   with only C‑ABI types. See `references/bun-ffi/patterns.md` for copy‑paste recipes:
   scalars, returning/accepting strings, passing buffers (TypedArray), structs by
   pointer, and accepting a JS callback as a function pointer.

4. **Decide ownership for every pointer that crosses the boundary.** This is
   where FFI bridges crash. For each pointer, answer in one sentence: *who
   allocated it, who frees it, with which allocator, on which side.* If Rust hands
   JS an owned allocation, you MUST also export a `free_*` function and the JS
   side must call it. `references/bun-ffi/memory-and-lifetimes.md` is the authority — read
   it whenever a pointer or string is returned, stored, or freed.

5. **Generate the TypeScript bindings.** Declare each symbol in `dlopen` with
   `args`/`returns` drawn straight from the type table. Use `suffix` for the
   filename. Wrap raw symbols in an ergonomic TS API (convert pointers→`CString`,
   `toArrayBuffer`, etc.) so callers never touch raw pointers. Template in
   `references/bun-ffi/patterns.md`.

6. **Test the round trip.** Write a `bun:test` that exercises every symbol,
   including the failure/empty/boundary cases (empty string, null pointer, 0
   length, values past 2^32 and 2^53). Build with `cargo build --release`, run
   `bun test`. A binding that "returns a number" but is off by a type is silent
   corruption — assert exact values, not just "truthy".

## The core type facts (memorize these, full table in the reference)

- **Pointers are JS `number`s**, not BigInt (Bun packs them into the 52 usable
  mantissa bits). `ptr` arg/return ↔ Rust `*const T`/`*mut T` ↔ JS `number`.
- **Passing a `TypedArray`/`DataView` to a `ptr` or `buffer` arg passes its data
  pointer directly** — zero copy, no `ptr()` call needed. The Rust side receives
  `*const u8` to the backing store. The view must outlive the call and be sized
  for alignment (`u64*` ≠ `[8]u8*` if misaligned).
- **`cstring` return coerces a `char*` to a JS string** (transcodes UTF‑8→UTF‑16,
  scans for the `\0`). As an **arg**, `cstring` is identical to `ptr`. To go the
  other way (JS string → pointer) you must encode to a `Buffer` yourself; passing
  a JS string to a pointer arg throws.
- **64‑bit ints:** `i64`/`u64` return as **BigInt**; `i64_fast`/`u64_fast` return
  a `number` when it fits in 2^53 (faster, no BigInt alloc) and BigInt otherwise.
  Pick `_fast` unless you need exact 64‑bit values in JS.
- **`bool`** matches Rust `bool` (1 byte). **`char`** is a C `char` (`i8`/`u8`),
  not a JS string char.
- **`void` return** → `undefined`. You cannot return `buffer`, `napi_env`, or
  `napi_value` to JS.

## Reading and writing native memory from JS

Once you have a pointer, read it without copying via `read.u8/i32/f64/ptr/...`
(fast, `DataView`‑like) or materialize a view with `toArrayBuffer(ptr, off, len)`
/ `toBuffer(...)`. For long‑lived data prefer a `DataView` over `toArrayBuffer`;
for one‑shot reads prefer `read.*`. To let Rust know when JS is done with a buffer
it lent out, pass a deallocator callback to `toArrayBuffer`/`toBuffer` (signature
`void (*)(void* bytes, void* ctx)`), invoked when the `ArrayBuffer` is GC'd.

## Callbacks (JS function called from Rust)

Wrap a JS function in `new JSCallback(fn, { args, returns })` and pass
`cb` (or `cb.ptr` for a small speedup) where the Rust side expects a function
pointer (`extern "C" fn` type). **Always `cb.close()` when done** (or use
`using` / `Symbol.dispose`) — the callback holds a JIT'd trampoline and a GC root
that won't free otherwise. If Rust will call the callback from **another thread**,
set `threadsafe: true`; thread‑safe callbacks **must return `void`** (the result
can't cross the thread hop) and currently work best when the foreign thread is
itself a Bun `Worker`. Recipe in `references/bun-ffi/patterns.md`.

## Common failure modes (and the fix)

- **Segfault on call** → declared `args`/`returns` don't match the Rust signature
  (wrong count, `i32` vs `i64`, missing pointer). Re‑derive from the table.
- **Garbage/huge integer in JS** → 64‑bit value declared as `i32`, or a pointer
  declared as `i64` instead of `ptr`. Pointers go through `ptr`, never `u64`.
- **String is empty or truncated** → not null‑terminated, or you returned a
  pointer to a dropped Rust `String`/`CString` (freed before JS read it). Leak it
  or return owned + provide a `free_*`.
- **Crash after a while / under load** → use‑after‑free: Rust freed memory JS
  still references, or JS GC'd a buffer Rust kept. Re‑read step 4.
- **Latin‑1 vs UTF‑8 mojibake** → JSC 8‑bit strings are Latin‑1; always go through
  `CString`/proper UTF‑8 encoding, never raw byte reinterpretation.

## Reference files

- `references/bun-ffi/type-mapping.md` — the complete Rust ↔ FFIType ↔ JS table, every
  alias, the 64‑bit/pointer/string rules, and what is NOT representable.
- `references/bun-ffi/patterns.md` — copy‑paste recipes: scalars, strings (both
  directions), buffers, structs‑by‑pointer, callbacks, the TS wrapper template,
  and the `bun:test` template.
- `references/bun-ffi/memory-and-lifetimes.md` — ownership rules, `Box::into_raw`/`free_*`
  pairs, deallocator callbacks, threadsafe‑callback lifetimes, the
  one‑sentence ownership test.

## Scripts

- `scripts/scaffold.sh <crate-name> [dir]` — generates a ready‑to‑build cdylib +
  `bun` wrapper + `build.ts` + a smoke test. Idempotent; safe to inspect first.
