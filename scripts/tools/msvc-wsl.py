#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Run authentic installed MSVC tools from WSL, translating filesystem arguments.

Install named symlinks (cl.exe, ml64.exe, lib.exe, link.exe) to this script in a
private PATH directory. MSVC_WSL_ROOT optionally overrides /mnt/c/BuildTools.
No compiler emulation or assembly fallback is used.
"""
import os
from pathlib import Path
import subprocess
import sys


def windows_path(value: str) -> str:
    return subprocess.check_output(["wslpath", "-w", os.path.abspath(value)], text=True).strip()


def translate(argument: str) -> str:
    for prefix in ("-out:", "/OUT:", "-Fo", "/Fo", "-I", "/I", "/LIBPATH:"):
        if argument.startswith(prefix) and len(argument) > len(prefix):
            return prefix + windows_path(argument[len(prefix):])
    if argument.startswith("@") and Path(argument[1:]).is_file():
        raise SystemExit("MSVC response files need Windows paths; expand arguments before invoking this bridge")
    if Path(argument).exists() or (argument.startswith(("/home/", "/tmp/", "/mnt/", "/var/"))):
        return windows_path(argument)
    return argument


def main() -> None:
    tool = Path(sys.argv[0]).name
    if tool not in ("cl.exe", "ml64.exe", "lib.exe", "link.exe"):
        if len(sys.argv) < 2:
            raise SystemExit("usage: msvc-wsl.py <cl.exe|ml64.exe|lib.exe|link.exe> [arguments]")
        tool = sys.argv.pop(1)
    root = Path(os.environ.get("MSVC_WSL_ROOT", "/mnt/c/BuildTools"))
    version_key = lambda path: tuple(int(part) for part in path.name.split("."))
    versions = sorted(
        (path for path in (root / "VC/Tools/MSVC").glob("*")
         if path.is_dir() and all(part.isdigit() for part in path.name.split("."))),
        key=version_key,
    )
    if not versions:
        raise SystemExit(f"No authentic MSVC installation found under {root}")
    vc = versions[-1]
    executable = vc / "bin/Hostx64/x64" / tool
    if not executable.is_file():
        executable = vc / "bin/Hostx86/x64" / tool
    if not executable.is_file():
        raise SystemExit(f"Missing authentic MSVC executable: {executable}")
    include = [vc / "include"]
    libraries = [vc / "lib/x64"]
    sdk = Path("/mnt/c/Program Files (x86)/Windows Kits/10")
    sdk_versions = sorted(
        (path for path in (sdk / "Include").glob("*")
         if path.is_dir() and all(part.isdigit() for part in path.name.split("."))),
        key=version_key,
    )
    if sdk_versions:
        version = sdk_versions[-1].name
        include.extend(sdk / "Include" / version / part for part in ("ucrt", "shared", "um", "winrt"))
        libraries.extend(sdk / "Lib" / version / part / "x64" for part in ("ucrt", "um"))
    env = dict(os.environ)
    env["INCLUDE"] = ";".join(windows_path(str(path)) for path in include if path.is_dir())
    env["LIB"] = ";".join(windows_path(str(path)) for path in libraries if path.is_dir())
    env.setdefault("VSLANG", "1033")
    env["WSLENV"] = ":".join(filter(None, [env.get("WSLENV", ""), "INCLUDE", "LIB", "VSLANG"]))
    arguments = [str(executable)] + [translate(argument) for argument in sys.argv[1:]]
    os.execve(executable, arguments, env)


if __name__ == "__main__":
    main()
