# RG immutable release contract

The control plane activates RG from one directory directly below
`/srv/rg/releases/` and switches `/srv/rg/current` (live since 2026-09-25:
release `5691ba4b`). RG is assembled on the VPS itself by
`scripts/rg/assemble-vps-release.sh FULL_SHA` (from `../rg` checked
out at that commit, with the Next standalone build under Node 22 in Docker and
the host-only `/etc` build environment); the all-in-one bundle only pins the RG
commit (`rg/release.json`). The VPS adapters are installed from this
repository with `sudo bash scripts/install-vps-adapter.sh`, which installs the
four adapters (`aphrody-infra-deploy-{aphrody,shenron,rg,bundle}`), the
service, route and secrets catalog snapshots and `ADAPTER.json` (infra commit
and hashes). Reinstall after changing any adapter or catalog.

The release must contain `apps/`, `packages/`, `systemd/<unit>` for every
catalog service whose ID starts with `rg-`, whose unit is a `.service` and
which is not `"status": "retired"` (timers stay host-owned; retired services
such as `rg-cdn`, `rg-storage` and `rg-realtime`, absorbed in-process by
`rg-api`, keep their catalog entry and unit template but are never shipped or
started), `nginx/rg.conf` (not in repo), `RELEASE_SHA`, `SHA256SUMS`, and `release.json`.
`SHA256SUMS` must cover the manifest, provenance file, every unit and the Nginx
config. The manifest contains no secrets and has this shape:

```json
{
  "schemaVersion": 1,
  "repository": "rg",
  "commit": "1111111111111111111111111111111111111111",
  "builtAt": "2026-09-23T00:00:00Z",
  "services": ["rg-website", "rg-api", "rg-bot", "rg-achillea-bot", "rg-cron"]
}
```

`services` must exactly match the installed catalog's ordered RG roster; the
example is the roster of 2026-09-26. The release SHA must equal `commit`. RG
units must run from `/srv/rg/current`; the native PostgREST unit is exempt from
that path. Every other unit must declare at least one external
`EnvironmentFile` under `/etc`, already provisioned with mode `0600`. The
adapter rejects references to `../rg`.

The packaged Nginx file must include a `server_name` for every cataloged,
non-retired RG public host. Set `probePath` on a route when its public path
differs from the service's loopback health path, such as `/rest/v1/` for
Supabase REST. The adapter verifies each service on loopback, then installs the
Nginx file, checks and reloads Nginx, and probes the HTTPS routes through
`127.0.0.1`. If any step fails, it restores the previous release pointer,
units, service states and Nginx config. A first activation on a VPS with no RG
units or pointer is supported. Rollback copies contain only those small config
files; successful activation removes them.

Plan from the infra checkout:

```bash
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- deploy --target vps --stack rg --release /srv/rg/releases/RELEASE_ID
```

Apply only after the artifact, `/etc` environment files, TLS certificates and
local smoke are ready:

```bash
scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- deploy --target vps --stack rg --release /srv/rg/releases/RELEASE_ID --apply
```

Inside the all-in-one bundle RG is the last step (`--stack bundle`, see
[`IMMUTABLE-RELEASES.md`](./IMMUTABLE-RELEASES.md)); the bundle adapter refuses
to start unless `/srv/rg/releases/<pinned sha>` exists. Consult the current
CLI help for supported stack defaults. RG local adapter checks
run with `bash scripts/test-atomic-deploy-rg.sh` on Linux or WSL as root (all
three adapter fixtures can be invoked with `bash scripts/test-atomic-deploy-<stack>.sh`);
the test replaces systemd, Nginx and
curl with temporary stubs.
