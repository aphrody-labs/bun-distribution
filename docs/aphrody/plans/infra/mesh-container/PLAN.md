<!-- SPDX-License-Identifier: Apache-2.0 -->
# Four-host Aphrody container and persistent mesh

Owner request: 2026-10-09. Hosts: aphro-pc, omar, vps, dbfr.

Use the existing Aphrody Compose projects and image release owner. One host entrypoint coordinates Docker and the required native adapters. Docker owns container restarts. WireGuard and SSH remain host services; Windows screen capture requires the interactive session. No provider authentication, histories, domain databases or data packs are synchronized.

## Plan before apply

1. Verify SSH, current WireGuard keys, authenticated VNC, and Docker on all four hosts.
2. Reconcile the canonical service grants and Omar metadata. Preserve concurrent catalogue edits.
3. Implement a common supervisor with configured checkout/home paths, bounded commands, single-instance locking, exact child ownership and secret-free health receipts. Reuse Compose and native capture owners.
4. Validate meaningful supervisor failures, Windows child teardown, Compose plans and live screens before retiring replaced startup tasks.
5. Install one top-level Windows task and one VPS systemd entrypoint. Preserve underlying system services needed before logon. Back up replaced declarations and verify rollback first.
6. Deploy only qualified owned files and immutable images; commit and push after gates. Measure each host separately.

## TODO

- [x] Owner and Omar direct/reverse SSH and WireGuard verified.
- [x] Omar authenticated VNC; owner and VPS authenticated VNC verified.
- [ ] DBFR authenticated screen access (current VNC traffic is NATed to hub address, absent from allowlist).
- [ ] Start Omar Docker and verify image availability.
- [ ] Common supervisor implementation and gates.
- [ ] Four-host deployment and replaced-task retirement.
- [ ] Full service/container migration, reboot qualification and release parity.

Existing local/VPS/DBFR container health does not establish full Infra migration. Protected-data movement requires verified backups; graph/home profiles remain isolated.
