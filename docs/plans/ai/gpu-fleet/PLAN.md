<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Bun/Python GPU inference

Owner goal, 2026-10-09: a persistent Docker vLLM fleet using both Windows PCs,
real bun:windows and bun:python integration in Aphrody py, distributed model
memory, load allocation, RAM and network storage, and reversible exclusive
inference mode on Omar.

## Initial host allocation — owner correction, 2026-10-09

The owner PC is the native Windows development workstation. Omar is the
initial dedicated GPU inference server. VPS owns SSH build factories, a bounded
artifact cache/file depot, authenticated API proxy and static CDN cache. DBFR
owns production and its existing TLS gateway. Do not start an inference head or
persistent GPU worker on the development PC. The previous two-PC planner remains
an optional later capability, not the initial deployment prerequisite.

Use single-node vLLM on Omar (tensor/pipeline parallel size one). Qualify CUDA
arithmetic and the pinned model against the RTX 4060 budget before activation;
select a supported quantized artifact if the catalogue model does not fit.
Public CDN caching covers immutable permitted artifacts only; never cache
streamed inference, protected model weights or provider authentication publicly.

## Plan before apply

Use the existing Infra mesh and protected host stores. The RTX 4070 exposes
12282 MiB and Omar's RTX 4060 exposes 8188 MiB. Use pipeline parallelism across
hosts, tensor parallelism one within each host, and a measured heterogeneous
layer split. The initial model follows the pinned Aphrody Gemma training
catalogue. vLLM and model support require actual pinned-image qualification.

Ray/NCCL must communicate over routable private container addresses, not Docker
bridge addresses advertised behind Windows NAT. Qualify communication before
loading weights. RAM and storage are distributed resources, not magically one
address space; network delay is measured and cannot be zero. Use local verified
model caches backed by a restricted network artifact store.

The native owner process uses bun:windows for resource counters, process/Job
ownership, native service checks and exclusive-mode restoration. bun:python
hosts the Python fleet planner in the same Bun process. Docker owns vLLM
restarts; the existing Mesh entrypoint owns the dedicated Bun process. No
credentials, session histories, clipboard contents or arbitrary user directories
are synchronized.

## Qualification queue

- [x] Native GPU identities and VRAM measured on both PCs.
- [x] vLLM parallelism docs queried through the documentation MCP.
- [x] Local native CPython host loaded by the fork; same-process PID and queued calls tested.
- [ ] Native CPython host and Python environment qualified on Omar.
- [ ] Docker CUDA arithmetic qualified on both PCs.
- [ ] Private Ray/NCCL roundtrip over the container network.
- [ ] Measured layer partition, RAM budgets, model pin and caches.
- [x] Python fleet planner and dedicated Bun inventory/planning entrypoint; four Python tests and two Bun tests.
- [ ] Compose installation and inference client activation.
- [ ] Two-GPU live token generation, load/latency/memory measurements.
- [ ] Reversible Omar Explorer/browser retirement after execution qualification.
- [ ] Restart, reboot, protected storage, scoped gates, commit and push.

## Evidence and current limits

The local Docker Desktop engine currently reports LinuxKit `7.0.14-linuxkit`.
The official CUDA container fails before starting: `libnvidia-ml.so.1` missing.
Omar's Docker engine reports the Microsoft WSL2 kernel, through native Docker.
No local WSL development session is started. Existing concurrent containers
remain in place. A driver-visible GPU does not establish Docker CUDA access.

The owner's native `bun_python_host.dll` under the installed Aphrody target
loads with CPython 3.12.15. A dedicated fork Bun process calls the Python planner
in process and computes a candidate 22/13 layer split for the catalogue's
35-layer E2B model. This is planning evidence, not distributed token generation.
The CPython test is isolated in its dedicated process because direct embedding
in bun:test's shared thread lifecycle timed out.

Omar's official CUDA image (digest
`sha256:001469ea0f3dec85a1ca929aeea3b58ae369d4c11228b10aec1f642bb6ca7a6f`)
reports the RTX 4060 inside Docker. CUDA arithmetic and vLLM still need
qualification. Public image downloads use an isolated anonymous Docker config
because the Windows credential helper cannot read its store from an SSH logon.
Provider credentials are not copied or reconfigured.

Primary references: [vLLM parallelism](https://docs.vllm.ai/en/v0.26.0/serving/parallelism_scaling/),
[Docker Windows GPU support](https://docs.docker.com/desktop/features/gpu/).

## Dedicated-server qualification, 2026-10-09

The standalone Compose profile serves only Omar, with TP=1 and PP=1 and no Ray
startup. Six Python tests cover the planner, routed Ray addresses and distinct
standalone/distributed serving commands. Two native Bun/Python tests pass;
scoped strict TypeScript, lint, formatting and Compose parsing pass.

The pinned catalogue repository and revision were confirmed through the model
registry API. Its model.safetensors response declares 10,246,621,918 bytes,
which exceeds Omar's 8,188 MiB VRAM before runtime/KV allocations. Do not activate
the BF16 service unchanged. Quantization or measured CPU offload must qualify
against this exact model and image, with actual token generation. The vLLM image
pull remains active; no CUDA arithmetic or model generation is yet claimed.

## Quantization candidate and artifact integrity

The initial single-GPU command now accepts the explicitly selected
`bitsandbytes` four-bit candidate, and starts with one concurrent sequence.
It does not silently enable remote model code or install dependencies. The
candidate follows [vLLM 0.26 BitsAndBytes documentation](https://docs.vllm.ai/en/v0.26.0/features/quantization/bnb/);
Gemma compatibility, installed bitsandbytes version and actual generation still
require container qualification. Seven scoped Python tests now pass.

The [fleet catalogue](../../../../tools/config/ai/gpu-fleet.json) pins the model
revision, exact weight byte count and registry LFS SHA-256. The depot is private,
limited to 32 GiB and contains no prompt cache. VPS capacity was rechecked:
145 GiB free. The declaration is not evidence of a downloaded or verified cache.

The VPS artifact transfer is running in the dedicated tmux session
`aphrody-gpu-model-cache`. Its first inspected partial file was 594,161,664
bytes. The job enforces the expected file size and verifies the pinned SHA-256
before renaming the partial file. Transfer completion and local Omar cache
qualification are pending; the model is not yet served.

## Isolated Omar qualification source

The CUDA probe runs fleet.py directly, avoiding imports of unrelated SDK
providers and their dependencies. Omar has an isolated release source directory
under its configured Aphrody home; its Compose file and environment were
updated to use that directory. No source checkout or provider store was replaced.
The standalone profile removes the distributed layer partition environment
variable rather than setting it to an empty invalid value. Seven Python tests,
Ruff and Compose parsing pass for this batch.

VPS metadata, tokenizer, chat template and repository notices were downloaded
from the pinned revision. Their local checksum manifest verifies rereads;
weight verification remains tied to the independently recorded registry LFS
SHA-256. The weight transfer was observed at 4,007,993,344 bytes and active in
its existing tmux session. Neither partial weights nor interface health count
as live inference qualification.
