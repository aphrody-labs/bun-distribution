<!-- SPDX-License-Identifier: Apache-2.0 -->

# OVHcloud operations

This directory is the repository-side runbook for the OVHcloud services used
by Aphrody. It complements the reusable global OVH skill (if installed),
the native OVH engine (`crates/infra/ovh`), the SSH operator
(`crates/infra/ssh`) and the account and zone reference
[`docs/reference/infra/ops/OVH.md`](../../../reference/infra/ops/OVH.md). Restored from the retired `aphrody` monolith
(`docs/aphrody-os/ovh/README.md` (not in repo)).

## Scope

The normal workflow is read-only discovery followed by a reviewed, reversible
change. It covers:

- OVHcloud Manager and API inventory;
- domain and DNS-zone state, records, history, and propagation;
- VPS status, datacenter, IP inventory, backups, monitoring, disk, memory, and
  failed services;
- associated email and subscription service status;
- non-interactive SSH checks and local JSON output.

When a task says to skip security, exclude account 2FA, IP restrictions,
passwords, API tokens, IAM/security pages, firewall policy, and server
hardening. Do not silently re-enable that scope.

## Current service map

Historical Manager inventory observed during the September 2026 audit:

- one active VPS service, named `rg`, in Strasbourg SBG6, on the VPS-4 2026
  plan. Its service name and address are not recorded here: the target is the
  `vps` entry of `yolo/tools/config/host/inventory/targets.json` and
  `aphrody-infra ovh vps list` prints the live inventory;
- the `aphrody.com` domain and DNS zone;
- DNS and mail services associated with `aphrody.com` (`rpbey.fr` was sold — operator decision,
  docs/PLAN.md — and is no longer an associated service);
- one active Zimbra organisation and an active MX Plan surface;
- no active Web Cloud database service and no pending domain operations.

This inventory is historical evidence, not live state. Re-query the Manager
for current ownership and status. Do not assume that a domain listed as an
associated service is manageable from the current account.

## Local commands

From the `aphrody-infra` repository root:

```powershell
aphrody-infra ovh profiles
aphrody-infra ovh vps list
aphrody-infra ssh --json status --host vps
aphrody-infra ssh --json exec --host vps --cmd "free -h && df -h / && systemctl --failed --no-pager"
```

When running the checkout version that is not installed, use
`scripts/build/rust/cargo-serial.sh run -p aphrody-infra -- <arguments>`.
There is no root `ovh:status` Bun script, and the Rust crate package names are
`aphrody-infra` (which includes the SSH and OVH subcommands), not standalone
`aphrody-ssh`/`aphrody-ovh` packages.

The OVH package reads only its fixed profile credential sources and allowlisted
keys. Never print those files or place credentials in this documentation.
The API client is intentionally read-only for the inventory helpers; an API
permission denial must be resolved as a separately scoped access change.

Before a remote mutation, verify the live route and connectivity:

```powershell
ssh -G ovh-vps
ssh -G dbfr
aphrody-infra ssh --json status --host vps
```

The `ovh-vps` CLI selector maps to the local OpenSSH alias `vps`. Do not use
the legacy `vps-tunnel` route.

## DNS procedure

1. Export or inspect the current zone and its history before editing.
2. Verify the active nameservers and whether the zone is managed at OVHcloud.
3. Compare each proposed A, AAAA, CNAME, MX, TXT, or SRV change with the
   service it is intended to serve.
4. Apply only the exact reviewed record change; never reset or import a whole
   zone as an optimisation shortcut.
5. Re-check the Manager status and public DNS after the change. Allow for DNS
   propagation, which may take up to 24 hours.

Use the official [DNS configuration guide](https://help.ovhcloud.com/csm/en-gb-documentation-web-cloud-domains-dns-configuration?id=kb_browse_cat&kb_category=3733f35841f8fa104a4e42ace3ea4ea3&kb_id=e17b4f25551974502d4c6e78b7421955)
and [DNS history guide](https://help.ovhcloud.com/csm/en-au-dns-zone-history?id=kb_article_view&sysparm_article=KB0061043)
for current Manager behavior.

## VPS procedure

Check the service state, plan, datacenter, backups, monitoring, disk, memory,
failed units, timers, and top processes before proposing maintenance. Interpret
Linux memory using `available`, not only `used`; reconcile dashboard sampling
with SSH output before restarting anything.

During the September 2026 audit (before the 2026-09-22 reset recorded in
`yolo/tools/config/host/inventory/vps-source.json`), the VPS had recent automated backup points and no
failed systemd units. Its root filesystem was at approximately 92% usage. The largest
identified consumers were build output under `niers/target`, `niers/var`, and
the Steam data cache. These are candidates for an explicit cleanup plan, not
automatic deletion: active workspaces, build artifacts, and user data must be
classified first.

Use the official [VPS backup documentation](https://help.ovhcloud.com/csm/en-in-documentation-bare-metal-cloud-virtual-private-configuration-servers-backups?id=kb_browse_cat&kb_category=a360ab93747c32d0476bcec9d71e90d2&kb_id=203c4f65551974502d4c6e78b7421996)
when evaluating snapshots or automated backups.

## Change gates

Do not execute a deletion, zone reset/import, nameserver change, reboot,
reinstall, restore, subscription cancellation, upgrade, renewal, or payment
action from a generic “optimise” request. Record the exact target, expected
effect, rollback, and verification command, then obtain a dedicated approval
when the action has irreversible, financial, or service-disruption impact.

After every accepted change, capture the resulting Manager/API/SSH state and
note asynchronous tasks or DNS propagation still in progress. Keep this
directory free of secrets, personal contact data, tokens, and raw account
exports.
