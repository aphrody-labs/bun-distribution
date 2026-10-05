# SPDX-License-Identifier: Apache-2.0
"""Migration must preserve package-owned component license declarations."""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "modernize_workspace", Path(__file__).with_name("modernize_workspace.py")
)
assert _spec and _spec.loader
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)


def test_metadata_migration_preserves_component_licenses(monkeypatch, tmp_path):
    sdk = tmp_path / "packages/aphrody"
    sdk.mkdir(parents=True)
    monkeypatch.setattr(_module, "ROOT", tmp_path)
    monkeypatch.setattr(_module, "SDK", sdk)
    _module.metadata(
        tmp_path / "pyproject.toml",
        {
            "project": {"dependencies": []},
            "dependency-groups": {"dev": []},
            "tool": {
                "uv": {"workspace": {}},
                "pytest": {"ini_options": {"testpaths": []}},
            },
        },
    )
    license_expression = "Apache-2.0 AND AGPL-3.0-only"
    license_files = ["LICENSE", "NOTICE", "LICENSES/AGPL-3.0-only.txt"]
    _module.metadata(
        sdk / "pyproject.toml",
        {
            "project": {
                "license": license_expression,
                "license-files": license_files,
                "classifiers": [],
                "dependencies": [],
                "optional-dependencies": {},
            },
            "tool": {"maturin": {"exclude": []}},
        },
    )
    (sdk / "LICENSE").write_text("Synthetic existing base license")
    _module.metadata(tmp_path / "packages/model-tools/pyproject.toml", {"project": {}})
    (tmp_path / ".gitignore").write_text("")
    for _iteration in range(2):
        _module.migrate_metadata()
        project = _module.load(sdk / "pyproject.toml")["project"]
        assert project["license"] == license_expression
        assert project["license-files"] == license_files
