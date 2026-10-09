# SPDX-License-Identifier: Apache-2.0
import json

import pytest

from aphrody.inference.fleet import Node, pipeline_plan, plan_json
from aphrody.inference.fleet_runtime import ray_command


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
