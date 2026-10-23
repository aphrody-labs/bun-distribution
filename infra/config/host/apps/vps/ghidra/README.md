# Continuous headless Ghidra RE (VPS)

`ghidra_re.py` drives Ghidra 12.1.4 through PyGhidra. It analyzes every target of
`targets.json` by SHA-256, exports the results, then rescans every `RE_POLL_SECONDS`. A Steam
update of a target produces a new SHA-256 and therefore a fresh analysis; earlier builds
keep their exports.

| Path (`RE_WORK=/home/ubuntu/re/ghidra`)           | Content                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `projects/<stem>-<sha12>.gpr`                     | Ghidra project, saved after auto-analysis (open it in the GUI)               |
| `out/<stem>-<sha12>/functions.csv`                | `vaddr,name,source,size,params,cc`, the input of `crates/re` `ghidra_import` |
| `out/.../functions.jsonl`                         | signature, namespace, thunk target and callees per function                  |
| `out/.../calls.tsv`, `strings.tsv`, `imports.tsv` | call graph, defined strings, external symbols                                |
| `out/.../decomp.jsonl`                            | decompiled C per function (resumable)                                        |
| `out/.../meta.json`, `state.json`                 | phase timings, counts, per-SHA status and errors                             |

Every phase is resumable: a restart continues at the first unfinished phase, and decompilation
skips functions already in `decomp.jsonl`. Stale project locks from a killed run are cleared at
startup; a target that fails `RE_MAX_ATTEMPTS` (3) times is skipped until its state entry is reset.

## Run

Docker (needs about 1 GB free on the Docker root):

```sh
./up.sh            # fetch + verify Ghidra into /home/ubuntu/re/opt, build, start
./up.sh status     # per-target phases and export sizes
./up.sh logs
```

Host systemd unit (same worker, nothing written outside `/home`):

```sh
./up.sh status     # first run also fetches Ghidra
./run-host.sh      # transient user unit bun-ghidra-re: 4 CPUs, 16 GiB, nice 10
./run-host.sh logs
```

Both run at most four decompiler processes (one factory lane) with a 12 GiB JVM heap.
Targets: IEVR `nie.exe` and `GameBootstrapper.exe`, DBXV2 `DBXV2.exe` with its engine
libraries `xgcore.dll` and `render_pass_x64.dll`. Add other binaries under
`/home/ubuntu/re/targets/`; EasyAntiCheat and the EOS installer are excluded.

## Workstation

Ghidra 12.1.4 lives in `%LOCALAPPDATA%\ghidra` with `GHIDRA_INSTALL_DIR` set and
`ghidra`, `ghidra-headless`, `pyghidra` and `pyghidra-python` in `~\.local\bin`. The
PyGhidra venv is `%LOCALAPPDATA%\ghidra-pyghidra`, installed from the wheels bundled with
the release. `pyghidra-python ghidra_re.py analyze <file>` runs the same pipeline locally.
