<!-- SPDX-License-Identifier: Apache-2.0 -->
# MCP HTTP and A2A on the vps (declared 2026-10-06, not applied)

Two durable, loopback-only units for the vps, declared in the Infra catalog on owner order. The host was not
touched: the target host is not yet designated by the owner, so applying waits for validation.

| Unit | Command | Listener | State | Catalog entry |
| --- | --- | --- | --- | --- |
| `aphrody-mcp-http.service` | `aphrody-mcp http --bind 127.0.0.1:8789` | loopback `:8789` (`/mcp`, `/healthz`, `/api/v1/*`) | `~/.aphrody` of `ubuntu` | `aphrody-mcp-http` |
| `aphrody-a2a.service` | `aphrody a2a serve --bind 127.0.0.1:8788 --coord-dir /srv/aphrody/shared/coord` | loopback `:8788` (agent card, `/ping`, `/msg`, JSON-RPC) | `/srv/aphrody/shared/{a2a,coord}` | `aphrody-a2a` |

Files: `config/host/systemd/aphrody/aphrody-{mcp-http,a2a}.service`, `config/host/catalog.json` (units),
`config/service-catalog.json`, `config/secrets-contract.json`, `config/host/inventory/targets.json`. The retired
public routes of `aphrody-a2a` (aphrody.com, api.aphrody.com) were removed from `config/host/nginx/routes.json`: nothing
here is ever proxied or published. `aphrody-ai-http` stays retired; its port 8789 and health path moved to
`aphrody-mcp-http` (same server) because the validator allows one catalog entry per port, retired or not.

## Plan, observe, apply

`aphrody infra` has no `host-plan` command (aphrody 1.0.0-canary). The host module owns unit composition, so the
convention of `publish-downloads.ts host-plan | host-apply` lives there:

```sh
bun packages/engine/core/src/host/cli.ts host-plan aphrody-mcp-http aphrody-a2a --expect-tools 137   # dry run
bun packages/engine/core/src/host/cli.ts host-plan aphrody-mcp-http aphrody-a2a --observe            # + read-only preflight on the host
bun packages/engine/core/src/host/cli.ts host-apply aphrody-a2a --target vps --apply                 # mutation, explicit target
```

Per unit: preflight (binary, port free, state paths, env file), provision, install (composed unit, `systemd-verify`,
`daemon-reload`, `enable --now`), verify (active, every listener loopback, health probe, `tools/list` count) and a
rollback. A failed check before the first mutation stops everything; a failed verify rolls that unit back.
`scripts/tools/infra/mcp-tools-count.ts` is the standalone `tools/list` counter.

## Qualification of the units (2026-10-06, WSL, real binary, same sandbox on alternate ports)

- Both start under the exact composed directives, `ProtectHome=tmpfs` with only the binary and the state paths bound,
  no capability, `NoNewPrivileges`, seccomp `@system-service`: `tools/list` over HTTP, `/healthz`, A2A `/ping`, agent
  card and `/msg` into the mailbox answer; browser navigate, markdown, screenshot, pdf, snapshot, fetch and `re_triage`
  run.
- Without `SystemCallFilter=@pkey` the in-process browser (V8) calls `pkey_alloc` at start and the whole process dies
  with SIGSYS (`status=31/SYS`); the unit carries the exception.
- `systemd-analyze security --offline` of the composed units: 1.7 for both (lower is stricter), against 3.1
  (`shenron-mcp-http`), 3.9 (`aphrody-llama-gemma4`), 7.1 (`aphrody-fonts-proxy`) and 7.5 (`aphrody-downloads`).
- `upstream_list` (and the other `upstream_*` tools, 5 in all) reads `./config/upstream-sources.json` from the working
  directory: only `upstream_list` was exercised and it fails without a repository checkout there, which the vps
  working directory does not have.

## Findings that need the owner

1. **Port 8789 on the vps is held** by the reverse tunnel of the WSL compute (`aphrody-compute-vps-tunnel`, user unit on
   the WSL host): `sshd` listens there on `0.0.0.0` and `[::]` because the vps has `GatewayPorts yes`. ufw denies
   incoming by default and admits only the listed ports and admin addresses, which is the only thing keeping it off the
   internet (a TCP connect and `GET /healthz` from an admin address succeed; `/mcp` answers 403 to a public Host
   header). The unit cannot start until the tunnel is moved or this unit takes another loopback port; the Shenron
   clients are declared to read `APHRODY_AI_HTTP_URL=http://127.0.0.1:8789` from
   `/etc/aphrody/shenron-compute-client.env` (`config/local-ai.json`), so freeing it is not neutral.
2. **`/mcp` has no authentication**, only a Host header check that a client sets itself. Any process that reaches the
   loopback port can call every tool, including `aphrody_mcp_call` (spawns stdio MCP servers). The sandbox limits what
   the process can see and write; it does not replace authentication in front.
3. **The deployed binary is not the all-features build.** Count of `tools/list`: 127 on the vps
   `~/.local/bin/aphrody-mcp` (sha256 `722433e7...`, over stdio through ssh), on the installed multi-call binary and on
   the running WSL HTTP server (over HTTP), with identical names. A build with `--features toolbox` adds `aphrody_ocr`, `aphrody_shenron_ocr`,
   `aphrody_describe_image`, `aphrody_transcribe`, `aphrody_job_submit`, `aphrody_job_status`, `aphrody_rag_search`,
   `aphrody_rag_context`, `aphrody_home_query`, `aphrody_home_status`: 137 (count from the router sources, to confirm on
   the built binary; `winclean` only adds tools on Windows). `aphrody` package features do not forward
   `aphrody-mcp/toolbox`, so the published `-p aphrody` build cannot carry them as is.
4. `/etc/aphrody/aphrody-ai-http.env` exists on the vps (retired gateway: database DSN, token, E5 and Gemini cookie
   settings) and is deliberately not loaded; the optional `/etc/aphrody/aphrody-mcp-http.env` and `aphrody-a2a.env` are
   absent.
5. A2A runs with `APHRODY_A2A_DRY_RUN=1` (messages recorded and answered, no peer CLI spawned), as the retired unit did.
6. The units run the binaries of `/home/ubuntu/.local/bin` (no release tree exists for this plane); an immutable release
   plane would need its own adapter.

## Rollback

`systemctl disable --now <unit>`, remove `/etc/systemd/system/<unit>`, `daemon-reload` (step `remove` of the plan).
State directories, `ai.json` and env files stay.
