# OVH VPS Integration Testing — Aphrody Infra (2026-10-05)

## Changes Made

This integration implements VPS health monitoring, expiration detection, and policy enforcement
for the Aphrody infrastructure. All changes are **not yet committed**; the integrator will test
and commit them.

### Files Modified

**Rust sources**:
- `crates/infra/ovh/Cargo.toml`: Added `chrono` dependency.
- `crates/infra/ovh/src/vps.rs`: Added `VpsHealthStatus` struct, `days_until_expiration()`, `start()`, `set_delete_at_expiration()`, and 5 unit tests.
- `crates/infra/ovh/src/lib.rs`: Added `Start`, `SetDeleteAtExpiration`, `Watch` subcommands; CLI implementation; integration test for parse argument combinations.

**Configuration**:
- `tools/config/host/host-policy.toml`: Added `[billing]` section with VPS policy (renewal, expiration thresholds).
- `tools/config/host/systemd/aphrody/aphrody-ovh-watch.timer`: Daily health check timer (07h00 UTC).
- `tools/config/host/systemd/aphrody/aphrody-ovh-watch.service`: Health check service unit (read-only, journals to systemd-journald).

**Documentation**:
- `docs/operations/infra/OVH-VPS-OPERATIONS.md`: Complete runbook (incidents, commands, policy, troubleshooting).
- This file.

### New Commands

```bash
# Start a stopped VPS (requires --apply).
aphrody ovh vps start <service_name> [--apply]

# Manage deleteAtExpiration flag (preserve VPS beyond expiration or enable auto-delete).
aphrody ovh vps set-delete-at-expiration <service_name> --preserve|--delete [--apply]

# Check VPS health: exit 0 if all healthy, 1 if alerts, 2 if error.
# Checks: expiration < 14 days, deleteAtExpiration=true, stopped state, manual renewal.
aphrody ovh vps watch [<service_name>] [--alerts-only] [--notify]
```

### Test Results

**Unit tests**: All 13 tests pass (5 new VPS health tests, 8 existing OVH/DNS tests).

```
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured
```

Run tests:
```bash
cargo test -p aphrody-ovh --lib
```

**Cargo check**: Compilation successful, all dependencies resolved.

```bash
cargo check -p aphrody-ovh
```

## Integrator Verification Checklist

### 1. Compile and test (local or VPS tunnel)

```bash
# Option A: Local (if WSL can run small Cargo checks)
cargo fmt -p aphrody-ovh
cargo test -p aphrody-ovh --lib

# Option B: VPS tunnel (preferred; uses remote Cargo factory)
bun scripts/build/rust/vps-cargo.ts run -- \
  cargo test -p aphrody-ovh --lib --all-targets -- -D warnings

# Option C: After renewal, run on the actual VPS (if setup complete)
ssh ubuntu@51.77.147.152
cd /home/ubuntu/apps/aphrody
cargo test -p aphrody-ovh --lib --all-targets
```

### 2. Verify CLI argument parsing

```bash
# Help text for new commands
aphrody ovh vps start --help
aphrody ovh vps set-delete-at-expiration --help
aphrody ovh vps watch --help

# Dry-run (no network calls, no API side effects)
aphrody ovh vps start vps-203bea89
aphrody ovh vps set-delete-at-expiration vps-203bea89 --preserve
aphrody ovh vps watch
```

Expected:
- `aphrody ovh vps start <name>` prints plan message.
- `aphrody ovh vps set-delete-at-expiration` without `--preserve` or `--delete` exits with error.
- `aphrody ovh vps watch` lists all VPS and their health.

### 3. Verify policy configuration

Check the new `[billing]` section in `tools/config/host/host-policy.toml`:

```bash
rg '\[billing\]' tools/config/host/host-policy.toml -A 5
```

Expected output:
```
[billing]
# OVH VPS service policy: renewal, expiration alerts.
# `aphrody ovh services watch` (every service) and `aphrody ovh vps watch` check against these
# thresholds daily (systemd timer aphrody-ovh-watch).
vps_renewal = "automatic"
vps_delete_at_expiration = false
vps_alert_threshold_days = 14
```

### 4. Verify systemd units (on VPS, after renewal)

Copy units to VPS and check they're active:

```bash
# On the VPS:
sudo cp tools/config/host/systemd/aphrody/aphrody-ovh-watch.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable aphrody-ovh-watch.timer
sudo systemctl start aphrody-ovh-watch.timer

# Verify
sudo systemctl list-timers aphrody-ovh-watch.timer
sudo systemctl status aphrody-ovh-watch.service

# Check recent logs
sudo journalctl -u aphrody-ovh-watch.service -n 20
```

### 5. Verify documentation link

Check that the runbook is complete and links are valid:

```bash
# Verify file exists and is readable
file docs/operations/infra/OVH-VPS-OPERATIONS.md
wc -l docs/operations/infra/OVH-VPS-OPERATIONS.md

# Check for dead links (future gate; not yet implemented)
# aphrody-infra quality docs --repo aphrody
```

## API Endpoints Verified (Read-Only)

The implementation uses only read-only OVH API endpoints for health checks:

| Endpoint | Method | Used By |
|----------|--------|---------|
| `/vps` | GET | `list`, `watch` (enumerate all VPS). |
| `/vps/{serviceName}` | GET | `info`, `watch` (get state). |
| `/vps/{serviceName}/serviceInfos` | GET | `billing`, `watch` (get expiration, renewal flags, service ID). |

Mutating endpoints (not used without `--apply`):
| Endpoint | Method | Used By | Gate |
|----------|--------|---------|------|
| `/vps/{serviceName}/start` | POST | `start` | `--apply` required. |
| `/vps/{serviceName}/serviceInfos` | PUT | `set-delete-at-expiration` | `--apply` required. |
| `/vps/{serviceName}/reboot` | POST | `reboot` | `--apply` required. |
| `/service/{serviceId}/renew` | POST | `renew` | `--apply --pay` required. |
| `/me/order/{orderId}/pay` | POST | `renew --pay` | `--apply --pay` required. |

All mutating calls are guarded by explicit `--apply` flags and print plan messages before execution.

## Code Quality Checks

### Lint and Format

```bash
# Check linting (via oxlint if available; else Clippy)
cargo fmt -p aphrody-ovh
cargo clippy -p aphrody-ovh --all-targets -- -D warnings

# Verify no trailing whitespace, consistent formatting
oxlint crates/infra/ovh/src/*.rs
oxfmt crates/infra/ovh/src/*.rs --check
```

### Documentation Coverage

All new public types and functions have doc comments:

- `VpsHealthStatus`: struct with field documentation.
- `VpsHealthStatus::new()`: Creates a health report with thresholds.
- `VpsManager::start()`: Starts a stopped VPS.
- `VpsManager::set_delete_at_expiration()`: Updates renewal flags.

Run doc tests (if any):
```bash
cargo test --doc -p aphrody-ovh
```

## Deployment Sequence (Integrator)

Once tested:

1. **Commit the changes**:
   ```bash
   git add crates/infra/ovh/Cargo.toml crates/infra/ovh/src/
   git add tools/config/host/host-policy.toml tools/config/host/systemd/aphrody/aphrody-ovh-watch.*
   git add docs/operations/infra/OVH-VPS-OPERATIONS.md
   git commit -m "feat(ovh): Add VPS health monitoring, expiration alerts, and policy enforcement"
   ```

2. **Build and test on VPS** (after renewal):
   ```bash
   bun scripts/build/rust/vps-cargo.ts run -- \
     cargo test -p aphrody-ovh --all-targets && \
     cargo test -p aphrody-infra --all-targets
   ```

3. **Deploy systemd units** (on the actual VPS):
   ```bash
   aphrody-infra ssh exec --host vps -- \
     'sudo cp /home/ubuntu/apps/aphrody/tools/config/host/systemd/aphrody/aphrody-ovh-watch.* /etc/systemd/system/ && \
      sudo systemctl daemon-reload && \
      sudo systemctl enable aphrody-ovh-watch.timer && \
      sudo systemctl start aphrody-ovh-watch.timer'
   ```

4. **Verify on VPS**:
   ```bash
   aphrody-infra ssh exec --host vps -- \
     'sudo systemctl list-timers aphrody-ovh-watch.timer && \
      sudo journalctl -u aphrody-ovh-watch.service -n 5'
   ```

5. **Push to remote**:
   ```bash
   git push origin main
   ```

## Known Limitations and Future Work

1. **`--notify` flag**: Currently prints a placeholder message. Integration with `aphrody notify` (channels, templates) is deferred.

2. **VPS start / set-delete-at-expiration**: API endpoints verified but not tested live (requires active, non-expired VPS). Calls will fail if VPS is expired.

3. **Automatic renewal**: Policy declares intent; no autonomous renewal agent is implemented. Health checks alert when < 14 days to expiration; renewal must be triggered manually via `aphrody ovh vps renew … --apply --pay`.

4. **Per-VPS thresholds**: Alert thresholds are global (`vps_alert_threshold_days`). Individual VPS policies (e.g., "alert for infra-factory at 21 days, other VPS at 7 days") are not yet supported.

5. **Credential discovery**: Timer assumes OVH credentials are available on the VPS (via environment variables or credential file in user home). If credentials are WSL-local, the timer will fail.

## References

- **OVH API**: https://eu.api.ovh.com/console
- **Systemd Timer**: https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html
- **Aphrody Infra README**: `/home/aphro/aphrody/docs/products/infra/README.md`
- **Full OVH VPS Runbook**: `docs/operations/infra/OVH-VPS-OPERATIONS.md`
