<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS observation — 2026-10-02

Read-only inspection of the production VPS through the configured `vps` SSH
alias. This is a point-in-time host observation; it does not certify application
endpoints, database integrity, backups, or release reproducibility.

## Host state

- `aphrody-ssh audit --host vps --json`: **Healthy**; no failed units, no
  zombies, root filesystem at 57%, RAM at 35.9%, swap at 2.5%. Nginx, SSH,
  Docker and systemd-journald were active.
- `systemctl list-units --type=service --state=running --no-legend --plain`:
  28 running services and `systemctl --failed --no-legend --plain` returned no
  failed units.
- Running product units included `aphrody-discord-dev.service`;
  `rg-achillea-bot.service`, `rg-api.service`, `rg-bot.service`,
  `rg-cron.service`, `rg-website.service`; and `shenron-bot.service`,
  `shenron-pg-tunnel.service`, `shenron-site.service`.
- `postgresql@18-main.service` and `redis-server.service` were running.
- `rg-sauvegarde.timer`, `rg-infra-monitor.timer`, and
  `shenron-backup.timer` appeared in the active timer listing. This direct
  `systemctl list-timers` observation is authoritative for those timers; the
  prior source-backed service-status probe mapped timer catalog entries to
  their associated `.service` units and therefore returned false negatives.
- `/srv/rg/current` resolved to release
  `5691ba4be97b94279878e00d264793c1b28f8cf1`; `/srv/shenron/current` resolved
  to release `4cac743f`.
- `/srv/aphrody/current` and `/srv/aphrody-infra/current` did not exist at
  observation time. This agrees with the absence of Aphrody stack units from
  the running-unit list; it does not establish that every Aphrody endpoint is
  retired or that data was removed.

## Limits and stale local probes

The installed `~/.local/bin/aphrody-infra` returned all catalogued services as
inactive, including `rg-website`; a direct read-only
`aphrody-ssh exec --host vps -- systemctl is-active rg-website.service` returned
`active`. The installed binary/catalog view is stale. Building and running the
current checkout's CLI correctly reported `rg-website` active, but source
review found `get_service_statuses` maps catalog `.timer` units to `.service`
before checking them. The status path now queries the catalogued timer itself;
a fresh source-built query reported `shenron-backup.timer` and
`rg-infra-monitor.timer` active. Lifecycle actions still address the associated
service as intended. This CLI reports only catalog entries, not all host units,
and service-manager state is not application readiness.

The generic VPS audit checks host resources and selected base units only. A
running systemd unit is not an HTTP readiness check. No product health endpoint
was called in this observation, and no host or release state was changed.

## Reproduction commands

```bash
aphrody-ssh audit --host vps --json
aphrody-ssh exec --host vps -- systemctl list-units --type=service --state=running --no-legend --plain
aphrody-ssh exec --host vps -- systemctl --failed --no-legend --plain
aphrody-ssh exec --host vps -- readlink -f /srv/rg/current
aphrody-ssh exec --host vps -- readlink -f /srv/shenron/current
```

Related authorities: [Infra plan](../../plans/infra/PLAN.md), [immutable
release runbook](./IMMUTABLE-RELEASES.md), [service catalogue](../../../config/service-catalog.json),
and production target inventory (`yolo/config/host/inventory/targets.json`).
