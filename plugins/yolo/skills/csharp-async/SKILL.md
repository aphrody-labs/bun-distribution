---
name: csharp-async
description: "C#/.NET async/await: Task vs ValueTask, cancellation, ConfigureAwait, sync-over-async deadlocks, async void, WhenAll/WhenEach, Parallel.ForEachAsync, IAsyncEnumerable, Channels. Use when writing, reviewing or debugging async C#."
version: "1.1.0"
---

# C# async programming

Apply these when writing or reviewing async C#. Check the project's target framework
(`<TargetFramework>` in the `.csproj`) before using newer APIs; the ones marked with a version
need at least that .NET.

## Naming and signatures

- Suffix async methods with `Async` (`GetDataAsync` next to `GetData`); omit it only where a
  framework convention says otherwise (ASP.NET Core controller actions, event handlers).
- Return `Task<T>` / `Task`; `async void` only for event handlers.
- Accept a `CancellationToken cancellationToken = default` as the last parameter of public
  async APIs and pass it to every awaited call.
- `ValueTask<T>` only for hot paths that usually complete synchronously; await a `ValueTask`
  exactly once and never block on it (call `.AsTask()` if it must be stored or awaited twice).

## Correctness

- Never block on async work: no `.Result`, `.Wait()`, `.GetAwaiter().GetResult()` in code that
  can run on a synchronization context or the thread pool (deadlocks, thread-pool starvation).
  Go async all the way up; at a true sync entry point use `async Task Main`.
- In library code use `ConfigureAwait(false)`; in app code (ASP.NET Core has no
  synchronization context, UI apps do) leave it off where the continuation needs the UI thread.
- Always await, or deliberately store, returned tasks; a fire-and-forget task loses its
  exceptions. If fire-and-forget is required, wrap it with logging of failures.
- In `async` methods just `throw`; use `Task.FromException` only in non-async Task-returning
  methods. Elide `async`/`await` for pure pass-through only when no `using`/`try` surrounds it.
- Dispose async resources with `await using` (`IAsyncDisposable`).

## Composition and throughput

- Independent operations: start them, then `await Task.WhenAll(...)`. Inspect each task for
  all exceptions; `await` rethrows only the first.
- First to finish / timeouts: `Task.WhenAny`, or `task.WaitAsync(TimeSpan, ct)` (.NET 6+);
  process results as they complete with `Task.WhenEach` (.NET 9+).
- Bounded parallel I/O: `Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = n, CancellationToken = ct }, ...)` (.NET 6+) or a `SemaphoreSlim`.
- Producer/consumer: `System.Threading.Channels` (bounded channels for back-pressure).
- Streams: `IAsyncEnumerable<T>` with `await foreach`, `[EnumeratorCancellation]` on the
  token parameter, `.WithCancellation(ct)` at the call site.
- CPU-bound work: `Task.Run` at the caller (UI/event boundary), not inside library methods.
- Use `TimeProvider` (.NET 8+) for delays and timers that tests need to control.

## Review checklist

Flag: blocking calls on tasks, `async void` outside event handlers, missing or ignored
`CancellationToken`, un-awaited tasks, `ValueTask` awaited twice, `Task.Run` wrapping I/O,
locks held across `await` (use `SemaphoreSlim.WaitAsync`), and `async` lambdas passed to
APIs that expect `Action` (they become `async void`).

For current API details use the `docs` skill (Microsoft Learn).
