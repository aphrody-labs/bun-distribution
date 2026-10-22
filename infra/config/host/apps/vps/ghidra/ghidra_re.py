#!/usr/bin/env python3
"""Continuous headless Ghidra reverse engineering through PyGhidra.

    ghidra_re.py analyze <binary> [--force]   one target, then exit
    ghidra_re.py loop                         watch targets.json forever

Each target is identified by its SHA-256. Its Ghidra project and exports live under
``$RE_WORK/projects`` and ``$RE_WORK/out/<stem>-<sha12>/``; a new Steam build of the same
file therefore gets a fresh analysis while the previous one stays intact.

Exports (all resumable; an interrupted run continues where it stopped):

    functions.csv   vaddr,name,source,size,params,cc  (input of crates/re ghidra_import)
    functions.jsonl one record per function: signature, namespace, thunk, callees
    calls.tsv       caller_entry  callee_entry
    strings.tsv     address  length  escaped value
    imports.tsv     library  symbol  address
    decomp.jsonl    decompiled C, one record per function
    meta.json       binary identity, Ghidra version, phase timings and counts
"""

from __future__ import annotations

import argparse
import concurrent.futures
import fnmatch
import glob
import hashlib
import json
import os
import sys
import threading
import time
import traceback
from pathlib import Path

WORK = Path(os.environ.get("RE_WORK", "/work"))
TARGETS = Path(os.environ.get("RE_TARGETS", Path(__file__).with_name("targets.json")))
DECOMP_JOBS = int(os.environ.get("RE_DECOMP_JOBS", "4"))
DECOMP_TIMEOUT = int(os.environ.get("RE_DECOMP_TIMEOUT", "120"))
JVM_MAX_HEAP = os.environ.get("RE_JVM_MAX_HEAP", "12g")
POLL_SECONDS = int(os.environ.get("RE_POLL_SECONDS", "600"))
MAX_ATTEMPTS = int(os.environ.get("RE_MAX_ATTEMPTS", "3"))
# Sharding lets several worker processes run in parallel over disjoint targets: lane RE_SHARD
# of RE_SHARDS only handles targets whose position in the resolved list is RE_SHARD mod RE_SHARDS.
# Every lane shares the same state.json, projects/ and out/, each target owned by exactly one lane.
SHARDS = max(1, int(os.environ.get("RE_SHARDS", "1")))
SHARD = int(os.environ.get("RE_SHARD", "0")) % SHARDS

# Each lane keeps its own state file so parallel lanes never clobber one shared JSON.
STATE = WORK / ("state.json" if SHARDS == 1 else f"state.{SHARD}.json")


def log(*parts: object) -> None:
    print(time.strftime("%Y-%m-%dT%H:%M:%S"), *parts, flush=True)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def write_json(path: Path, value) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True))
    tmp.replace(path)


def clean(text: str) -> str:
    return text.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


# --------------------------------------------------------------------------- Ghidra session


_started = False


def start_ghidra() -> None:
    global _started
    if _started:
        return
    import pyghidra

    launcher = pyghidra.HeadlessPyGhidraLauncher()
    tmp = WORK / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    launcher.add_vmargs(f"-Xmx{JVM_MAX_HEAP}", "-XX:+UseG1GC", f"-Djava.io.tmpdir={tmp}")
    launcher.start()
    _started = True


def open_program(binary: Path, out: Path):
    """Import ``binary`` into a per-SHA project, or reopen the saved program."""
    from ghidra.base.project import GhidraProject
    from ghidra.framework.model import ProjectLocator
    from java.io import File

    location = WORK / "projects"
    location.mkdir(parents=True, exist_ok=True)
    name = out.name
    if ProjectLocator(str(location), name).exists():
        project = GhidraProject.openProject(str(location), name, True)
    else:
        project = GhidraProject.createProject(str(location), name, False)
    program = None
    if project.getRootFolder().getFile(binary.name):
        program = project.openProgram("/", binary.name, False)
    if program is None:
        program = project.importProgram(File(str(binary)))
        if program is None:
            project.close()
            raise RuntimeError(f"Ghidra could not import {binary}")
        project.saveAs(program, "/", binary.name, True)
    return project, program


def auto_analyze(project, program) -> bool:
    from ghidra.app.script import GhidraScriptUtil
    from ghidra.program.flatapi import FlatProgramAPI
    from ghidra.program.util import GhidraProgramUtilities

    if not GhidraProgramUtilities.shouldAskToAnalyze(program):
        return False
    GhidraScriptUtil.acquireBundleHostReference()
    try:
        FlatProgramAPI(program).analyzeAll(program)
        GhidraProgramUtilities.markProgramAnalyzed(program)
    finally:
        GhidraScriptUtil.releaseBundleHostReference()
    project.save(program)
    return True


# --------------------------------------------------------------------------- exports


def export_functions(program, out: Path) -> int:
    from ghidra.util.task import TaskMonitor

    monitor = TaskMonitor.DUMMY
    fm = program.getFunctionManager()
    n = 0
    with (
        (out / "functions.csv.tmp").open("w") as csv,
        (out / "functions.jsonl.tmp").open("w") as jsonl,
        (out / "calls.tsv.tmp").open("w") as calls,
    ):
        csv.write("vaddr,name,source,size,params,cc\n")
        for fn in fm.getFunctions(True):
            entry = fn.getEntryPoint()
            ea = f"0x{entry.getOffset():x}"
            name = fn.getName()
            source = str(fn.getSymbol().getSource())
            size = fn.getBody().getNumAddresses()
            params = fn.getParameterCount()
            cc = fn.getCallingConventionName() or ""
            csv.write(f"{ea},{name.replace(',', ';')},{source},{size},{params},{cc.replace(',', ';')}\n")
            callees = sorted(f"0x{c.getEntryPoint().getOffset():x}" for c in fn.getCalledFunctions(monitor))
            for callee in callees:
                calls.write(f"{ea}\t{callee}\n")
            ns = fn.getParentNamespace()
            thunked = fn.getThunkedFunction(False) if fn.isThunk() else None
            jsonl.write(
                json.dumps(
                    {
                        "ea": ea,
                        "name": name,
                        "source": source,
                        "namespace": None if ns.isGlobal() else ns.getName(True),
                        "signature": str(fn.getPrototypeString(False, False)),
                        "size": size,
                        "params": params,
                        "cc": cc,
                        "thunk_of": f"0x{thunked.getEntryPoint().getOffset():x}" if thunked else None,
                        "external": fn.isExternal(),
                        "callees": callees,
                    }
                )
                + "\n"
            )
            n += 1
    for stem in ("functions.csv", "functions.jsonl", "calls.tsv"):
        (out / f"{stem}.tmp").replace(out / stem)
    return n


def export_strings(program, out: Path) -> int:
    from ghidra.program.util import DefinedStringIterator

    n = 0
    with (out / "strings.tsv.tmp").open("w") as f:
        for data in DefinedStringIterator.forProgram(program):
            value = data.getValue()
            if value is None:
                continue
            f.write(f"0x{data.getAddress().getOffset():x}\t{data.getLength()}\t{clean(str(value))}\n")
            n += 1
    (out / "strings.tsv.tmp").replace(out / "strings.tsv")
    return n


def export_imports(program, out: Path) -> int:
    n = 0
    with (out / "imports.tsv.tmp").open("w") as f:
        for sym in program.getSymbolTable().getExternalSymbols():
            loc = program.getExternalManager().getExternalLocation(sym)
            lib = loc.getLibraryName() if loc else ""
            f.write(f"{lib}\t{sym.getName()}\t{sym.getAddress()}\n")
            n += 1
    (out / "imports.tsv.tmp").replace(out / "imports.tsv")
    return n


# Byte sequences whose presence identifies an algorithm (table starts and initial values, as
# stored little-endian in an x86-64 image).
CRYPTO_TABLES = [
    ("AES S-box", "637c777bf26b6fc53001672bfed7ab76"),
    ("AES inverse S-box", "52096ad53036a538bf40a39e81f3d7fb"),
    ("AES Te0", "a56363c6847c7cf8"),
    ("AES Td0", "50a7f4515365417e"),
    ("SHA-256 K", "982f8a4291443771cffbc0b5a5dbb5e9"),
    ("SHA-256 init", "67e6096a85ae67bb72f36e3c3af54fa5"),
    ("SHA-512 K", "22ae28d7982f8a42cd65ef2391443771"),
    ("MD5/SHA-1 init", "0123456789abcdeffedcba9876543210"),
    ("MD5 T", "78a46ad756b7c7e8db702024eecebdc1"),
    ("CRC-32 table", "0000000096300777"),
    ("CRC-32C table", "0000000003836bf2"),
    ("Blowfish P-array", "886a3f24d308a385"),
    ("Camellia sigma", "8b90cc3b7f669ea0"),
    ("Keccak round constants", "01000000000000008280000000000000"),
    ("ChaCha/Salsa sigma", b"expand 32-byte k".hex()),
    ("Base64 alphabet", b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".hex()),
]

# 32-bit immediates checked against the decoded instruction operands.
CRYPTO_IMMEDIATES = [
    ("TEA/XTEA delta", 0x9E3779B9),
    ("TEA delta (negated)", 0x61C88647),
    ("RC5/RC6 P32", 0xB7E15163),
    ("CRC-32 polynomial", 0xEDB88320),
    ("CRC-32C polynomial", 0x82F63B78),
    ("xxHash32 prime 2", 0x85EBCA77),
    ("MurmurHash3 c1", 0xCC9E2D51),
    ("FNV-1 32 offset", 0x811C9DC5),
    ("FNV 32 prime", 0x01000193),
    ("CRI CPK XOR key", 0x1717E18E),
]

CRYPTO_NAME = r"crypt|cipher|aes|rijndael|\brsa|sha-?(1|2|256|384|512|3)|md5|hmac|blowfish|twofish|chacha|salsa|xtea|\btea\b|rc4|arc4|ecdsa|ecdh|ed25519|x25519|pbkdf|hkdf|\bgcm\b|cryptopp|bcrypt|obfusc|scramble"
CRYPTO_HITS_PER_SIGNATURE = 500


def export_crypto(program, out: Path) -> dict:
    """Locate cryptographic code: constant tables, magic immediates, names and strings.

    Every hit is resolved to the functions that contain or reference it, and functions are
    ranked by how many independent indications point at them. ``crypto.json`` keeps every
    hit; ``crypto_functions.tsv`` is the ranked list to read alongside ``decomp.jsonl``.
    """
    import re

    import jpype
    from ghidra.program.util import DefinedStringIterator
    from ghidra.util.task import TaskMonitor

    monitor = TaskMonitor.DUMMY
    memory = program.getMemory()
    listing = program.getListing()
    refs = program.getReferenceManager()
    fm = program.getFunctionManager()
    name_re = re.compile(CRYPTO_NAME, re.IGNORECASE)
    functions: dict[str, dict] = {}

    def credit(fn, reason: str) -> dict | None:
        if fn is None:
            return None
        ea = f"0x{fn.getEntryPoint().getOffset():x}"
        rec = functions.setdefault(
            ea, {"ea": ea, "name": fn.getName(), "namespace": fn.getParentNamespace().getName(True), "reasons": []}
        )
        if reason not in rec["reasons"]:
            rec["reasons"].append(reason)
        return {"ea": ea, "name": fn.getName()}

    def find_all(needle: bytes, executable_only: bool):
        pattern = jpype.JArray(jpype.JByte)(needle)
        for block in memory.getBlocks():
            if not block.isInitialized() or (executable_only and not block.isExecute()):
                continue
            addr, end = block.getStart(), block.getEnd()
            while addr is not None and addr.compareTo(end) <= 0:
                hit = memory.findBytes(addr, end, pattern, None, True, monitor)
                if hit is None:
                    break
                yield hit
                addr = hit.add(1)

    constants = []
    for label, hexdata in CRYPTO_TABLES:
        for i, hit in enumerate(find_all(bytes.fromhex(hexdata), False)):
            if i >= CRYPTO_HITS_PER_SIGNATURE:
                break
            users = [credit(fn, f"table:{label}") for fn in {fm.getFunctionContaining(r.getFromAddress()) for r in refs.getReferencesTo(hit)}]
            inside = credit(fm.getFunctionContaining(hit), f"table:{label}")
            constants.append(
                {"kind": "table", "label": label, "address": str(hit), "functions": [u for u in users + [inside] if u]}
            )

    for label, value in CRYPTO_IMMEDIATES:
        seen = 0
        for hit in find_all(value.to_bytes(4, "little"), True):
            insn = listing.getInstructionContaining(hit)
            if insn is None or not any(
                (s := insn.getScalar(op)) is not None and (s.getUnsignedValue() & 0xFFFFFFFF) == value
                for op in range(insn.getNumOperands())
            ):
                continue
            fn = credit(fm.getFunctionContaining(hit), f"immediate:{label}")
            constants.append(
                {"kind": "immediate", "label": label, "address": str(insn.getAddress()), "functions": [fn] if fn else []}
            )
            seen += 1
            if seen >= CRYPTO_HITS_PER_SIGNATURE:
                break

    for fn in fm.getFunctions(True):
        qualified = fn.getName(True)
        if name_re.search(qualified):
            credit(fn, "name")

    strings = []
    for data in DefinedStringIterator.forProgram(program):
        value = data.getValue()
        if value is None or not name_re.search(str(value)):
            continue
        users = [credit(fm.getFunctionContaining(r.getFromAddress()), "string") for r in refs.getReferencesTo(data.getAddress())]
        strings.append({"address": str(data.getAddress()), "value": str(value)[:300], "functions": [u for u in users if u]})

    ranked = sorted(functions.values(), key=lambda r: (-len(r["reasons"]), r["ea"]))
    write_json(out / "crypto.json", {"constants": constants, "strings": strings, "functions": ranked})
    with (out / "crypto_functions.tsv.tmp").open("w") as f:
        f.write("ea\tname\tnamespace\tscore\treasons\n")
        for r in ranked:
            f.write(f"{r['ea']}\t{r['name']}\t{r['namespace']}\t{len(r['reasons'])}\t{';'.join(r['reasons'])}\n")
    (out / "crypto_functions.tsv.tmp").replace(out / "crypto_functions.tsv")
    labels = sorted({c["label"] for c in constants})
    return {"constants": len(constants), "strings": len(strings), "functions": len(ranked), "algorithms": labels}



def export_decompilation(program, out: Path) -> dict:
    """Decompile every non-external function with ``DECOMP_JOBS`` decompiler processes.

    Each worker thread owns its ``DecompInterface`` (one native decompiler process). JPype
    releases the GIL during Java calls, so the decompilers run in parallel. Records already
    in ``decomp.jsonl`` are skipped, which makes the phase resumable.
    """
    from ghidra.app.decompiler import DecompInterface, DecompileOptions
    from ghidra.util.task import ConsoleTaskMonitor

    path = out / "decomp.jsonl"
    done: set[str] = set()
    if path.exists():
        with path.open() as f:
            for line in f:
                try:
                    done.add(json.loads(line)["ea"])
                except (ValueError, KeyError):
                    pass  # torn last line of an interrupted run
    todo = [
        fn
        for fn in program.getFunctionManager().getFunctions(True)
        if not fn.isExternal() and f"0x{fn.getEntryPoint().getOffset():x}" not in done
    ]
    log(f"decompile: {len(done)} done, {len(todo)} remaining, {DECOMP_JOBS} jobs")

    local = threading.local()
    lock = threading.Lock()
    stats = {"ok": 0, "failed": 0}

    def decompiler():
        if not hasattr(local, "ifc"):
            ifc = DecompInterface()
            ifc.setOptions(DecompileOptions())
            ifc.toggleCCode(True)
            ifc.toggleSyntaxTree(False)
            ifc.setSimplificationStyle("decompile")
            if not ifc.openProgram(program):
                raise RuntimeError(f"decompiler: {ifc.getLastMessage()}")
            local.ifc = ifc
            local.monitor = ConsoleTaskMonitor()
        return local.ifc, local.monitor

    def one(fn) -> dict:
        ifc, monitor = decompiler()
        ea = f"0x{fn.getEntryPoint().getOffset():x}"
        try:
            res = ifc.decompileFunction(fn, DECOMP_TIMEOUT, monitor)
            if res is not None and res.decompileCompleted():
                return {"ea": ea, "name": fn.getName(), "ok": True, "c": str(res.getDecompiledFunction().getC())}
            msg = res.getErrorMessage() if res is not None else "no result"
            return {"ea": ea, "name": fn.getName(), "ok": False, "error": str(msg).strip()}
        except Exception as e:  # a single bad function must not stop the run
            return {"ea": ea, "name": fn.getName(), "ok": False, "error": repr(e)}

    started = time.monotonic()
    with path.open("a") as f, concurrent.futures.ThreadPoolExecutor(DECOMP_JOBS) as pool:
        for i, rec in enumerate(pool.map(one, todo, chunksize=64), 1):
            with lock:
                f.write(json.dumps(rec) + "\n")
                stats["ok" if rec["ok"] else "failed"] += 1
            if i % 2000 == 0:
                f.flush()
                rate = i / max(time.monotonic() - started, 1)
                log(f"decompile: {i}/{len(todo)} ({rate:.1f} fn/s, eta {(len(todo) - i) / rate / 3600:.1f} h)")
    stats["skipped_already_done"] = len(done)
    return stats


# --------------------------------------------------------------------------- orchestration


def analyze(binary: Path, force: bool = False) -> dict:
    binary = binary.resolve()
    digest = sha256(binary)
    out = WORK / "out" / f"{binary.stem}-{digest[:12]}"
    out.mkdir(parents=True, exist_ok=True)
    meta_path = out / "meta.json"
    meta = load_json(meta_path, {})
    if meta.get("complete") and not force:
        log(f"{binary.name}: already complete ({out})")
        return meta
    meta.update({"binary": str(binary), "name": binary.name, "sha256": digest, "size": binary.stat().st_size})
    meta.setdefault("phases", {})

    def phase(name: str, fn):
        if meta["phases"].get(name, {}).get("done") and not force:
            return
        log(f"{binary.name}: {name} ...")
        t = time.monotonic()
        result = fn()
        meta["phases"][name] = {"done": True, "seconds": round(time.monotonic() - t, 1), "result": result}
        write_json(meta_path, meta)
        log(f"{binary.name}: {name} done in {meta['phases'][name]['seconds']} s -> {result}")

    start_ghidra()
    from ghidra.framework import Application

    meta["ghidra"] = str(Application.getApplicationVersion())
    write_json(meta_path, meta)
    project, program = open_program(binary, out)
    try:
        meta["language"] = str(program.getLanguageID())
        meta["image_base"] = f"0x{program.getImageBase().getOffset():x}"
        phase("analysis", lambda: {"ran": auto_analyze(project, program)})
        phase("functions", lambda: {"functions": export_functions(program, out)})
        phase("strings", lambda: {"strings": export_strings(program, out)})
        phase("imports", lambda: {"imports": export_imports(program, out)})
        phase("crypto", lambda: export_crypto(program, out))
        phase("decompile", lambda: export_decompilation(program, out))
        meta["complete"] = True
        meta["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        write_json(meta_path, meta)
    finally:
        project.close()
    return meta


def resolve_targets(all_shards: bool = False) -> list[Path]:
    config = load_json(TARGETS, {"targets": []})
    exclude = config.get("exclude", [])
    seen: list[Path] = []
    for pattern in config["targets"]:
        for match in sorted(glob.glob(pattern, recursive=True)):
            p = Path(match)
            if p.is_file() and p not in seen and not any(fnmatch.fnmatch(str(p), x) for x in exclude):
                seen.append(p)
    if all_shards or SHARDS == 1:
        return seen
    # This lane owns the targets at list positions congruent to its shard: a stable split
    # that stays put as long as the resolved order does, so each binary has one owner.
    return [p for i, p in enumerate(seen) if i % SHARDS == SHARD]


def loop() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    out_name = {f"{p.stem}-{sha256(p)[:12]}" for p in resolve_targets()}
    # A lock left by a killed run is stale, but with parallel lanes another lane may hold a
    # live lock: only clear locks for projects this lane owns.
    for lock in (WORK / "projects").glob("*.lock*"):
        if lock.name.split(".lock")[0] in out_name:
            log(f"removing stale project lock {lock.name}")
            lock.unlink()
    state = load_json(STATE, {})
    for entry in state.values():
        if entry.get("status") == "running":
            entry["status"] = "interrupted"
    write_json(STATE, state)
    hashes: dict[str, tuple[float, int, str]] = {}
    while True:
        state = load_json(STATE, {})
        pending = None
        for target in resolve_targets():
            st = target.stat()
            key = str(target)
            cached = hashes.get(key)
            if not cached or cached[:2] != (st.st_mtime, st.st_size):
                hashes[key] = (st.st_mtime, st.st_size, sha256(target))
            digest = hashes[key][2]
            entry = state.get(digest, {})
            if entry.get("status") == "complete" or entry.get("attempts", 0) >= MAX_ATTEMPTS:
                continue
            pending = (target, digest)
            break
        if pending is None:
            log(f"idle: every target analyzed; next scan in {POLL_SECONDS} s")
            time.sleep(POLL_SECONDS)
            continue
        target, digest = pending
        entry = state.setdefault(digest, {"path": str(target), "attempts": 0})
        entry.update(status="running", started=time.time(), attempts=entry["attempts"] + 1)
        write_json(STATE, state)
        try:
            analyze(target)
            entry.update(status="complete", finished=time.time())
        except Exception:
            entry.update(status="failed", error=traceback.format_exc()[-4000:])
            log(f"{target}: failed (attempt {entry['attempts']}/{MAX_ATTEMPTS})\n{entry['error']}")
        write_json(STATE, state)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("binary", type=Path)
    a.add_argument("--force", action="store_true")
    sub.add_parser("loop")
    args = parser.parse_args()
    if args.cmd == "analyze":
        analyze(args.binary, args.force)
    else:
        loop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
