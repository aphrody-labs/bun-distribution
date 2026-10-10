# SPDX-License-Identifier: Apache-2.0
"""Compatibility import; implementation is owned by aphrody_cli."""

from importlib import import_module

try:
    _implementation = import_module("aphrody_cli")
except ModuleNotFoundError as exc:
    if exc.name == "aphrody_cli":
        raise ImportError("Install the aphrody-cli distribution for this API") from exc
    raise


def __getattr__(name: str):
    return getattr(_implementation, name)


__all__ = ["Aphrody", "main"]
