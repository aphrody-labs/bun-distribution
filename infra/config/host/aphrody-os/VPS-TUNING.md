<!-- SPDX-License-Identifier: Apache-2.0 -->

# Linux VPS performance tuning (reference)

Moved from `aphrody-os/docs/vps_tuning.md`. This is a reference proposal, not an installed
configuration: the active host configuration lives under `tools/config/host/` (systemd, nginx, logrotate) and in the owning
service catalog (`tools/config/service-catalog.json`, `tools/config/production-topology.json`). Host roles,
addresses and ports are defined there and are deliberately not repeated here.

## 1. Operating System & Kernel Tuning (sysctl)

The sysctls are owned by the Aphrody Alpine package `aphrody-sysctl`
([aphrody-labs/aports](https://github.com/aphrody-labs/aports/tree/3.24-stable/aphrody/aphrody-sysctl),
branch `3.24-stable`):

- `90-aphrody-bun.conf` (package `aphrody-sysctl`): BBR + fq, TCP Fast Open, socket buffers,
  `vm.max_map_count`, overcommit, inotify, `fs.file-max`, `tcp_mtu_probing`; plus
  `/etc/modules-load.d/aphrody.conf` (`tcp_bbr`, `sch_fq`, ...).
- `aphrody-server.sysctl.conf`, installed as `/etc/sysctl.d/91-aphrody-server.conf` (sub-package
  `aphrody-sysctl-server`): the production VPS deltas on top of it (backlogs, default buffers,
  `tcp_fin_timeout`, `rp_filter`/redirects, `vm.swappiness = 10` without zram, `dirty_ratio`,
  `min_free_kbytes`, `aio-max-nr`, `kptr_restrict = 2`, BPF hardening).

On Aphrody Alpine: `apk add aphrody-sysctl-server`. On another distribution, copy both files to
`/etc/sysctl.d/` under the same names, then `sudo sysctl --system`.

---

## 2. File Descriptor & Security Limits

### PAM Limits (`/etc/security/limits.d/99-aphrody.conf`)

```ini
aphrody          soft    nofile          1048576
aphrody          hard    nofile          1048576
aphrody          soft    nproc           524288
aphrody          hard    nproc           524288
aphrody          soft    memlock         unlimited
aphrody          hard    memlock         unlimited

*                soft    nofile          1048576
*                hard    nofile          1048576
*                soft    nproc           524288
*                hard    nproc           524288
*                soft    memlock         unlimited
*                hard    memlock         unlimited
root             soft    nofile          1048576
root             hard    nofile          1048576
```

### systemd Global Limits (`/etc/systemd/system.conf.d/99-limits.conf`)

```ini
[Manager]
DefaultLimitNOFILE=1048576:1048576
DefaultLimitNPROC=524288:524288
DefaultLimitMEMLOCK=infinity
DefaultTasksMax=infinity
```

---

## 3. Ubuntu 26 systemd & Security Hardening

### `systemd-journald` Bounds (`/etc/systemd/journald.conf.d/99-aphrody.conf`)

```ini
[Journal]
Storage=persistent
Compress=yes
SystemMaxUse=1G
SystemKeepFree=2G
SystemMaxFileSize=128M
MaxRetentionSec=1month
RateLimitIntervalSec=30s
RateLimitBurst=10000
```

Restart with `sudo systemctl restart systemd-journald`.

### `systemd-oomd` Tuning (`/etc/systemd/oomd.conf.d/99-aphrody.conf`)

Prevent aggressive process terminations during heavy builds (`cargo`, `bun`):

```ini
[OOM]
SwapUsedLimit=90%
DefaultMemoryPressureLimit=75%
DefaultMemoryPressureDurationSec=30s
```

Restart with `sudo systemctl restart systemd-oomd`.

---

## 4. OVH VPS VirtIO Optimizations (KVM / OpenStack)

### Storage & Discard (TRIM)

- **Do NOT use `discard` in `/etc/fstab`:** Synchronous discard generates continuous UNMAP requests that stall the KVM virtual I/O queue and cause severe multi-second latency spikes.
- **Enable batch TRIM timer:**
  ```bash
  sudo systemctl enable --now fstrim.timer
  ```

### Storage Scheduler & Network Queue (`/etc/udev/rules.d/99-virtio.rules`)

```udev
# Set virtual disk I/O scheduler to none (bypass guest scheduling)
ACTION=="add|change", KERNEL=="vd[a-z]|sd[a-z]", ATTR{queue/scheduler}="none"
ACTION=="add|change", KERNEL=="vd[a-z]|sd[a-z]", ATTR{queue/read_ahead_kb}="256"

# Elevate network interface txqueuelen
ACTION=="add", SUBSYSTEM=="net", KERNEL=="eth*|ens*", ATTR{tx_queue_len}="10000"
```

### VirtIO Network Multi-Queue & Offloads

Configure active network queue to match the vCPU count:

```bash
PRIMARY_IFACE=$(ip route show default | awk '{print $5}' | head -n1)
MAX_QUEUES=$(ethtool -l "$PRIMARY_IFACE" 2>/dev/null | awk '/Combined:/{print $2}' | tail -n1 || echo "1")
if (( MAX_QUEUES > 1 )); then
  sudo ethtool -L "$PRIMARY_IFACE" combined "$MAX_QUEUES"
fi
```

### MTU Discipline

- **Public Interfaces (`eth0` / `ens3`):** Must strictly remain **1500 MTU**. OVH external gateways drop jumbo frames.
- **Path MTU Discovery Blackhole Protection:** `net.ipv4.tcp_mtu_probing = 1` handles downstream MTU bottlenecks seamlessly.
- **Private vRack Interfaces:** Set to **9000 MTU** only if configured across dedicated private subnets.

---

## 5. Transparent Hugepages (THP)

Accelerates vector search (LanceDB/HNSW) and local embedding models:

```bash
echo always | sudo tee /sys/kernel/mm/transparent_hugepage/enabled
echo always | sudo tee /sys/kernel/mm/transparent_hugepage/defrag
```

Ensure persistence via `GRUB_CMDLINE_LINUX_DEFAULT="... transparent_hugepage=always"` in `/etc/default/grub` followed by `sudo update-grub`.
