<!-- SPDX-License-Identifier: Apache-2.0 -->

# Discord Systemd Services & Autonomous Native Binaries

This operational guide details the architecture, configuration, and maintenance of systemd service units for Aphrody Discord bots (`shenron-bot.service` and `rg-bot.service`).

---

## 1. Zero-Dependency Host Architecture

Historically, Aphrody Discord bots required:
1. A global or user-installed Bun runtime (`~/.bun/bin/bun`).
2. A populated `node_modules` directory deployed on the production VPS for each release.
3. Node/Bun environment variables for module transpilation and decorator handling.

With the introduction of `aphrody-discord-compiler` and AOT standalone compilation (`bun build --compile`), both bots are compiled into self-contained ELF executable binaries:
- `shenron:apps/bot/dist/shenron` (~151.6 MB)
- `apps/rg/bot/dist/rg-bot` (not in repo) (~144.9 MB)

### Operational Benefits

- **Zero Host Runtime Dependency**: Neither Node.js nor Bun is required on the production host.
- **Zero `node_modules` on Production VPS**: Eliminates tens of thousands of files from VPS releases, dramatically speeding up atomic release deployments.
- **Fast Startup & Deterministic Memory**: The standalone binary boots in under 50 ms and operates with consistent memory usage.
- **Immutable Executables**: Eliminates potential runtime file drift, monkey patching, or missing dependencies.

---

## 2. Updated Systemd Service Units

The systemd units in the repository (`tools/config/host/systemd/shenron/shenron-bot.service` and `iecode/config/rg/host/systemd/rg-bot.service`) have been updated to target the autonomous native binaries directly.

### 2.1 `tools/config/host/systemd/shenron/shenron-bot.service`

```ini
[Unit]
Description=Shenron — bot Discord DBZ + API publique (Standalone Binary, port 5006)
After=network-online.target shenron-pg-tunnel.service
Wants=network-online.target shenron-pg-tunnel.service
StartLimitBurst=20
StartLimitIntervalSec=600

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/apps/shenron/current/apps/bot

EnvironmentFile=-/etc/rose-griffon/shenron-bot.env
EnvironmentFile=-/etc/aphrody/shenron-compute-client.env
Environment=NODE_ENV=production
Environment=API_HOST=127.0.0.1
Environment=API_PORT=5006
Environment=PORT=5006
Environment=A2A_COORD_DIR=/home/ubuntu/apps/shenron/shared/coord
Environment=UV_THREADPOOL_SIZE=12

# Binaire natif autonome compilé via `aphrody discord compile shenron`
# Aucun runtime Bun ni répertoire node_modules n'est requis sur l'hôte.
ExecStart=/home/ubuntu/apps/shenron/current/apps/bot/dist/shenron

ExecStop=/bin/kill -SIGTERM $MAINPID
TimeoutStopSec=30
KillMode=mixed
KillSignal=SIGTERM
SuccessExitStatus=143

Restart=always
RestartSec=5

# Limites de ressources
MemoryAccounting=true
MemoryLow=1G
MemoryHigh=10G
MemoryMax=12G
MemorySwapMax=2G
LimitNOFILE=131072
OOMScoreAdjust=-500
CPUWeight=200
IOWeight=200

# Durcissement de sécurité
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
RestrictNamespaces=true
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@obsolete @privileged

ExecStartPre=+/bin/mkdir -p /home/ubuntu/apps/shenron/shared/bot/data /home/ubuntu/apps/shenron/shared/bot/assets /home/ubuntu/apps/shenron/shared/site/wiki /home/ubuntu/apps/shenron/shared/coord
ReadWritePaths=/home/ubuntu/apps/shenron/shared/bot/data /home/ubuntu/apps/shenron/shared/bot /home/ubuntu/apps/shenron/shared/site/wiki /home/ubuntu/apps/shenron/shared/coord

StandardOutput=journal
StandardError=journal
SyslogIdentifier=shenron-bot

[Install]
WantedBy=multi-user.target
```

### 2.2 `iecode/config/rg/host/systemd/rg-bot.service`

```ini
[Unit]
Description=Rose Griffon Discord Bot (Standalone Binary — slash commands)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/apps/rg/current/apps/bot

EnvironmentFile=/etc/rose-griffon/rg-bot.env
Environment=NODE_ENV=production
Environment=BOT_SYNC_MEMBRES=0
Environment=RG_DISCORD_SYNC_SQLITE_PATH=/home/ubuntu/apps/rg/shared/discord-sync/discord.db
Environment=RG_DISCORD_SYNC_REDIS_URL=redis://127.0.0.1:6379
Environment=WEBSITE_URL=https://rosegriffon.fr
Environment=WEBSITE_API_URL=https://rosegriffon.fr

# Binaire natif autonome compilé via `aphrody discord compile rg`
# Aucun runtime Bun ni répertoire node_modules n'est requis sur l'hôte ; le binaire AOT
# embarque le runtime Bun et résout reflect-metadata et tsconfig à l'avance.
ExecStart=/home/ubuntu/apps/rg/current/apps/bot/dist/rg-bot

Restart=always
RestartSec=5s
TimeoutStopSec=15s
KillMode=mixed
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rg-bot

# Limites de ressources
LimitNOFILE=131072
TasksMax=512
MemoryMax=2G
MemoryHigh=1G
MemoryLow=256M
MemorySwapMax=512M
CPUWeight=200
IOWeight=200
OOMScoreAdjust=-300

# Durcissement
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/ubuntu/apps/rg/shared/bot /home/ubuntu/apps/rg/shared/discord-sync /tmp
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
NoNewPrivileges=true
ProcSubset=pid
ProtectProc=invisible
RemoveIPC=true
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallFilter=@system-service
SystemCallFilter=~@obsolete @privileged

[Install]
WantedBy=multi-user.target
```

---

## 3. Sandboxing & Security Highlights

Both unit files implement rigorous systemd security features:

1. **`ProtectSystem=strict`**:
   The entire host file system is mounted read-only for the bot processes. Only paths explicitly declared in `ReadWritePaths` (e.g. `/home/ubuntu/apps/shenron/shared/bot/data` for local SQLite caching) are writable.
2. **`MemoryDenyWriteExecute` Prohibited**:
   Notice that `MemoryDenyWriteExecute=true` is deliberately omitted because the embedded Bun engine uses JavaScriptCore (JSC) with JIT compilation, which requires writable and executable memory mappings.
3. **`LockPersonality=true` & `NoNewPrivileges=true`**:
   Prevents privilege escalation and prevents modifying the process execution domain.
4. **`OOMScoreAdjust`**:
   Adjusted to `-500` (Shenron) and `-300` (RG) so the Linux kernel out-of-memory killer prioritizes background jobs or batch scripts before killing the primary Discord bot daemons.

---

## 4. Deployment Procedures

### Step 1: Compilation in CI / Build Environment

Compile standalone binaries on a Linux x86_64 build runner:

```bash
# Compile and run smoke check
aphrody discord compile all --smoke
```

Verify that the binaries exist and respond cleanly:
```bash
shenron:apps/bot/dist/shenron --help
apps/rg/bot/dist/rg-bot --help
```

### Step 2: Deployment to Release Directory

Copy only the application release directory and compiled binary to the VPS target:

```bash
# Example atomic release directory layout:
/home/ubuntu/apps/shenron/releases/20261001-1ab9864e/
  ├── apps/
  │   └── bot/
  │       ├── dist/
  │       │   └── shenron    <-- Standalone binary (no node_modules needed!)
  │       ├── assets/
  │       └── package.json
```

### Step 3: Atomic Symlink Switch & Service Restart

```bash
# Update symlink to point to new release
ln -sfn /home/ubuntu/apps/shenron/releases/20261001-1ab9864e /home/ubuntu/apps/shenron/current

# Reload systemd configuration if service unit changed
sudo systemctl daemon-reload

# Restart the service cleanly
sudo systemctl restart shenron-bot.service

# Verify service is running
sudo systemctl status shenron-bot.service
```

### Step 4: Verification & Log Inspection

Verify via journald:
```bash
sudo journalctl -u shenron-bot.service -n 50 --no-pager
```

Expect a clean boot log from `@aphrody/discord-kit` indicating registered commands, preflight intent confirmation, and gateway connection readiness.
