<!-- SPDX-License-Identifier: Apache-2.0 -->
# Linux VPS performance tuning (reference)

Moved from `aphrody-os/docs/vps_tuning.md`. This is a reference proposal, not an installed
configuration: the active host configuration lives under `tools/config/host/` (systemd, nginx, logrotate) and in the owning
service catalog (`tools/config/service-catalog.json`, `tools/config/production-topology.json`). Host roles,
addresses and ports are defined there and are deliberately not repeated here.

## 1. Operating System & Kernel Tuning (`/etc/sysctl.d/99-aphrody-vps.conf`)

Apply these settings to `/etc/sysctl.d/99-aphrody-vps.conf`:

```ini
# /etc/sysctl.d/99-aphrody-vps.conf
# ==============================================================================
# Production Kernel Tuning: Linux 6.8+ / 7.x on Ubuntu 24.04 / 26.04
# Optimized for OVH VPS (KVM/VirtIO, 4-16 vCPUs, 8-64 GB RAM)
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. NETWORK & TCP SUBSYSTEM OPTIMIZATION
# ------------------------------------------------------------------------------

# Packet Scheduler & Congestion Control (BBR + FQ)
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# TCP Fast Open: Enable for both client (1) and server (2) -> 3
net.ipv4.tcp_fastopen = 3

# Connection Acceptance & Backlog Limits
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 16384
net.core.netdev_max_backlog = 16384

# Socket Buffer Limits (Dynamic auto-tuning, max 16 MB)
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 262144
net.core.wmem_default = 262144
net.core.optmem_max = 2048576

# TCP Read & Write Memory: [min, default, max] in bytes
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# Connection Lifecycles & Ephemeral Ports
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.ip_local_port_range = 1024 65535

# TCP Protocol Features
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_dsack = 1
net.ipv4.tcp_fack = 1
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_syncookies = 1

# ------------------------------------------------------------------------------
# 2. VIRTUAL MEMORY & CACHE MANAGEMENT
# ------------------------------------------------------------------------------

# Prefer RAM, avoid swap latency spikes
vm.swappiness = 10

# Retain directory entries and inode cache in RAM
vm.vfs_cache_pressure = 50

# Smooth dirty page writeback to avoid KVM VirtIO I/O freeze
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10

# Max memory map areas for LanceDB, Bun, Chromium, and Rust allocators
vm.max_map_count = 1048576

# Ensure atomic memory headroom for network packet allocations
vm.min_free_kbytes = 65536

# Memory overcommit policy (1 = heuristic overcommit for vector DB / fork)
vm.overcommit_memory = 1

# ------------------------------------------------------------------------------
# 3. FILESYSTEM & OS DESCRIPTOR LIMITS
# ------------------------------------------------------------------------------

fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 8192
fs.pipe-max-size = 1048576
fs.aio-max-nr = 1048576

# ------------------------------------------------------------------------------
# 4. SECURITY BOUNDARIES & KERNEL HARDENING
# ------------------------------------------------------------------------------

# Restrict kernel pointer exposure
kernel.kptr_restrict = 2

# Restrict dmesg inspection to CAP_SYSLOG
kernel.dmesg_restrict = 1

# Block cross-process memory snooping (ptrace)
kernel.yama.ptrace_scope = 1

# eBPF JIT hardening (constant blinding) & restrict unprivileged BPF
net.core.bpf_jit_harden = 2
kernel.unprivileged_bpf_disabled = 1

# Spoofing protection (Reverse Path Filtering)
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Ignore ICMP redirects & source routing
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
```

Apply immediately:
```bash
sudo sysctl --system
```

Ensure the BBR module loads on reboot:
```bash
echo "tcp_bbr" | sudo tee /etc/modules-load.d/bbr.conf
sudo modprobe tcp_bbr
```

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
