# SPDX-License-Identifier: Apache-2.0
import json

import pytest

from aphrody.inference.fleet import Node, pipeline_plan, plan_json
from aphrody.inference.fleet_runtime import ray_command, serve_command


def test_buv_planner_import_does_not_require_optional_sdk_providers():
    import subprocess
    import sys
    from pathlib import Path

    source = str(Path(__file__).resolve().parents[1] / "src")
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            "-c",
            "import sys,json; sys.path.insert(0, "
            + repr(source)
            + "); import aphrody.inference.fleet; "
            "print(json.dumps([n for n in sys.modules if "
            "n.startswith(('torch','httpx','transformers','aphrody.vertex'))]))",
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert json.loads(result.stdout) == []


def test_ray_refuses_unroutable_docker_addresses_before_starting_any_process():
    with pytest.raises(ValueError, match="routed"):
        ray_command("head", {"VLLM_HOST_IP": "172.17.0.2"})
    with pytest.raises(ValueError, match="owner"):
        ray_command("head", {"VLLM_HOST_IP": "10.201.77.10"})
    with pytest.raises(ValueError, match="role"):
        ray_command("arbitrary", {})


def node(member="aphro-pc", cuda=True):
    owner = member == "aphro-pc"
    return Node(
        member,
        "10.200.77.4" if owner else "10.200.77.10",
        "RTX 4070" if owner else "RTX 4060",
        12282 if owner else 8188,
        11397 if owner else 6759,
        32 << 30,
        12 << 30,
        900 << 30,
        100 << 30,
        cuda,
    )


def test_heterogeneous_stages_cover_all_layers_without_inventing_shared_memory():
    result = pipeline_plan([node("omar"), node()], 35)
    assert sum(result["layer_partition"]) == 35
    assert result["layer_partition"][0] > result["layer_partition"][1] > 0
    assert result["stages"][0]["member"] == "aphro-pc"
    assert result["resources"]["total_vram_mib"] == 20470
    assert "not a coherent" in result["resources"]["memory_semantics"]


def test_driver_visibility_does_not_qualify_docker_cuda():
    result = pipeline_plan([node(cuda=False), node("omar")], 35)
    assert result["cuda_ready"] is False
    assert result["missing_cuda"] == ["aphro-pc"]


def test_duplicate_nodes_and_insufficient_memory_are_rejected():
    with pytest.raises(ValueError, match="distinct"):
        pipeline_plan([node(), node()], 35)
    with pytest.raises(ValueError, match="insufficient"):
        pipeline_plan([node(), node("omar")], 35, reserve_mib=7000)


def test_native_json_boundary_refuses_untrusted_host_and_bad_counters():
    from dataclasses import asdict

    request = {"nodes": [asdict(node()), asdict(node("omar"))], "layers": 35}
    assert json.loads(plan_json(json.dumps(request)))["cuda_ready"]
    request["nodes"][0]["address"] = "8.8.8.8"
    with pytest.raises(ValueError, match="private"):
        plan_json(json.dumps(request))
    request["nodes"][0]["address"] = "10.200.77.4"
    request["nodes"][0]["free_vram_mib"] = True
    with pytest.raises(ValueError, match="counters"):
        plan_json(json.dumps(request))


def test_dedicated_omar_service_does_not_require_owner_gpu_or_ray():
    from pathlib import Path

    env = {"APHRODY_GPU_MODEL_NAME": "gemma4-e2b", "APHRODY_GPU_MAX_MODEL_LEN": "4096"}
    command = serve_command("standalone", Path("/models/gemma4-e2b"), env)
    assert command[command.index("--pipeline-parallel-size") + 1] == "1"
    assert command[command.index("--distributed-executor-backend") + 1] == "mp"
    assert "ray" not in command
    head = serve_command("head", Path("/models/gemma4-e2b"), env)
    assert head[head.index("--pipeline-parallel-size") + 1] == "2"
    with pytest.raises(ValueError, match="serving role"):
        serve_command("worker", Path("/models/gemma4-e2b"), env)


def test_quantization_selection_is_explicit_and_does_not_inject_arguments():
    from pathlib import Path

    env = {
        "APHRODY_GPU_MODEL_NAME": "gemma4-e2b",
        "APHRODY_GPU_MAX_MODEL_LEN": "4096",
        "APHRODY_GPU_QUANTIZATION": "bitsandbytes",
    }
    command = serve_command("standalone", Path("/models/gemma4-e2b"), env)
    assert command[-2:] == ["--quantization", "bitsandbytes"]
    assert command[command.index("--max-num-seqs") + 1] == "1"
    env["APHRODY_GPU_QUANTIZATION"] = "bitsandbytes --trust-remote-code"
    with pytest.raises(ValueError, match="quantization"):
        serve_command("standalone", Path("/models/gemma4-e2b"), env)


@pytest.mark.parametrize("corrupt", [False, True])
def test_model_depot_integrity_precedes_atomic_activation(
    tmp_path, monkeypatch, corrupt
):
    import hashlib
    import io

    from aphrody.inference import fleet_artifacts as artifacts

    token = tmp_path / "depot.token"
    token.write_text("a" * 64)
    root = tmp_path / "models"
    root.mkdir()
    target = root / "model.safetensors"
    target.write_bytes(b"previous verified model")
    expected = b"new pinned model"
    received = b"corrupted model!" if corrupt else expected
    monkeypatch.setattr(artifacts, "FILES", ("model.safetensors",))
    monkeypatch.setattr(artifacts, "WEIGHT_BYTES", len(expected))
    monkeypatch.setattr(
        artifacts, "WEIGHT_SHA256", hashlib.sha256(expected).hexdigest()
    )

    def response(request, timeout):
        assert request.full_url == "http://10.200.77.1:8182/model.safetensors"
        assert request.get_header("Authorization") == "Bearer " + "a" * 64
        return io.BytesIO(received)

    monkeypatch.setattr(artifacts, "urlopen", response)
    if corrupt:
        with pytest.raises(RuntimeError, match="integrity"):
            artifacts.download(root, token)
        assert target.read_bytes() == b"previous verified model"
    else:
        artifacts.download(root, token)
        assert target.read_bytes() == expected


def test_cpu_offload_is_explicit_bounded_and_standalone_only():
    from pathlib import Path

    env = {
        "APHRODY_GPU_MODEL_NAME": "gemma4-e2b",
        "APHRODY_GPU_MAX_MODEL_LEN": "4096",
        "APHRODY_GPU_CPU_OFFLOAD_GIB": "2",
    }
    command = serve_command("standalone", Path("/models/gemma4-e2b"), env)
    assert command[-2:] == ["--cpu-offload-gb", "2.0"]
    with pytest.raises(ValueError, match="standalone"):
        serve_command("head", Path("/models/gemma4-e2b"), env)
    for invalid in ("nan", "inf", "-1", "3", "2 --trust-remote-code"):
        env["APHRODY_GPU_CPU_OFFLOAD_GIB"] = invalid
        with pytest.raises(ValueError):
            serve_command("standalone", Path("/models/gemma4-e2b"), env)


def test_gpu_utilization_preserves_a_display_reserve_before_launch():
    from pathlib import Path

    env = {
        "APHRODY_GPU_MODEL_NAME": "gemma4-e2b",
        "APHRODY_GPU_MAX_MODEL_LEN": "4096",
        "APHRODY_GPU_MEMORY_UTILIZATION": "0.93",
    }
    command = serve_command("standalone", Path("/models/gemma4-e2b"), env)
    assert command[command.index("--gpu-memory-utilization") + 1] == "0.93"
    for invalid in ("nan", "inf", "0.99", "0.1", "0.93 --trust-remote-code"):
        env["APHRODY_GPU_MEMORY_UTILIZATION"] = invalid
        with pytest.raises(ValueError):
            serve_command("standalone", Path("/models/gemma4-e2b"), env)


def test_chat_allocation_does_not_silently_load_multimodal_encoders():
    from pathlib import Path

    env = {
        "APHRODY_GPU_MODEL_NAME": "gemma4-e2b",
        "APHRODY_GPU_MAX_MODEL_LEN": "4096",
        "APHRODY_GPU_LANGUAGE_MODEL_ONLY": "1",
    }
    assert "--language-model-only" in serve_command(
        "standalone", Path("/models/gemma4-e2b"), env
    )
    with pytest.raises(ValueError, match="standalone"):
        serve_command("head", Path("/models/gemma4-e2b"), env)
    env["APHRODY_GPU_LANGUAGE_MODEL_ONLY"] = "true --trust-remote-code"
    with pytest.raises(ValueError, match="0 or 1"):
        serve_command("standalone", Path("/models/gemma4-e2b"), env)


def test_manual_kv_budget_cannot_exceed_the_measured_candidate_bounds():
    from pathlib import Path

    env = {
        "APHRODY_GPU_MODEL_NAME": "gemma4-e2b",
        "APHRODY_GPU_MAX_MODEL_LEN": "2048",
        "APHRODY_GPU_KV_CACHE_BYTES": str(256 << 20),
    }
    command = serve_command("standalone", Path("/models/gemma4-e2b"), env)
    assert command[command.index("--kv-cache-memory-bytes") + 1] == str(256 << 20)
    assert command[command.index("--max-num-batched-tokens") + 1] == "512"
    for value in ("-1", "inf", str(513 << 20), str(63 << 20)):
        env["APHRODY_GPU_KV_CACHE_BYTES"] = value
        with pytest.raises(ValueError):
            serve_command("standalone", Path("/models/gemma4-e2b"), env)
