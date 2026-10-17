# Machine learning

Magika is the unified file-type classifier for Bun Engine. Its source is pinned at `crates/magika`; its Rust/PyO3 core and bundled model remain owned by that fork and build in its isolated Python environment.

```powershell
re magika setup
re magika identify README.md
```

`re magika setup` builds the locked Magika Python project with `bun uv`. `re magika identify` loads that environment inside the Bun process through `bun:python`, calls the narrow JSON bridge asynchronously and lazily constructs the classifier. The host-specific `BUN_PYTHON_HOST_LIBRARY` and `BUN_PYTHON_LIBPYTHON` paths must be configured; they are never committed.

For a standalone `bun-engine` executable, set `BUN_ENGINE_HOME` to the checkout or distribution root containing `crates/magika`.
