# SPDX-License-Identifier: Apache-2.0
# Source owner: @aphrody/web-source in the Bun fork; retain the consumer namespace.
from pathlib import Path as _SourcePath
from os import environ as _source_environ

_source_repo = next(
    parent for parent in _SourcePath(__file__).resolve().parents
    if (parent / "Cargo.toml").is_file() and (parent / "PLAN.md").is_file()
)
_source_bun = _SourcePath(_source_environ.get("APHRODY_BUN_CHECKOUT", str(_source_repo.parent / "bun")))
_source_provider = _source_bun / "packages/web/rust/integrations/py/packages/aphrody/src/aphrody/web_browser.py"
exec(compile(_source_provider.read_bytes(), str(_source_provider), "exec"), globals())
