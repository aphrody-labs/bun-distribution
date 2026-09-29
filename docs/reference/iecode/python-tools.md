# Inazuma Python tools

The repository has one root `pyproject.toml` and one `uv.lock`. The six Python
trees are UV workspace members; dependency resolution and lint/test entrypoints
are owned by the root so the environments cannot drift.

`Buscador-Inazuma` also requires the host's Tk installation. `IEStrikers`
still requires its native decompilation toolchain and an external `ppcdis`
checkout. The shared shell profiles set `PPCDIS_ROOT` to the user-scoped
toolchain location; neither a submodule nor a vendored checkout is used.

Run the commands from the IECODE checkout root (Windows or WSL). The lockfile can be checked without
installing anything with `uv lock --check`.

```sh
uv lock --check
./scripts/lint-python.sh
./scripts/test-python.sh
```

The absorption audit and machine-readable capability inventory live in
[`IECODE_EMU_ADAPTERS.md`](./IECODE_EMU_ADAPTERS.md) and
[`iecode-emu-adapters.json`](./iecode-emu-adapters.json). They define the small
in-process/FFI seam that the `iecode-emu` implementation absorbs without
making these historical scripts runtime dependencies. See
[`iecode-emu-interface.json`](./iecode-emu-interface.json),
[`iecode-emu-migration.json`](./iecode-emu-migration.json), and
[`iecode-emu-adapter.h`](./iecode-emu-adapter.h).
