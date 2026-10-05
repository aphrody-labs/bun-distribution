# SPDX-License-Identifier: Apache-2.0
"""Native FFI bridge for Shenron & Dragon Ball FR in Python via ctypes."""

from __future__ import annotations

import ctypes
import json
import os
import sys
from pathlib import Path
from typing import Any


def find_shenron_ffi_lib() -> Path | None:
    """Find the shared Shenron FFI library in overrides and development builds."""
    override = os.environ.get("SHENRON_FFI_LIB") or os.environ.get("APHRODY_FFI_LIB")
    if override and Path(override).is_file():
        return Path(override)

    prefix = "" if sys.platform == "win32" else "lib"
    ext = (
        "dll"
        if sys.platform == "win32"
        else ("dylib" if sys.platform == "darwin" else "so")
    )
    names = [f"{prefix}shenron_ffi.{ext}", f"{prefix}aphrody_ffi.{ext}"]

    home = Path(os.environ.get("USERPROFILE") or os.environ.get("HOME") or ".")
    search_dirs = [
        home / "aphrody" / "target" / "release",
        home / "aphrody" / "target" / "debug",
        home / "src" / "target" / "release",
        home / "src" / "target" / "debug",
        home / "src" / "target" / "debug" / "deps",
        home / "src" / "aphrody-ai" / "target" / "release",
        home / "src" / "aphrody-ai" / "target" / "debug",
        home / "src" / "aphrody-ai" / "target" / "debug" / "deps",
    ]

    for d in search_dirs:
        for name in names:
            candidate = d / name
            if candidate.is_file():
                return candidate
    return None


class ShenronFfi:
    """Call the Shenron C ABI through a loaded shared library."""

    _instance: ShenronFfi | None = None

    def __init__(self, lib_path: Path | None = None):
        path = lib_path or find_shenron_ffi_lib()
        if not path:
            raise RuntimeError(
                "Shenron native FFI library (aphrody_ffi/shenron_ffi) not found."
            )
        self.lib_path = path
        self._cdll = ctypes.CDLL(str(path))

        # Setup C signatures
        self._cdll.shenron_abi_version.restype = ctypes.c_uint32
        self._cdll.shenron_abi_version.argtypes = []

        self._cdll.shenron_version.restype = ctypes.c_char_p
        self._cdll.shenron_version.argtypes = []

        self._cdll.shenron_string_free.restype = None
        self._cdll.shenron_string_free.argtypes = [ctypes.c_void_p]

        self._cdll.shenron_run_captured.restype = ctypes.c_void_p
        self._cdll.shenron_run_captured.argtypes = [ctypes.c_char_p]

        self._cdll.shenron_rag_search.restype = ctypes.c_void_p
        self._cdll.shenron_rag_search.argtypes = [
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
        ]

        self._cdll.shenron_rag_stats.restype = ctypes.c_void_p
        self._cdll.shenron_rag_stats.argtypes = []

        self._cdll.shenron_auth_status.restype = ctypes.c_void_p
        self._cdll.shenron_auth_status.argtypes = []

        self._cdll.shenron_persona_prompt.restype = ctypes.c_char_p
        self._cdll.shenron_persona_prompt.argtypes = []

        self._cdll.shenron_persona_ask.restype = ctypes.c_void_p
        self._cdll.shenron_persona_ask.argtypes = [ctypes.c_char_p]

    @classmethod
    def get(cls) -> ShenronFfi:
        """Return the process-wide FFI wrapper instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def abi_version(self) -> int:
        """Return the ABI version exported by the loaded library."""
        return int(self._cdll.shenron_abi_version())

    def version(self) -> str:
        """Return the native library version string."""
        res = self._cdll.shenron_version()
        return res.decode("utf-8") if res else ""

    def persona_prompt(self) -> str:
        """Return the current persona prompt."""
        res = self._cdll.shenron_persona_prompt()
        return res.decode("utf-8") if res else ""

    def rag_search(
        self, query: str, limit: int = 5, kind: str | None = None
    ) -> list[dict[str, Any]]:
        """Search the native RAG index and decode its JSON results."""
        q_bytes = query.encode("utf-8")
        k_bytes = kind.encode("utf-8") if kind else None
        ptr = self._cdll.shenron_rag_search(q_bytes, limit, k_bytes)
        if not ptr:
            return []
        try:
            val = ctypes.cast(ptr, ctypes.c_char_p).value
            if not val:
                return []
            parsed = json.loads(val.decode("utf-8"))
            if isinstance(parsed, dict) and "stdout" in parsed:
                return json.loads(parsed["stdout"])
            return parsed if isinstance(parsed, list) else []
        finally:
            self._cdll.shenron_string_free(ptr)

    def rag_stats(self) -> dict[str, Any]:
        """Return index statistics from the native RAG service."""
        ptr = self._cdll.shenron_rag_stats()
        if not ptr:
            return {}
        try:
            val = ctypes.cast(ptr, ctypes.c_char_p).value
            if not val:
                return {}
            parsed = json.loads(val.decode("utf-8"))
            if isinstance(parsed, dict) and "stdout" in parsed:
                return json.loads(parsed["stdout"])
            return parsed if isinstance(parsed, dict) else {}
        finally:
            self._cdll.shenron_string_free(ptr)

    def auth_status(self) -> dict[str, Any]:
        """Return native authentication status as a dictionary."""
        ptr = self._cdll.shenron_auth_status()
        if not ptr:
            return {}
        try:
            val = ctypes.cast(ptr, ctypes.c_char_p).value
            if not val:
                return {}
            parsed = json.loads(val.decode("utf-8"))
            if isinstance(parsed, dict) and "stdout" in parsed:
                return json.loads(parsed["stdout"])
            return parsed if isinstance(parsed, dict) else {}
        finally:
            self._cdll.shenron_string_free(ptr)

    def persona_ask(self, question: str) -> str:
        """Ask the native persona and return its response text."""
        ptr = self._cdll.shenron_persona_ask(question.encode("utf-8"))
        if not ptr:
            return ""
        try:
            val = ctypes.cast(ptr, ctypes.c_char_p).value
            if not val:
                return ""
            parsed = json.loads(val.decode("utf-8"))
            return parsed.get("stdout", "") if isinstance(parsed, dict) else ""
        finally:
            self._cdll.shenron_string_free(ptr)
