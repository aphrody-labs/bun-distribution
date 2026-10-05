<!-- SPDX-License-Identifier: Apache-2.0 -->
# Linux runtime contract

Linux is the supported development and release platform. Workspace CI uses
Ubuntu and CPython 3.12; isolated SDK wheels are checked on Ubuntu with
CPython 3.11, 3.12, 3.13 and 3.14. macOS and Windows are outside qualification.
The wheel gate checks the Linux native ABI, source-archive rebuild, licenses,
installed imports and native functions. Compatibility helpers for old consumers
are retained without creating release obligations on other operating systems.

Native tools are resolved from explicit configuration, executable names on PATH,
and executable files under `$APHRODY_HOME/bin` (default `~/.aphrody/bin`).
Legacy Linux runtime directories remain fallback paths. No .exe or Windows
Release directory is a default Linux runtime.

- `APHRODY_LLAMA_SERVER_BIN`: llama-server executable.
- `APHRODY_LLAMA_CLI_BIN`: llama-cli executable.
- `APHRODY_WHISPER_CPP_BIN`: whisper-cli executable.
- `APHRODY_GOOGLE_BIN`: native aphrody-google executable.

Constructors also accept explicit runtime paths. A configured llama/Whisper
runtime that is missing or lacks executable permission fails with its variable
name, rather than silently selecting another runtime. The Google launcher only
selects executable files. No model or runtime is downloaded by discovery.

Authentication uses the agy OAuth file, the Rust login file under
`$XDG_CONFIG_HOME/aphrody`, and the existing private token store. Tokens remain
private, with owner-only file permissions; no Windows credential store is
required on Linux.

Run `python tools/packaging/modernize_workspace.py check`.
For an isolated Linux SDK version, run `python tools/packaging/modernize_workspace.py
linux-sdk --python 3.11` (also accepts 3.12, 3.13 and 3.14).
Run `providers` separately for the pinned private Antigravity contract.
CUDA, model inference, Blender and live cloud workflows require their actual
Linux runtimes and fixtures. Skipped tests are not integration qualification.
