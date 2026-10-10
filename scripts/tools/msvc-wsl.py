#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Run authentic installed MSVC tools from WSL, translating filesystem arguments.

Install named symlinks (cl.exe, ml64.exe, lib.exe, link.exe) to this script in a
private PATH directory. MSVC_WSL_ROOT optionally overrides the toolset search
(/mnt/c/BuildTools, then Visual Studio installations). Tool messages are
transcoded to UTF-8 from the OEM (stdout, MSVC_WSL_OEM_CODEPAGE, default cp850)
and ANSI (stderr, MSVC_WSL_ANSI_CODEPAGE, default cp1252) code pages, and their
Windows paths are mapped back to Linux paths: a toolset without the English
language pack ignores VSLANG, and Linux sccache parses /showIncludes output as
UTF-8 Linux paths.
No compiler emulation or assembly fallback is used.
"""
import os
from pathlib import Path
import re
import subprocess
import sys

# First Windows path on a line: a WSL UNC share or a drive letter.
WINDOWS_PATH = re.compile(r"\\\\wsl(?:\.localhost|\$)\\[^\\]+\\|\b[A-Za-z]:\\")


def windows_path(value: str) -> str:
    return subprocess.check_output(["wslpath", "-w", os.path.abspath(value)], text=True).strip()


def linux_path(value: str) -> str:
    if value.startswith("\\\\"):
        return "/" + value.split("\\", 4)[4].replace("\\", "/")
    return f"/mnt/{value[0].lower()}/" + value[3:].replace("\\", "/")


def linux_paths(text: str) -> str:
    """Rewrite tool paths so Linux consumers (sccache /showIncludes parsing,
    Cargo diagnostics) see paths they can open."""
    lines = []
    for line in text.splitlines(keepends=True):
        match = WINDOWS_PATH.search(line)
        if match:
            head, rest = line[:match.start()], line[match.start():]
            body = rest.rstrip("\r\n")
            ending = rest[len(body):]
            located = re.match(r"(.+?)(\(\d+(?:,\d+)?\)\s?:.*)$", body)
            if located:
                body = linux_path(located.group(1)) + located.group(2)
            else:
                body = linux_path(body)
            line = head + body + ending
        lines.append(line)
    return "".join(lines)


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
    version_key = lambda path: tuple(int(part) for part in path.name.split("."))
    # An explicit root wins; otherwise the newest MSVC toolset among the
    # standalone layout and the Visual Studio installations is used.
    if "MSVC_WSL_ROOT" in os.environ:
        roots = [Path(os.environ["MSVC_WSL_ROOT"])]
    else:
        roots = [Path("/mnt/c/BuildTools")]
        for base in ("/mnt/c/Program Files/Microsoft Visual Studio",
                     "/mnt/c/Program Files (x86)/Microsoft Visual Studio"):
            roots.extend(Path(base).glob("*/*"))
    versions = sorted(
        (path for root in roots for path in (root / "VC/Tools/MSVC").glob("*")
         if path.is_dir() and all(part.isdigit() for part in path.name.split("."))),
        key=version_key,
    )
    if not versions:
        raise SystemExit(f"No authentic MSVC installation found under {', '.join(map(str, roots))}")
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
    # cl.exe writes stdout in the OEM code page and stderr in the ANSI one.
    stdout_codepage = os.environ.get("MSVC_WSL_OEM_CODEPAGE", "cp850")
    stderr_codepage = os.environ.get("MSVC_WSL_ANSI_CODEPAGE", "cp1252")
    # Preprocessor output on stdout is source text and stays byte-exact.
    preprocessing = any(argument in ("-E", "/E", "-EP", "/EP") for argument in sys.argv[1:])
    result = subprocess.run(arguments, env=env, capture_output=True)
    if preprocessing:
        sys.stdout.buffer.write(result.stdout)
    else:
        sys.stdout.buffer.write(linux_paths(result.stdout.decode(stdout_codepage, "replace")).encode())
    sys.stderr.buffer.write(linux_paths(result.stderr.decode(stderr_codepage, "replace")).encode())
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
