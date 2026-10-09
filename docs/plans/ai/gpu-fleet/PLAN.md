<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Bun/Python two-PC GPU inference

Owner goal, 2026-10-09: a persistent Docker vLLM fleet using both Windows PCs,
real bun:windows and bun:python integration in Aphrody py, distributed model
memory, load allocation, RAM and network storage, and reversible exclusive
inference mode on Omar.

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
