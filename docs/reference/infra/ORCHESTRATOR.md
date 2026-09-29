# `aphrody-infra` orchestrator

`aphrody-infra` is the single operator surface for Aphrody, Aphrody OS, YOLO,
RG, Niers, SSH/Git, Web and the Windows/WSL/VPS environments. It owns the
workflow contract, target matrix and the single `config/service-catalog.json`
workload registry; it does not duplicate application, kernel or web code.

The catalog is the authority for one unit per workload. It covers Rust HTTP,
Bun/Next HTTP, Discord bots, workers and PostgREST. Nginx is the single public
proxy. Systemd remains the host supervisor. `aphrody-infra service` is the
native lifecycle surface; deployment remains atomic and release-based through the Rust CLI and the per-stack adapters
(`scripts/atomic-deploy-{aphrody-stack,shenron,rg,bundle}.sh`).

## Commands

```bash
cargo run -- status --json
cargo run -- doctor --json
cargo run -- inventory --json
cargo run -- dev-env --target wsl-ubuntu-24.04
cargo run -- sync --target windows-local
cargo run -- deploy --target vps --stack bundle --release /srv/aphrody-infra/bundles/<id>
cargo run -- deploy --target vps --stack bundle --release /srv/aphrody-infra/bundles/<id> --apply
cargo run -- deploy --target vps --stack aphrody|shenron|rg --release /srv/<stack>/releases/<id>
aphrody-infra service catalog
aphrody-infra service status --target local
```

Every invocation creates `var/runs/<timestamp>-<pid>/manifest.json` with the
scope, actions, outputs and final status. Status output keeps the catalog's
`sourceGeneratedAt` for provenance and adds a fresh `observedAtEpoch`; the
catalog timestamp is never treated as live state. Runtime claims require the live
adapters (`ssh`, `wsl.exe`, `systemctl`) to succeed. `sync` and `deploy` are
plan-only unless `--apply` is explicit; dirty worktrees are never reset.

The VPS deploy adapters are installed by `scripts/install-vps-adapter.sh` as
`/usr/local/sbin/aphrody-infra-deploy-{aphrody,shenron,rg,bundle}` (reviewed
copies of `scripts/atomic-deploy-aphrody-stack.sh`, `atomic-deploy-shenron.sh`,
`atomic-deploy-rg.sh` and `atomic-deploy-bundle.sh`, with
`/usr/local/share/aphrody-infra/ADAPTER.json` recording the infra commit). Each
accepts only a release below its own root, verifies checksums and preconditions,
probes loopback and HTTPS routes and restores the previous `current` on failure
(`docs/IMMUTABLE-RELEASES.md`).

## Ownership

- `aphrody-ai`: AI agents, A2A, RAG, MCP (`dragonball.*` included) and E5; its listeners stay on loopback.
- `aphrody-web`: public site, Web API, BXC browser engine and render FFI.
- `aphrody-ui`: M3 design system, the agent console (`ui-dist`) and `@aphrody/bun`.
- `aphrody-os`: kernel, sandbox, services and WinClean (not deployed on the VPS).
- Stack observability keeps `aphrody-infra/scripts/infra-status.ts` for detailed host telemetry; lifecycle status is native Rust.
- RG: RG services and the imported resource monitor.
- Niers: data/build checkout and service-specific assets.
- `aphrody-infra`: target matrix, run evidence, environment checks, SSH/Git
  routing and release orchestration.
