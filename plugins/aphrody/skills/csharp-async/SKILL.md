---
name: csharp-async
description: "C# async/await best practices."
---

# C# Async Programming Best Practices

Your goal is to help me follow best practices for asynchronous programming in C#.

## Naming Conventions

- Use the 'Async' suffix for all async methods
- Match method names with their synchronous counterparts when applicable (e.g., `GetDataAsync()` for `GetData()`)

## Return Types

- Return `Task<T>` when the method returns a value
- Return `Task` when the method doesn't return a value
- Consider `ValueTask<T>` for high-performance scenarios to reduce allocations
- Avoid returning `void` for async methods except for event handlers

## Exception Handling

- Use try/catch blocks around await expressions
- Avoid swallowing exceptions in async methods
- Use `ConfigureAwait(false)` when appropriate to prevent deadlocks in library code
- In `async` methods, just `throw`: the exception is stored in the returned task. Use `Task.FromException()` only in non-`async` Task-returning methods

## Performance

- Use `Task.WhenAll()` for parallel execution of multiple tasks
- Use `Task.WhenAny()` for implementing timeouts or taking the first completed task
- Avoid unnecessary async/await when simply passing through task results
- Consider cancellation tokens for long-running operations

## Common Pitfalls

- Never use `.Wait()`, `.Result`, or `.GetAwaiter().GetResult()` in async code
- Avoid mixing blocking and async code
- Don't create async void methods (except for event handlers)
- Always await Task-returning methods

## Implementation Patterns

- Implement the async command pattern for long-running operations
- Use async streams (IAsyncEnumerable<T>) for processing sequences asynchronously
- Consider the task-based asynchronous pattern (TAP) for public APIs

When reviewing my C# code, identify these issues and suggest improvements that follow these best practices.

## WinClean Integration Rules (Antigravity/Gemini Compatible)

- **Strict Environment**: Must operate within the Windows 11 (24H2+) context.
- **Package Management Enforcement**: NEVER use `node`, `npm`, `npx`, `pnpm`, or `yarn`. ALWAYS use `bun` and `bunx` for package management and local scripts. For globally installed tools (turbo, oxlint, oxfmt, skills): ALWAYS use bare direct commands (`turbo`, `oxlint`, `oxfmt`, `skills find/add ...`). NEVER `bunx turbo`, `bunx skills@latest` etc. See `plugins/aphrody/skills/_shared/winclean-rules.md`. Use `winget`, `gh`, `uv`/`uvx`, `cargo`, `nuget`, `vcpkg` as appropriate.
- **Performance First**: Zero unnecessary allocations. Use streaming operations where possible.
- **Language Policy**: Always reply in **French**, but code, variables, and commits must be in **English**.
