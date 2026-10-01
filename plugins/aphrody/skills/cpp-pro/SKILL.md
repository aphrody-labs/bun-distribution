---
name: cpp-pro
description: "Modern C++ (C++20/23, C++26 aware): RAII, smart pointers, move semantics, concepts, templates, ranges, concurrency, CMake, sanitizers, tests and benchmarks. Use when writing, reviewing, debugging or modernising C++ code or CMake projects."
version: "1.1.0"
metadata:
  source: community
---

# Modern C++

## Before writing code

- Detect the language level and toolchain: `CMAKE_CXX_STANDARD` / `target_compile_features`
  in `CMakeLists.txt`, `-std=` flags, `compile_commands.json`, `.clang-format`, `.clang-tidy`,
  and the compilers CI uses. Do not use a feature the project's standard or minimum compiler
  lacks (check cppreference's compiler support tables for C++23/26 library features).
- Follow the project's existing error model (exceptions vs `std::expected`/error codes),
  naming and header layout.

## Approach

1. Stack allocation and RAII first; `std::unique_ptr` for ownership, `std::shared_ptr` only
   for genuinely shared lifetime; no owning raw pointers.
2. Rule of Zero; when a type manages a resource, Rule of Five.
3. `const` correctness, `constexpr`/`consteval` where values are compile-time.
4. Constrain templates with concepts instead of SFINAE; prefer ranges/algorithms to raw loops
   when clearer.
5. `std::span` / `std::string_view` for non-owning views (never store them past the owner).
6. Concurrency through `std::jthread`, `std::stop_token`, atomics with explicit memory
   orders only when measured, otherwise mutexes.
7. Measure before optimising (`perf`, VTune, Tracy, Google Benchmark).

## Output expectations

- Compiles warning-free at `-Wall -Wextra -Wpedantic` (MSVC `/W4 /permissive-`).
- CMake: target-based (`target_link_libraries`, `target_compile_features(... cxx_std_23)`),
  no global `include_directories`/`add_definitions`.
- Headers with `#pragma once`; tests in GoogleTest or Catch2; benchmarks in Google Benchmark.
- Clean under AddressSanitizer + UndefinedBehaviorSanitizer, and ThreadSanitizer for
  concurrent code.
- Follow the C++ Core Guidelines; prefer compile-time errors over runtime checks.

## References (read the one that matches the task)

| File | Covers |
| --- | --- |
| `references/modern-cpp.md` | C++20/23 features: concepts, ranges, coroutines, spaceship, designated initializers, modules, constexpr, `std::format`; feature table incl. `std::expected`/`std::print` |
| `references/templates.md` | variadic templates, CRTP, type traits, metaprogramming |
| `references/memory-performance.md` | smart pointers, custom allocators and pools, move semantics, RVO, SIMD, cache-friendly layout, alignment |
| `references/concurrency.md` | atomics and memory ordering, lock-free structures, thread pools, parallel STL, futures, coroutine concurrency |
| `references/build-tooling.md` | modern CMake, sanitizers, static analysis, Catch2/GoogleTest, profiling, Conan, GitHub Actions CI |
| `resources/implementation-playbook.md` | end-to-end implementation checklist with examples |

## Related skills

- Calling C++ from Bun or Rust: `rust-bun` (its FFI type and ownership rules apply to any C ABI).
- Shell tooling for builds and scripts: `cross-platform-cli-toolbelt`.

## Limitations

Not a substitute for building and testing in the real toolchain. Ask when required inputs
(target platforms, standard level, error model) are missing.
