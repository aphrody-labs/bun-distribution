# SPDX-License-Identifier: Apache-2.0
"""SDK imports must remain usable without provider dependencies or local state."""

import json
import subprocess
import sys
from pathlib import Path

import pytest


def test_root_import_and_web_api_need_only_standard_library():
    source = Path(__file__).resolve().parents[1] / "src"
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            "-c",
            "import sys, json; sys.path.insert(0, sys.argv[1]); "
            "import aphrody; "
            "assert 'WebBrowserClient' in dir(aphrody); "
            "assert 'WebBrowserClient' not in vars(aphrody); "
            "from aphrody import WebBrowserClient; "
            "assert WebBrowserClient is aphrody.WebBrowserClient; "
            "print(json.dumps(sorted(sys.modules)))",
            str(source),
        ],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    modules = json.loads(result.stdout)
    assert not any(
        name.split(".")[0] in {"google", "httpx", "scrapy", "torch", "docling"}
        for name in modules
    )
    assert "aphrody.auth.credentials" not in modules
    assert "aphrody.aphrody_rust" not in modules


def test_actor_class_export_preserves_function_compatibility():
    from aphrody import ActorClient, list_actors, run_actor
    from aphrody.actors import ActorClient as Implementation

    assert ActorClient is Implementation
    assert callable(list_actors)
    assert callable(run_actor)


@pytest.mark.parametrize("module_name", ["aphrody", "aphrody.google"])
def test_unknown_export_raises_attribute_error(module_name):
    from importlib import import_module

    module = import_module(module_name)
    with pytest.raises(AttributeError, match="has no attribute"):
        _ = module.missing_sdk_export
    assert set(module.__all__).issubset(dir(module))


def test_google_provider_exports_resolve_to_original_implementations():
    from aphrody.google import GeminiVertex, GoogleRuntime
    from aphrody.google_runtime import GoogleRuntime as Runtime
    from aphrody.vertex import GeminiVertex as Vertex

    assert GeminiVertex is Vertex
    assert GoogleRuntime is Runtime


def test_document_and_blender_clients_use_canonical_implementations():
    from aphrody import AuthenticatedDocsClient, BlenderRunner, GoogleDocBuilder
    from aphrody.bpy_runner import BlenderRunner as Runner
    from aphrody.google import AuthenticatedDocsClient as GoogleDocs
    from aphrody.google_docs import AuthenticatedDocsClient as Docs
    from aphrody.google_docs import GoogleDocBuilder as Builder

    assert AuthenticatedDocsClient is GoogleDocs is Docs
    assert BlenderRunner is Runner
    assert GoogleDocBuilder is Builder
