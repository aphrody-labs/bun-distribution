<!-- SPDX-License-Identifier: Apache-2.0 -->
# Topology observation — 2026-10-02

Read-only observations for the WSL reference build host and DBFR production
data host, combined with the dated VPS observation in
[`VPS-STATUS-2026-10-02.md`](./VPS-STATUS-2026-10-02.md). These checks establish
host and service-manager state at observation time; they do not certify
application readiness, database integrity, backup restorability or public
endpoint behavior.

## WSL reference build host

- System and user `systemctl list-unit-files` searches for `shenron|rose|griffon`
  returned no matches. The corresponding unit files are absent from the
  system and user manager inventories.
- Nginx was inactive. `sites-available` contained only `default`,
  `sites-enabled` was empty, and no `/var/log/nginx/shenron-local.*` files were
  present.
- PostgreSQL 18/main still exists on the host but `pg_lsclusters` reported it
  DOWN. This proves the cluster was not running; it does not establish that its
  database files or data were erased or contain no production-derived data.
- No service or database mutation was performed in this observation.

## DBFR production data host

- The host audit reported PostgreSQL 18 (`postgresql@18-main`) and Redis
  (`redis-server`) active. Their configured listeners are loopback-only
  (`127.0.0.1:5432` and `127.0.0.1:6379`).
- `shenron-pg-backup.timer` and `shenron-sqlite-replica-backup.timer` appeared
  active in `systemctl list-timers`.
- Shenron bot/site application units were not observed running on DBFR. The
  generic host audit returned a warning for Docker/unknown unit state, while
  reporting no failed units or zombies. This should not be summarized as an
  entirely clean host audit.
- Timer activity does not prove a recent successful backup or a restorable
  artifact. Retention and integrity were not checked.

## Production responsibilities and listeners

The read-only host observations align with the documented split: VPS runs the
RG and Shenron application units behind Nginx, while DBFR runs PostgreSQL,
Redis and backup timers. The observed application listeners were loopback
bound. VPS also had UDP listeners on ports 443, 1034 and 9155; their process
ownership was not established here. Therefore this record does not claim that
Nginx is the only public socket or that all public UDP traffic is absent.

The current `config/production-topology.json` declares VPS public ports 80/443,
DBFR no public ports, and WSL role `reference-build-and-test` with
`production-database` and `public-runtime` forbidden. Its port policy says only
Nginx 80/443 should be public. This is declared policy; the observed extra UDP
listeners remain an unresolved runtime discrepancy. WSL's PostgreSQL cluster
being down matches the runtime restriction but does not prove its data has
been erased.

`yolo/config/host/nginx/routes.json` declares the active RG/Shenron upstreams as loopback
TCP: `rosegriffon.fr` → `127.0.0.1:3004`, `api.rosegriffon.fr` and
`cdn.rosegriffon.fr` → `127.0.0.1:8800`, `achillea.rosegriffon.fr` →
`127.0.0.1:4000`, `ranked.rosegriffon.fr` → `127.0.0.1:4002`,
`dragonballfr.com` → `127.0.0.1:5011`, and `bot.dragonballfr.com` →
`127.0.0.1:5006`. The catalog does not describe a general Bun migration to Unix
sockets; a Unix socket exists for the separate RG cron IPC. Bun's documented
server API supports Unix sockets, so the proposal is technically feasible,
but such a socket remains kernel IPC; it is not a zero-cost in-memory transfer.
Filesystem ownership and mode would need explicit setup, and any performance
claim needs measurement. Treat the proposed HTTP upstream socket migration as
future work.

Use the current root catalogs (`config/production-topology.json`,
`config/service-catalog.json`, `yolo/config/host/nginx/routes.json`) as declared intent;
use dated live observations for runtime state. Do not use archived split-repo
paths or old service inventories as current evidence.

## Architecture proposals from the supplied report

The supplied report overstated some implementation details. The current source
does contain a `SystemdSupervisor` trait, `VirtualSupervisor` alias and
`HostSystemdBackend` in `crates/os/systemd/src/manager.rs`, but the host backend
invokes the `systemctl` executable; it does not use zbus or call the systemd
D-Bus API directly. Rust `sd_notify` is implemented separately in
`crates/os/systemd/src/notify.rs` with `std::os::unix::net::UnixDatagram`,
including Linux abstract sockets and a Tokio watchdog loop. Bun notification
and priority logging are in `packages/os/kernel-client/src/systemd.ts`; its
socket calls use `bun:ffi` to load the platform C runtime, so this is not a
zero-C FFI implementation.

The typed Nginx AST, candidate syntax validation and hot-reload operation are
implemented in `crates/infra/infra/src/nginx.rs`. At the committed baseline,
reload used the platform `kill` command. The current working tree replaces
that call with `rustix::process::kill_process`; this edit is still uncommitted
and has not been qualified here. Neither state implements the proposed direct
zbus backend, and an AST/controller implementation does not prove that the
production Nginx configuration is generated from the AST or has been deployed.
Treat those deployment and qualification steps as open work.

Version-matched implementation references checked on 2026-10-02:
[systemd D-Bus API](https://wiki.freedesktop.org/www/Software/systemd/dbus/),
[systemd notification protocol](https://cgit.freedesktop.org/systemd/systemd/tree/man/sd_notify.xml),
[zbus proxy API](https://docs.rs/zbus/latest/zbus/attr.proxy.html),
[Bun HTTP server and Unix sockets](https://bun.sh/docs/runtime/http/server), and
[Nginx configuration control](https://nginx.org/en/docs/control.html). The
Rustix signal API is documented in the
[Rustix process module](https://docs.rs/rustix/latest/rustix/process/). These
references confirm upstream API support; they do not establish production
qualification in Aphrody.

Related authorities: [Infra plan](../../plans/infra/PLAN.md),
[`service-catalog.json`](../../../config/service-catalog.json),
[`production-topology.json`](../../../config/production-topology.json), and
`yolo/config/host/nginx/routes.json`.
