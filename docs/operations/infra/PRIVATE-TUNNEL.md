<!-- SPDX-License-Identifier: Apache-2.0 -->
# Private WireGuard tunnel and Omar administrator access

The owner authorized deployment on 2026-10-07. SSH and WireGuard are active on VPS,
DBFR and WSL; MCP/A2A proxy units remain declared and were not activated by this batch.
The original 2026-10-06 observation remains in
`config/host/inventory/private-tunnel-2026-10-06.json`.

## Verified activation on 2026-10-07

- Hub `51.77.147.152:51821`, VPN `10.200.77.1`; WSL `.2`, DBFR `.3`, Omar `.10`.
- VPS, DBFR and WSL have key-only `omar` accounts and validated root-owned sudoers.
  Real SSH sessions as `omar` from WSL to all three VPN addresses executed
  `sudo -n id -u` and returned `0`; existing host keys were checked strictly.
- VPS reports real WireGuard handshakes with WSL and DBFR. Omar's Windows peer is
  registered; its handshake remains zero until he activates his own private-key tunnel.
- Host private keys were generated on their own hosts, kept 0600, and never exported.
  The public hub key is `McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=`.
- Existing `wg0`, owner SSH access, databases, protected stores and foreign firewall rules remain.
  New rules admit private SSH to VPS/DBFR and route Omar SSH to WSL. No database ports
  were opened. The supplied shared SSH key is allowed from the authenticated VPN subnet
  as well as the declared public source; this allowed owner qualification from WSL `.2`.
- WSL required `wireguard-tools` and `openssh-server`; both were installed. Its SSH
  and `wg-quick@wg1` services, and both server VPN services, are enabled for boot.

Canonical fresh-install adapter: `python3 scripts/tools/apply-omar-private-access.py`
(plan), then `--apply`. It consumes the canonical generated plan, refuses an existing
interface/configuration and applies SSH/WireGuard only. An interrupted fresh install
requires inspecting the exact completed steps before continuing; do not remove keys
or reset a working tunnel to rerun it.

Omar keeps his own WireGuard private key and uses these public peer settings:

```ini
[Peer]
PublicKey = McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=
Endpoint = 51.77.147.152:51821
AllowedIPs = 10.200.77.0/24
PersistentKeepalive = 25
```

Set his existing tunnel interface address to `10.200.77.10/32`. SSH targets are
`omar@10.200.77.1` (VPS), `omar@10.200.77.3` (DBFR), and `omar@10.200.77.2` (WSL).
No replacement client private key is generated or provided.

## What is declared

| Piece | File |
| --- | --- |
| Tunnel (subnet, hub, peers, services, grants, firewall policy) | `config/host/wireguard/aphrody-tunnel.json` |
| Forwarders for the loopback services (template units, instance = port) | `config/host/systemd/aphrody/aphrody-wg-proxy@.{socket,service}` |
| `omar` account: key file (root-owned), sudoers drop-in, sshd drop-ins | `config/host/{ssh/omar.authorized_keys,sudoers/omar,ssh/omar-sshd.conf,ssh/postgres-no-login-sshd.conf}`, `accounts` in `config/host/catalog.json` |
| Generator, checks, plan | `packages/engine/core/src/host/wireguard.ts` (`wg-plan`, `wg-client`), tests in `packages/engine/core/test/host-wireguard.test.ts`, catalog checks in `checkCatalog` |

```sh
bun packages/engine/core/src/host/cli.ts check                      # catalog, tunnel and account checks
bun packages/engine/core/src/host/cli.ts wg-plan                    # the plan, nothing contacted
bun packages/engine/core/src/host/cli.ts wg-plan --observe          # + read-only preflight on vps, dbfr and the WSL
bun packages/engine/core/src/host/cli.ts wg-client omar             # client sections, no key
bun packages/engine/core/src/host/cli.ts wg-client omar --format paste --hub-public-key <K>
```

`wg-plan --observe` runs only `check`, `warn` and `info` steps of the preflight phase; a `mutate` step is never executed
(tested with a recording runner). The generated mutation steps are plain root shell text with public apply-time inputs
named in `needs`; the fresh-install adapter above executes the SSH/WireGuard subset.

## Network design

- **Interface `wg1`, subnet `10.200.77.0/24`, hub = vps, UDP 51821.** `wg0` is not usable: it is the live Shenron link
  (vps `10.8.0.1/24`, dbfr `10.8.0.3`, `51820/udp` open to the world) and ufw holds `Anywhere on wg0 ALLOW IN`
  ("acces complet aux services VPS") plus the Shenron admin trust of `10.8.0.0/24` (all ports, PostgreSQL `pg_hba`, MCP
  and site admin lists). A guest on `wg0` would inherit all of it. The new subnet overlaps nothing declared
  (`10.8.0.0/24`, Docker `172.16.0.0/12`, Mullvad `10.64.0.0/10`, CGNAT `100.64.0.0/10`, `192.168.0.0/16`, link-local; checked
  by `checkCatalog` and by `subnet-free` on each host).
- Addresses: hub `.1`, WSL `.2`, dbfr `.3`, aphro-pc `.4`, omar `.10`, all `/32` on the peers; the hub lists each peer with
  `AllowedIPs = <peer>/32`.
- **Split tunnel only.** Every client has `AllowedIPs = 10.200.77.0/24` (never `/0`, enforced by the check and the
  generator), no `DNS` line, `PersistentKeepalive = 25`, endpoint `51.77.147.152:51821`.
- **Keys.** Each private key is born on its own peer (`wg genkey` into a `0600` file on a host, the WireGuard app on
  Windows) and never enters the repository, the plan or a report; only public keys are declared. omar =
  `A42Sm27uwGBIkzPeTmK7yQxz24JDpM9h5jjeQyyjfzg=`, aphro-pc = `iM+MggQed48HpejJsIkhfR6yDBgwq2IkT1w6WDgWSgM=` (distinct).
  The key announced earlier for omar was withdrawn (private key lost) and appears nowhere. The hub, WSL and dbfr keys
  are generated at apply.
- **Routing.** The hub routes peer to peer (`ip_forward` is already 1; the apply persists it). No NAT, no `FORWARD`
  accept: forwarding is what the ufw `route` rules allow.

### Firewall and coordination with Shenron

- Rules carry the comment `aphrody-wg-<peer>`. `scripts/ops/admin-access.ts` (not in repo) (Shenron repository source) of Shenron only deletes rules whose comment is
  `shenron-admin`, and its host script skips every RFC 1918 address outside `10.8.0.`, so the tunnel subnet never enters
  ufw, fail2ban, `pg_hba`, `SHENRON_ADMIN_IPS` or `SHENRON_MCP_ALLOWED_IPS`. Nothing of Shenron is edited.
- UDP 51821 on the vps: one rule, `allow from 92.170.252.46 ... proto udp comment 'aphrody-wg-omar'` (Omar's address). No
  rule for the owner's workstation (WSL and Windows share its address) or for dbfr: both are already `shenron-admin`
  all-ports sources of the vps (verified 2026-10-06), refreshed every 15 minutes when the address changes, and the WireGuard
  key is the authentication. A second rule would duplicate Shenron's. The choice holds as long as that list keeps them;
  `wg-plan --observe` re-checks it (`vps.workstation-coverage`).
- Tunnel access: `allow in on wg1 from <peer> to 10.200.77.1 port P` for vps services, `route allow in on wg1 out on wg1
  from <peer> to <host> port P` for services of another peer. dbfr needs no ufw change (22/tcp is already open). Nothing is
  ever opened for `5432` or `6379`.

### Who reaches what

| Service | Where | omar | aphro-pc | wsl | How |
| --- | --- | --- | --- | --- | --- |
| ssh | vps `10.200.77.1:22` | yes | yes | yes | sshd listener |
| ssh | dbfr `10.200.77.3:22` | yes | yes | yes | routed by the hub |
| MCP HTTP | vps `10.200.77.1:8789` | yes | yes | yes | `aphrody-wg-proxy@8789` to `127.0.0.1:8789` |
| A2A | vps `10.200.77.1:8788` | yes | yes | yes | `aphrody-wg-proxy@8788` to `127.0.0.1:8788` |
| training | WSL `10.200.77.2` | pending | pending | n/a | ports not declared anywhere: no rule is generated until the owner names them |

`aphrody-wg-proxy@<port>` is a stock `systemd-socket-proxyd` behind a socket bound to the hub address only (`FreeBind`,
`IPAddressAllow=127.0.0.0/8 10.200.77.0/24`, `DynamicUser`, exposure 1.6 by `systemd-analyze security --offline`). The
loopback units of `aphrody-mcp-http` and `aphrody-a2a` stay untouched and loopback. Other internal services (8790 Shenron
MCP, 8798 gemma4, 8796, 8797) are not exposed: they belong to Shenron or to other lots, one grant line adds them.

## The `omar` account (vps and dbfr)

- `useradd` without password, no extra group (not in `sudo`, `adm`, `docker`, `postgres`), key-only: sshd drop-in
  `60-omar.conf` (`Match User omar`: `publickey` only, keys from the root-owned `/etc/ssh/authorized_keys.d/omar`, no
  forwarding, no tunnel, `GatewayPorts no`, `LogLevel VERBOSE` so the key fingerprint is journaled).
- The key line is `from="92.170.252.46,10.200.77.0/24",restrict,pty ssh-ed25519 ...`: his public address and his tunnel
  address (through the tunnel sshd sees `10.200.77.10`; only his WireGuard key can originate it). Dropping the second
  address forces the public path.
- **sudo**: `/etc/sudoers.d/omar`, one rule `omar ALL=(ALL:ALL) NOPASSWD: ALL` (no Unix password exists), validated by
  `visudo -c -f` before install. Journaling: both hosts run **sudo-rs** (`/usr/bin/sudo` is `/usr/lib/cargo/bin/sudo`
  0.2.13), which sends every command to syslog/journald (persistent on both hosts): `journalctl -t sudo | grep 'omar :'`.
  sudo-rs has no I/O log (`log_input`, `log_output`, `sudoreplay`); the classic `sudo.ws` is installed but not the default
  and is not switched here.
- **dbfr and postgres.** `omar` is in no postgres group, no ssh key exists for the postgres login, a dbfr-only drop-in
  adds `DenyUsers postgres`, `pg_hba.conf` and ufw have no entry for the tunnel subnet, nothing opens 5432 to the tunnel:
  the role is reachable by `sudo -u postgres` (journaled) only. Preflight checks cover each point.

## Findings that need the owner

1. **Shared ssh key (owner's choice, kept).** omar's key is the same pair as `~/.ssh/id_ed25519.pub` of the owner's PC
   (`SHA256:8G22L1q/zD3aUYPRqYNIuIQg7c0NWfofpXsaqZHuM/s`). sshd and sudo logs distinguish the two people only by the Unix
   login, never by key. **That public key is also a line of `/home/ubuntu/.ssh/authorized_keys` on dbfr** (observed
   2026-10-06; not on the vps): the holder of the private key can log in as `ubuntu` there (NOPASSWD sudo, no `from=`),
   which bypasses the omar restrictions, the per-user journal and the postgres sudo-only rule. Recommendation: a distinct
   key for omar, a one-line change of `ssh/omar.authorized_keys`. `wg-plan --observe` reports it (`key-not-on-other-logins`).
2. **`92.170.252.46` already holds a `shenron-admin` ufw rule** (all ports) on vps and dbfr, hence `pg_hba` scram reachability
   of dbfr:5432 from that address. That list is Shenron's (`~/.aphrody/private/shenron-admin-ips.json` or the account
   sessions): remove the address there for "no direct postgres access" to hold. The narrow `aphrody-wg-omar` rule keeps the
   tunnel working without it.
3. **MCP HTTP is unauthenticated** (`MCP-A2A.md`, finding 2): through the tunnel every tool, including `aphrody_mcp_call`, is
   open to the three granted peers. Port 8789 on the vps is also held today by the WSL compute reverse tunnel (sshd,
   `GatewayPorts yes`), so `10.200.77.1:8789` would reach the WSL MCP. `port-free.8789` fails until the owner frees or moves
   it. A2A runs in dry-run with no authentication layer.
4. **sudo-rs**: journal only, no session recording.
5. vps `sshd` keeps `PasswordAuthentication yes` and `PermitRootLogin yes` (`00-hardening.conf`): pre-existing, not changed
   here; omar is key-only through his `Match` block.
6. The installed `aphrody infra validate` cannot validate the catalog at this revision: `aphrody-creator` had no `unit`
   (fixed here with `unitSource: system-package`, `nginx.service`), and the route `creator.aphrody.com` uses a `static:`
   upstream that `crates/infra/infra/src/validate.rs` rejects ("upstream sans host:port"): open, a Rust change.

## Client side

The official WireGuard for Windows app **refuses to import a `.conf` that has no `PrivateKey`** (`conf/parser.go`: "An
interface must have a private key"), so a key-less file cannot be a one-click import and the key must be born in the app
("Add empty tunnel"). The generator therefore gives the sections, and a paste block that goes under the `PrivateKey` line
the app writes. Where a key file exists (the owner's PC), `--format conf --private-key-file F --out FILE` writes a complete
file, refused inside the checkout.

Client sections (no private key; `<HUB_PUBLIC_KEY>` is read on the vps after the apply with `sudo wg show wg1 public-key`):

```ini
# omar
[Interface]
Address = 10.200.77.10/32

[Peer]
PublicKey = <HUB_PUBLIC_KEY>
Endpoint = 51.77.147.152:51821
AllowedIPs = 10.200.77.0/24
PersistentKeepalive = 25
```

```ini
# aphro-pc
[Interface]
Address = 10.200.77.4/32

[Peer]
PublicKey = <HUB_PUBLIC_KEY>
Endpoint = 51.77.147.152:51821
AllowedIPs = 10.200.77.0/24
PersistentKeepalive = 25
```

### Guide pour Omar (5 lignes)

1. Installe l'application officielle WireGuard (wireguard.com/install) et ouvre-la.
2. Clique « Ajouter un tunnel » puis « Ajouter un tunnel vide... » : nomme-le `aphrody`.
3. Dans la fenêtre, garde les deux premières lignes (`[Interface]` et `PrivateKey = ...`) et colle sous elles le bloc de texte reçu (`aphrody-omar.txt`).
4. Clique « Enregistrer » puis « Activer » : le tunnel doit passer à « Actif ».
5. Pour couper : « Désactiver » ; ne partage jamais la ligne `PrivateKey`.

## Order, validation and rollback

`wg-plan` prints the sequence: owner's order, dbfr and WSL keygen, vps keygen and hub, ufw and forwarders, client start,
the `omar` account, Windows tunnels, verification. Each host has `verify` steps (interface up, UDP listening, forwarders
bound to the hub address only, handshakes, no ufw rule with an `Anywhere` source, effective `sshd -T -C user=omar`, `sudo -n
-l -U omar`, no direct postgres login) and one `rollback` step that removes only what this lot created (tunnel, units, the
`aphrody-wg` ufw rules, `omar` locked, grants removed; `wg0`, `shenron-admin` rules, the home directory and databases stay).
