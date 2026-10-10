<!-- SPDX-License-Identifier: Apache-2.0 -->

# Discord Operations Runbooks & Guides

This directory contains production runbooks and operating procedures for Discord bots deployed across the Aphrody infrastructure.

## Operational Documents

- [**Systemd Services and Autonomous Binary Deployment**](SYSTEMD-SERVICES.md):
  Detailed guide for running `@shenron/bot` and `@rosegriffon/bot` as standalone compiled native binaries (`dist/shenron` (not in repo) (generated or machine-local artifact; presence depends on the build host), `dist/rg-bot` (not in repo) (generated or machine-local artifact; presence depends on the build host)) under systemd without host Bun or `node_modules`.

## Key Operational Commands

### 1. Compilation & Smoke Testing

To compile production-ready native binaries before deployment:

```bash
# Compile both Shenron and RG binaries with smoke check
aphrody discord compile all --smoke

# Or via Bun script
bun run discord:compile all --smoke
```

Binaries are generated at:
- `shenron:apps/bot/dist/shenron`
- `apps/rg/bot/dist/rg-bot` (not in repo)

### 2. Pre-deployment Verification Gate

Always run the full verification gate before deploying:

```bash
bun run discord:verify --compile
```

### 3. Service Lifecycle on Production VPS

```bash
# Check service status
sudo systemctl status shenron-bot.service
sudo systemctl status rg-bot.service

# Restart services
sudo systemctl restart shenron-bot.service
sudo systemctl restart rg-bot.service

# Follow real-time logs in journald
sudo journalctl -u shenron-bot.service -f
sudo journalctl -u rg-bot.service -f
```
