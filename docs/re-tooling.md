# Reverse-engineering tooling (Windows workstation)

External tools used by `bun re pipeline` adapters and manual analysis. All
entries are on the user `PATH` (new shells). Paths are the current workstation
layout; adapters resolve tools through `PATH`, never through these literals.

| Tool | Version | Channel | Binary / location |
| --- | --- | --- | --- |
| Rizin + rz-ghidra | 0.9.1 | winget `Rizin.Cutter` bundle | `rizin`, `rz-bin`, `rz-asm`, ... in `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Rizin.Cutter_*\Cutter-v2.5.0-Windows-x86_64` (`core_ghidra.dll` in `lib\rizin\plugins`) |
| Cutter | 2.5.0 | winget `Rizin.Cutter` | `cutter` (WinGet Links) |
| Rizin (standalone) | 0.9.1 | winget `Rizin.Rizin` | `C:\Program Files\Rizin\bin` (not on PATH; no rz-ghidra) |
| Ghidra | 12.1.4 | pre-installed | `ghidraRun`, `analyzeHeadless` (`%LOCALAPPDATA%\ghidra`, `...\support`) |
| JDK (Ghidra runtime) | 25.0.4 | pre-installed | `java` |
| Android SDK | pre-installed | `adb`, `sdkmanager` |
| RetDec | 5.0 | GitHub `avast/retdec` release | `retdec-decompiler` (`~\.local\opt\retdec\bin`) |
| x64dbg | 2026.05.27 | winget `x64dbg.x64dbg` | `x64dbg`, `x96dbg` |
| WinDbg | 1.2610.1001.0 | winget `Microsoft.WinDbg` | `WinDbgX`; `cdb` via `~\.local\bin\cdb.cmd` |
| Detect It Easy | 3.21 | winget `horsicq.DIE-engine` | `die`, `diec` |
| PE-bear | 0.7.2 | winget `hasherezade.PE-bear` | `PE-bear` |
| YARA | 4.5.5 | winget `VirusTotal.YARA` | `yara`, `yarac` |
| binwalk | 2.3.4 (git tag) | `bun uv tool` (+ `zombie-imp` for Python 3.12) | `binwalk.cmd` (`~\.local\bin`) |
| capa | 9.4.0 | `bun uv tool install flare-capa` | `capa` |
| angr | 10.0.4 | `bun uv tool install angr` | `angr`, `angr-mcp` |
| capstone / keystone / unicorn / lief | 5.0.7 / 0.9.2 / 2.1.4 / 1.0.0 | `--with` in the angr tool env | `%APPDATA%\uv\tools\angr\Scripts\python.exe -I` |
| Frida | pre-installed | `frida`, `frida-trace`, ... (`~\.local\bin`) |

Not installed:

- radare2: no winget package; Rizin (fork) covers the same CLI surface.
- binwalk 3 (Rust): `cargo install binwalk` does not build on Windows MSVC.
- IDA Free, Binary Ninja Free: downloads require an account or a form; install
  manually if needed.

## Use with `bun re`

```sh
bun re pipeline adapters              # lists adapters and which tools resolve
bun re pipeline <input> --target firmware --external   # enables external tools
```

Manual equivalents of the external stages:

```sh
diec -j sample.bin                     # identify format/packer
binwalk.cmd -e firmware.bin            # unpack
rizin -qc "aaa; s main; pdg" sample.exe  # rz-ghidra decompile
analyzeHeadless C:\tmp\proj p -import sample.exe -postScript ...  # Ghidra headless
retdec-decompiler sample.exe           # LLVM-based decompile
capa sample.exe                        # capability detection
yara rules.yar sample.exe
```

Python libraries run in the angr tool environment:

```sh
"%APPDATA%\uv\tools\angr\Scripts\python.exe" -I script.py
```
