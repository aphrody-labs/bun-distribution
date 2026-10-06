# aphrody-python-ffi

C ABI that hosts the shared CPython inside `libaphrody` (plan vu D18). The libpython is the one of
the `vu` artifact, shared with the Bun fork: opened `RTLD_GLOBAL` at run time, C API bound by
`dlsym`, never linked. Rlib re-exported by the single `aphrody-ffi` cdylib.

Exports: `aphrody_py_load` (explicit path, `APHRODY_LIBPYTHON`, already-global libpython, versioned
names), `aphrody_py_init` (initialises once, or attaches when the host already did), `aphrody_py_run`,
`aphrody_py_eval`, `aphrody_py_call`, `aphrody_py_version`, `aphrody_py_finalize` (only if this crate
started the interpreter), `aphrody_py_last_error`, `aphrody_py_string_free`. Negative codes
(`APHRODY_PY_ERR_*`), panics caught at the boundary, returned strings owned by the crate.

Unix only for now (non-Unix returns `APHRODY_PY_ERR_UNSUPPORTED`). The PyO3 module stays in
`crates/ai/rag-python`. Test: `cargo nextest run -p aphrody-python-ffi` (uses the host libpython;
prints a SKIPPED reason when none).
