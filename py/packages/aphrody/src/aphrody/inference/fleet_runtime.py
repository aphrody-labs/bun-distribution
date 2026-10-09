# SPDX-License-Identifier: Apache-2.0
"""Container lifecycle for the private two-PC vLLM/Ray pipeline."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


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


def main(role: str) -> int:
    env = dict(os.environ)
    command = ray_command(role, env)
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
            "ray",
            "--tensor-parallel-size",
            "1",
            "--pipeline-parallel-size",
            "2",
            "--dtype",
            "bfloat16",
            "--max-model-len",
            env["APHRODY_GPU_MAX_MODEL_LEN"],
            "--max-num-seqs",
            "4",
            "--gpu-memory-utilization",
            "0.85",
            "--enable-prefix-caching",
        ]
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
        subprocess.run(["ray", "stop"], check=False, timeout=30)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
