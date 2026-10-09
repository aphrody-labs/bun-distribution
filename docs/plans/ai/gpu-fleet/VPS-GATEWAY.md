<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS cache, file depot and inference gateway

Owner extension, 2026-10-09. Measured through Infra SSH: VPS root disk has
146 GiB available; RAM has 36623 MiB available. DBFR has 43 GiB disk and
6576 MiB RAM available. Native nginx is inactive on both; production routing
uses the existing DBFR gateway container. The actual domain is
`dragonballfr.com`, alongside the declared `aphrody.com` hosts.

## Selected topology

1. RTX 4070 and RTX 4060 execute the model through a private two-node vLLM
   pipeline. Direct PC-to-PC transport is preferred when qualified; the existing
   VPS WireGuard hub remains the connectivity path where direct reachability
   is absent. Measure round-trip and throughput before selecting the path.
2. VPS holds an immutable model/artifact depot under its own protected Aphrody
   home. Existing authenticated SSH/SFTP serves files; no public model bucket
   or new general Windows share. Allocate an initial 32 GiB depot quota and
   at most 2 GiB RAM cache, preserving the declared build factory allocation.
3. Each GPU host keeps a checksum-verified local model cache at the same
   container path. Download once, verify revisions and checksums, then reuse
   local disk. Network disk latency never sits on each token's weight path.
4. A private authenticated Bun gateway on VPS fronts the head GPU API over
   the existing tunnel, with streaming and backpressure. Health gates reject
   unavailable models. Retry only before a generation has produced output.
5. DBFR's existing TLS gateway forwards the selected authenticated
   `/api/inference/` route to that private service for `aphrody.com` or
   `dragonballfr.com`. Keep existing sites, cookies and domain profiles isolated.
   An upstream OpenAI-compatible API does not imply OpenAI provider access.

## Cache and memory behavior

vLLM's prefix/KV cache stays with the GPU execution owner. CPU offload is
configured per node only after memory and latency measurements. Ray may own
distributed CPU objects; summing resource counters does not produce a single
coherent RAM or VRAM address space.

The VPS file cache contains model/artifact data whose provenance permits use.
Prompt/result caching is disabled by default. An explicitly configured cache
must remain in its domain's protected store, use short TTLs and scoped keys,
and exclude provider credentials, private histories and authentication state.
Streaming API responses are not cached by the public reverse proxy.

## Deployment gates

- [x] Capacity and current routing owner observed through Infra.
- [x] Private topology selected without moving protected data.
- [x] Hub RTT measured: VPS to owner 26.1 ms, VPS to Omar 17.7 ms; owner to Omar 53 ms (three probes each, no loss).
- [ ] Direct-PC bypass and useful throughput measured.
- [ ] GPU container networking and CUDA arithmetic qualified on both PCs.
- [ ] Model depot quota, pinned artifacts and verified local caches applied.
- [ ] Bun gateway, authentication, cancellation and streaming failure tests.
- [ ] Declared route, gateway configuration test, live authenticated generation.

This is a measured deployment plan; no public inference route or shared depot
has yet been activated. The current local LinuxKit Docker GPU failure must be
resolved without starting a local WSL development workflow or disrupting
concurrent containers.
