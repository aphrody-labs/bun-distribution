# SPDX-License-Identifier: Apache-2.0
"""Compatibility import; implementation is owned by aphrody_meetings."""

import sys
from importlib import import_module

try:
    _implementation = import_module("aphrody_meetings.pipeline")
except ModuleNotFoundError as exc:
    if exc.name == "aphrody_meetings":
        raise ImportError(
            "Install the aphrody-meetings distribution for this API"
        ) from exc
    raise
sys.modules[__name__] = _implementation
