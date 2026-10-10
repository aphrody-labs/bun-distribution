# SPDX-License-Identifier: Apache-2.0
"""Container lifecycle for the private two-PC vLLM/Ray pipeline."""

from __future__ import annotations

import json
import math
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.request import Request, urlopen


def ray_command(role: str, env: dict[str, str]) -> list[str]:
    if role not in {"head", "worker"}:
        raise ValueError("invalid GPU fleet role")
    address = env["VLLM_HOST_IP"]
    if address not in {"10.201.77.4", "10.201.77.10"}:
        raise ValueError("Ray must advertise the routed private container address")
    command = [
        "ray",
        "start",
        "--disable-usage-stats",
        "--node-ip-address",
        address,
        "--num-gpus",
        "1",
        "--num-cpus",
        "2",
        "--include-dashboard=false",
    ]
    if role == "head":
        if address != "10.201.77.4":
            raise ValueError("pipeline head must be the qualified owner GPU")
        return command + ["--head", "--port", "6379"]
    return command + ["--address", env["APHRODY_GPU_HEAD_ADDRESS"] + ":6379", "--block"]


def serve_command(role: str, model: Path, env: dict[str, str]) -> list[str]:
    """Keep standalone and distributed process contracts explicit and testable."""
    if role not in {"standalone", "head"}:
        raise ValueError("invalid inference serving role")
    utilization = float(env.get("APHRODY_GPU_MEMORY_UTILIZATION", "0.85"))
    if not math.isfinite(utilization) or not 0.5 <= utilization <= 0.95:
        raise ValueError("GPU utilization exceeds the qualified display reserve")
    command = [
        "vllm",
        "serve",
        str(model),
        "--host",
        "0.0.0.0",
        "--port",
        "8180",
        "--served-model-name",
        env["APHRODY_GPU_MODEL_NAME"],
        "--distributed-executor-backend",
        "mp" if role == "standalone" else "ray",
        "--tensor-parallel-size",
        "1",
        "--pipeline-parallel-size",
        "1" if role == "standalone" else "2",
        "--dtype",
        "bfloat16",
        "--max-model-len",
        env["APHRODY_GPU_MAX_MODEL_LEN"],
        "--max-num-seqs",
        "1" if role == "standalone" else "4",
        "--gpu-memory-utilization",
        str(utilization),
        "--enable-prefix-caching",
    ]
    cache = env.get("APHRODY_GPU_KV_CACHE_BYTES")
    if cache is not None:
        if not cache.isdecimal() or not 64 << 20 <= int(cache) <= 512 << 20:
            raise ValueError("manual KV cache must be within 64..512 MiB")
        if role != "standalone":
            raise ValueError("manual KV cache is only qualified for standalone")
        command += ["--kv-cache-memory-bytes", cache, "--max-num-batched-tokens", "512"]
    quantization = env.get("APHRODY_GPU_QUANTIZATION", "none")
    if quantization not in {"none", "bitsandbytes"}:
        raise ValueError("unqualified inference quantization method")
    if quantization != "none":
        command += ["--quantization", quantization]
    offload = float(env.get("APHRODY_GPU_CPU_OFFLOAD_GIB", "0"))
    if not math.isfinite(offload) or not 0 <= offload <= 2:
        raise ValueError("CPU weight offload exceeds the qualified RAM budget")
    if offload:
        if role != "standalone":
            raise ValueError("CPU weight offload is only qualified for standalone")
        command += ["--cpu-offload-gb", str(offload)]
    text_only = env.get("APHRODY_GPU_LANGUAGE_MODEL_ONLY", "0")
    if text_only not in {"0", "1"}:
        raise ValueError("language-model-only must be 0 or 1")
    if text_only == "1":
        if role != "standalone":
            raise ValueError("text-only mode is only qualified for standalone")
        command += ["--language-model-only"]
    return command


def main(role: str) -> int:
    if role == "qualify":
        return qualify()
    env = dict(os.environ)
    command = ray_command(role, env) if role != "standalone" else []
    children: list[subprocess.Popen] = []
    stopping = threading.Event()

    def stop(_signum=0, _frame=None):
        stopping.set()
        for child in children:
            if child.poll() is None:
                child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        if role == "worker":
            child = subprocess.Popen(command, env=env)
            children.append(child)
            return child.wait()
        if role != "standalone":
            subprocess.run(command, env=env, check=True, timeout=60)
            import ray

            ray.init(address="auto")
            deadline = time.monotonic() + 180
            while ray.cluster_resources().get("GPU", 0) < 2:
                if stopping.is_set():
                    raise RuntimeError("GPU fleet startup cancelled")
                if time.monotonic() >= deadline:
                    raise RuntimeError(
                        "both real GPU workers did not join the private Ray cluster"
                    )
                time.sleep(2)
        model = Path(env["APHRODY_GPU_MODEL_PATH"])
        if not model.is_absolute() or not (model / "config.json").is_file():
            raise RuntimeError("verified local model snapshot is missing")
        # Read the token inside the container; never expose it in process arguments.
        env["VLLM_API_KEY"] = Path("/run/secrets/api-key").read_text().strip()
        if len(env["VLLM_API_KEY"]) < 32:
            raise RuntimeError("inference API token is missing or malformed")
        command = serve_command(role, model, env)
        child = subprocess.Popen(command, env=env)
        children.append(child)
        return child.wait()
    finally:
        stop()
        for child in children:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        if role != "standalone":
            subprocess.run(["ray", "stop"], check=False, timeout=30)


def qualify() -> int:
    """Exercise the real protected serving API from its owning container."""
    token = Path("/run/secrets/api-key").read_text().strip()
    if len(token) < 32:
        raise RuntimeError("inference qualification token is unavailable")
    model = os.environ["APHRODY_GPU_MODEL_NAME"]
    headers = {"Authorization": "Bearer " + token}
    with urlopen(
        Request("http://127.0.0.1:8180/v1/models", headers=headers), timeout=20
    ) as response:
        catalogue = json.load(response)
    if model not in {row["id"] for row in catalogue["data"]}:
        raise RuntimeError("serving API exposes a different model")
    body = {
        "model": model,
        "messages": [
            {"role": "user", "content": "Reply briefly: what is two plus two?"}
        ],
        "temperature": 0,
        "max_tokens": 32,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    started = time.monotonic()
    with urlopen(
        Request(
            "http://127.0.0.1:8180/v1/chat/completions",
            headers={**headers, "Content-Type": "application/json"},
            data=json.dumps(body).encode(),
        ),
        timeout=120,
    ) as response:
        result = json.load(response)
    answer = result["choices"][0]["message"].get("content")
    if not isinstance(answer, str) or not answer.strip():
        raise RuntimeError("model generated no answer")
    print(
        json.dumps(
            {
                "model": result["model"],
                "answer": answer,
                "usage": result.get("usage"),
                "seconds": round(time.monotonic() - started, 3),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
