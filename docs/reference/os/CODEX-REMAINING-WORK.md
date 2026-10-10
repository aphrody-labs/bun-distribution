<!-- SPDX-License-Identifier: Apache-2.0 -->
# Remaining work — 2026-09-28

[Architecture gap status](../../architecture/os/ARCHITECTURE-GAPS-STATUS.md) owns completed work and
recorded checks. Kernel dispatch policy, bounded transport, scoped authentication
and audit bridging are recorded there as implemented locally; their tests are
not still pending. Installed local proof does not qualify production hosts.

Remaining work:

- Provision protected per-host identity, execution policy and audit configuration;
  verify allowed/denied calls, endpoint permissions, restart and audit health.
- Enforce argv/filesystem/network restrictions at every process boundary or reject
  the unsupported mode, including remote subsystem paths.
- Finish generated WinClean types/implementations and dispatcher decomposition.
- Decide whether coordination retains its documented file store or migrates to jobs/A2A.
- Prove remote mirror download integrity.

Follow [AGENTS.md](./AGENTS.md) for NHITL. Preserve concurrent work. Bun and uv
remain external system runtimes; keep their source trees out of the repository
unless a concrete source consumer requires them.
