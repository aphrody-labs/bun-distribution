// SPDX-License-Identifier: Apache-2.0

const serverStartTime = Date.now();

/** Prototype data only: no native kernel, package install or signature verification. */
function simulatedJson(data: Record<string, unknown>): Response {
  const payload: Record<string, unknown> = {
    ...data,
    simulated: true,
    source: "webos-prototype",
    status: "simulation",
    signatureVerified: false,
  };
  for (const field of ["stdout", "result", "message"] as const) {
    if (typeof data[field] === "string") payload[field] = "[SIMULATION] " + data[field];
  }
  return Response.json(payload);
}

function hostAccessDenied(): Response {
  return Response.json(
    {
      status: "permission_denied",
      error:
        "Host access requires the native authenticated permission boundary; this prototype router has no such boundary.",
    },
    { status: 403 },
  );
}

export interface VfsEntry {
  name: string;
  type: "dir" | "file" | "socket" | "link";
  size: string;
  perms: string;
  modified: string;
  hash?: string;
  mime?: string;
  path?: string;
}

export interface ApkPackageInfo {
  name: string;
  version: string;
  description: string;
  installed: boolean;
  size: string;
  repo: string;
  signed: boolean;
}

// In-memory state for APK packages
let apkPackagesState: ApkPackageInfo[] = [
  {
    name: "bun",
    version: "1.4.3_p2-r0",
    description: "Fast all-in-one JavaScript runtime & native bundler",
    installed: true,
    size: "94.2 MB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "bun-shell",
    version: "1.4.3_p2-r0",
    description: "/bin/bunsh root login shell with elevate and elevate.rs integration",
    installed: true,
    size: "4.8 MB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "bun-apk",
    version: "1.0-r1",
    description: "Automatic trigger for npm modules and binary linking into /usr/lib/bun/bin",
    installed: true,
    size: "120 KB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "aphrody",
    version: "3.3.8-r0",
    description: "Unified Rust multicall binary & Bun monorepo CLI orchestrator",
    installed: true,
    size: "28.4 MB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "n2b",
    version: "0.7.1-r0",
    description: "Zero-configuration Node-to-Bun AST migration and transform engine",
    installed: true,
    size: "8.1 MB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "aphrody-libc",
    version: "0.1.0-r0",
    description: "SIMD leaf overlay for musl: memcmp, strlen, qsort (SSE2/NEON)",
    installed: true,
    size: "480 KB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "sudo-rs",
    version: "0.2.15-r1",
    description: "Memory-safe Rust implementation of sudo replacing GNU sudo/doas",
    installed: true,
    size: "1.9 MB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "aphrody-sysctl",
    version: "1.1-r0",
    description: "High-throughput kernel tunings (somaxconn=8192, BBR, max_map_count)",
    installed: true,
    size: "16 KB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "wireguard-tools",
    version: "1.0.2025-r0",
    description: "Tools for configuring WireGuard tunnels (wg, wg-quick)",
    installed: true,
    size: "180 KB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "llvm23",
    version: "23.1.3-r0",
    description: "Backported LLVM and Clang 23 toolchain from edge/main",
    installed: false,
    size: "410 MB",
    repo: "aphrody-3.24",
    signed: false,
  },
  {
    name: "rust-nightly",
    version: "2026.09.15-r0",
    description: "Pinned Rust compiler toolchain matching rust-toolchain.toml",
    installed: false,
    size: "640 MB",
    repo: "aphrody-3.24",
    signed: false,
  },
];

// In-memory state for sysctl settings
let sysctlSettingsState = [
  {
    key: "vm.max_map_count",
    value: "1048576",
    purpose: "Enables massive V8/JSC heaps and multi-threaded arena allocation",
  },
  {
    key: "vm.overcommit_memory",
    value: "1",
    purpose: "Strict zero-allocation overhead for rapid Bun worker spawns",
  },
  {
    key: "fs.inotify.max_user_watches",
    value: "1048576",
    purpose: "Allows monorepo-wide zero-lag file watcher scaling across 100k+ files",
  },
  {
    key: "fs.inotify.max_user_instances",
    value: "1024",
    purpose: "Concurrent watch handles for all packages and test runners",
  },
  {
    key: "net.core.somaxconn",
    value: "8192",
    purpose: "High-throughput TCP backlog for Bun.serve HTTP/WS microservers",
  },
  {
    key: "net.ipv4.tcp_fastopen",
    value: "3",
    purpose: "TCP Fast Open enabled for both incoming and outgoing client sockets",
  },
  {
    key: "net.core.default_qdisc",
    value: "fq",
    purpose: "Fair Queueing packet scheduler for microsecond network latency",
  },
  {
    key: "net.ipv4.tcp_congestion_control",
    value: "bbr",
    purpose: "BBR bottleneck bandwidth and round-trip propagation time",
  },
  {
    key: "net.core.rmem_max",
    value: "16777216",
    purpose: "16 MiB receive window buffer for high-bandwidth HTTP/3 QUIC",
  },
  {
    key: "net.core.wmem_max",
    value: "16777216",
    purpose: "16 MiB send window buffer for high-throughput streaming",
  },
  {
    key: "kernel.perf_event_paranoid",
    value: "1",
    purpose: "Allows user-space hardware performance counter profiling",
  },
  {
    key: "kernel.io_uring_disabled",
    value: "0",
    purpose: "io_uring kernel ring buffers unlocked for storage and networking",
  },
];

export async function handleOsRequest(req: Request, url: URL): Promise<Response | null> {
  // 1. Process & Command Execution: POST /api/os/exec
  if (url.pathname === "/api/os/exec" && req.method === "POST") {
    const t0 = performance.now();
    try {
      const body = await req.json();
      const rawCmd = (body.command || "").trim();

      if (!rawCmd) {
        return Response.json({ stdout: "", stderr: "Empty command", exitCode: 1, durationMs: 0 });
      }

      const parts = rawCmd.split(/\s+/);
      const bin = parts[0];
      const args = parts.slice(1);

      // Virtual Alpine OS commands
      if (bin === "uname") {
        const out = "Linux aphrody-alpine 6.18.55-aphrody-v3 #1 SMP PREEMPT_DYNAMIC x86_64 Linux\n";
        return simulatedJson({
          stdout: out,
          stderr: "",
          exitCode: 0,
          durationMs: Math.round(performance.now() - t0),
        });
      }

      if (bin === "cat") {
        const target = args[0] || "";
        if (target === "/etc/os-release") {
          const out = `NAME="Aphrody Alpine Linux"
ID=aphrody-alpine
VERSION_ID=3.24.2
PRETTY_NAME="Aphrody Alpine Linux v3.24 (musl + aphrody-libc)"
HOME_URL="https://github.com/aphrody-labs/aphrody"
BUG_REPORT_URL="https://github.com/aphrody-labs/aphrody/issues"
SHELL="/bin/bunsh"
ARCHITECTURE="x86_64"\n`;
          return simulatedJson({
            stdout: out,
            stderr: "",
            exitCode: 0,
            durationMs: Math.round(performance.now() - t0),
          });
        }
        if (target === "/etc/passwd") {
          const out = `root:x:0:0:root:/root:/bin/bunsh
bin:x:1:1:bin:/bin:/sbin/nologin
daemon:x:2:2:daemon:/sbin:/sbin/nologin
builder:x:1000:1000:builder:/home/builder:/bin/bunsh\n`;
          return simulatedJson({
            stdout: out,
            stderr: "",
            exitCode: 0,
            durationMs: Math.round(performance.now() - t0),
          });
        }
        if (target.includes("sysctl")) {
          const out = sysctlSettingsState.map((s) => `${s.key}=${s.value}`).join("\n") + "\n";
          return simulatedJson({
            stdout: out,
            stderr: "",
            exitCode: 0,
            durationMs: Math.round(performance.now() - t0),
          });
        }
        return hostAccessDenied();
      }

      if (bin === "dmesg") {
        const out = `[    0.000000] Linux version 6.18.55-aphrody-v3 (builder@aphrody-alpine) (clang 23.1.3, rustc 1.98.1) #1 SMP PREEMPT_DYNAMIC
[    0.000012] Kernel Rust runtime initialized: abstractions for PHY, DRM, NVMe enabled
[    0.012480] zswap: loaded using compressor zstd and zpool zsmalloc, ratio ~3.4:1
[    0.048120] HugeTLB: Transparent Huge Pages: madvise mode activated, defer split enabled
[    0.104230] aphrody-libc: registered SIMD leaf overrides (memcmp, strlen, qsort)
[    0.218490] ostd: TCB Minimal core loaded: ostd::backend, ostd::guard, ostd::proc verified
[    0.342110] SystemSubsystem: 15 first-party subsystems attached to kernel bus
[    0.512940] aphrody-sysctl: applied 90-aphrody-bun.conf: somaxconn=8192, bbr=on, max_map=1048576
[    0.684120] bunsh: root login shell set to /bin/bunsh (Aphrody Bun Shell with elevate)
[    0.891230] WireGuard: interface wg1 up: private overlay mesh active (10.42.0.3/24)
[    1.024500] aphrody-pc-agent: PC Agent daemon listening on /run/aphrody/agent.sock
[    1.240190] aphrody-kernel: Kernel RPC & MCP router ready on 127.0.0.1:8786\n`;
        return simulatedJson({
          stdout: out,
          stderr: "",
          exitCode: 0,
          durationMs: Math.round(performance.now() - t0),
        });
      }

      if (bin === "free") {
        const mem = process.memoryUsage();
        const out = `               total        used        free      shared  buff/cache   available
Mem:        32768000     ${Math.round(mem.rss / 1024)}    ${Math.round((32768000 * 1024 - mem.rss) / 1024)}      210000     2198000    28230000
Swap:        8388608      280000     8108608 (zswap zstd: 3.4x)\n`;
        return simulatedJson({
          stdout: out,
          stderr: "",
          exitCode: 0,
          durationMs: Math.round(performance.now() - t0),
        });
      }

      if (bin === "apk") {
        const sub = args[0] || "list";
        if (sub === "list" || sub === "search") {
          const lines = apkPackagesState.map(
            (p) =>
              `  ${p.name.padEnd(25)} [${p.installed ? "installed" : "available"}] ${p.description}`,
          );
          const out = `Prototype package catalog (signatures unverified) (repository: aphrody-3.24-x86_64, signer: aphrody-labs.rsa.pub):\n${lines.join("\n")}\n`;
          return simulatedJson({
            stdout: out,
            stderr: "",
            exitCode: 0,
            durationMs: Math.round(performance.now() - t0),
          });
        }
        if (sub === "info") {
          const pkgName = args[1] || "bun";
          const p = apkPackagesState.find((x) => x.name === pkgName) || apkPackagesState[0];
          const out = `${p.name} description:
  Version: ${p.version}
  Status: ${p.installed ? "installed" : "available"}
  Signer: unverified prototype label
  Arch: x86_64 (musl ABI)
  Installed-Size: ${p.size}
  Summary: ${p.description}\n`;
          return simulatedJson({
            stdout: out,
            stderr: "",
            exitCode: 0,
            durationMs: Math.round(performance.now() - t0),
          });
        }
        if (sub === "add") {
          const pkgName = args[1];
          if (pkgName) {
            apkPackagesState = apkPackagesState.map((p) =>
              p.name === pkgName ? { ...p, installed: true } : p,
            );
          }
          const out = `(1/1) Installing ${pkgName || "package"} (signature not verified; prototype only)...
Executing bun-apk.trigger...
OK: 28 packages installed in 38ms.\n`;
          return simulatedJson({
            stdout: out,
            stderr: "",
            exitCode: 0,
            durationMs: Math.round(performance.now() - t0),
          });
        }
      }

      // Host execution is unavailable without native authorization.
      return hostAccessDenied();
    } catch (err: any) {
      return Response.json({
        stdout: "",
        stderr: `Execution error: ${err.message}`,
        exitCode: 127,
        durationMs: Math.round(performance.now() - t0),
      });
    }
  }

  // 2. Spacedrive VFS Listing: GET /api/os/vfs/list
  if (url.pathname === "/api/os/vfs/list") {
    const queryPath = url.searchParams.get("path") || "/work";

    // Virtual Rootfs handling
    if (queryPath === "/") {
      const rootDirs = ["bin", "boot", "dev", "etc", "home", "lib", "proc", "sys", "var", "work"];
      const entries: VfsEntry[] = rootDirs.map((name) => ({
        name,
        type: "dir",
        size: "4.0 KB",
        perms: name === "proc" || name === "sys" ? "r-xr-xr-x" : "rwxr-xr-x",
        modified: new Date(serverStartTime).toISOString().slice(0, 16).replace("T", " "),
        path: `/${name}`,
      }));
      return simulatedJson({ path: "/", entries });
    }

    if (queryPath === "/etc") {
      const entries: VfsEntry[] = [
        {
          name: "os-release",
          type: "file",
          size: "280 B",
          perms: "rw-r--r--",
          modified: "2026-10-09 03:00",
          hash: "wy:a914c810",
          mime: "text/plain",
          path: "/etc/os-release",
        },
        {
          name: "passwd",
          type: "file",
          size: "194 B",
          perms: "rw-r--r--",
          modified: "2026-10-09 03:00",
          hash: "wy:11d04b82",
          mime: "text/plain",
          path: "/etc/passwd",
        },
        {
          name: "group",
          type: "file",
          size: "142 B",
          perms: "rw-r--r--",
          modified: "2026-10-09 03:00",
          hash: "wy:2088f1a0",
          mime: "text/plain",
          path: "/etc/group",
        },
        {
          name: "hostname",
          type: "file",
          size: "15 B",
          perms: "rw-r--r--",
          modified: "2026-10-09 03:00",
          hash: "wy:fa819201",
          mime: "text/plain",
          path: "/etc/hostname",
        },
        {
          name: "sysctl.d",
          type: "dir",
          size: "4.0 KB",
          perms: "rwxr-xr-x",
          modified: "2026-10-09 03:00",
          path: "/etc/sysctl.d",
        },
        {
          name: "apk",
          type: "dir",
          size: "4.0 KB",
          perms: "rwxr-xr-x",
          modified: "2026-10-09 03:00",
          path: "/etc/apk",
        },
      ];
      return simulatedJson({ path: "/etc", entries });
    }

    if (queryPath === "/etc/sysctl.d") {
      const entries: VfsEntry[] = [
        {
          name: "90-aphrody-bun.conf",
          type: "file",
          size: "340 B",
          perms: "rw-r--r--",
          modified: "2026-10-09 03:00",
          hash: "wy:88c1b29a",
          mime: "text/plain",
          path: "/etc/sysctl.d/90-aphrody-bun.conf",
        },
      ];
      return simulatedJson({ path: "/etc/sysctl.d", entries });
    }

    if (queryPath === "/bin") {
      const binaries = ["bun", "bunsh", "aphrody", "n2b", "sudo-rs", "apk", "busybox", "sh"];
      const entries: VfsEntry[] = binaries.map((name) => ({
        name,
        type: "file",
        size: name === "bun" ? "94.2 MB" : name === "aphrody" ? "28.4 MB" : "1.2 MB",
        perms: "rwxr-xr-x",
        modified: "2026-10-09 03:00",
        hash: `wy:${name}bin`,
        mime: "application/octet-stream",
        path: `/bin/${name}`,
      }));
      return simulatedJson({ path: "/bin", entries });
    }

    return hostAccessDenied();
  }

  // 3. Spacedrive VFS File Reading: GET /api/os/vfs/read
  if (url.pathname === "/api/os/vfs/read") {
    const queryPath = url.searchParams.get("path") || "";
    if (!queryPath) {
      return Response.json({ error: "Missing path" }, { status: 400 });
    }

    // Virtual files
    if (queryPath === "/etc/os-release") {
      const content = `NAME="Aphrody Alpine Linux"
ID=aphrody-alpine
VERSION_ID=3.24.2
PRETTY_NAME="Aphrody Alpine Linux v3.24 (musl + aphrody-libc)"
HOME_URL="https://github.com/aphrody-labs/aphrody"
BUG_REPORT_URL="https://github.com/aphrody-labs/aphrody/issues"
SHELL="/bin/bunsh"
ARCHITECTURE="x86_64"`;
      return simulatedJson({
        content,
        size: content.length,
        hash: "wy:a914c810",
        mime: "text/plain",
      });
    }

    if (queryPath === "/etc/passwd") {
      const content = `root:x:0:0:root:/root:/bin/bunsh
bin:x:1:1:bin:/bin:/sbin/nologin
daemon:x:2:2:daemon:/sbin:/sbin/nologin
builder:x:1000:1000:builder:/home/builder:/bin/bunsh`;
      return simulatedJson({
        content,
        size: content.length,
        hash: "wy:11d04b82",
        mime: "text/plain",
      });
    }

    if (queryPath === "/etc/sysctl.d/90-aphrody-bun.conf") {
      const content = sysctlSettingsState.map((s) => `${s.key}=${s.value}`).join("\n") + "\n";
      return simulatedJson({
        content,
        size: content.length,
        hash: "wy:88c1b29a",
        mime: "text/plain",
      });
    }

    return hostAccessDenied();
  }

  // 4. Kernel Telemetry: GET /api/os/kernel/telemetry
  if (url.pathname === "/api/os/kernel/telemetry") {
    const memory = process.memoryUsage();
    const uptime = Math.floor((Date.now() - serverStartTime) / 1000) + 14290;

    const subsystems = [
      {
        name: "ostd::backend",
        tier: "ostd",
        status: "active",
        description: "Minimal TCB primitive types, stdio capture, and memory allocator",
        workers: 4,
        memoryKb: 1420,
      },
      {
        name: "ostd::guard",
        tier: "ostd",
        status: "active",
        description: "Process hardening, anti-dumping, and privileged execution policy",
        workers: 2,
        memoryKb: 890,
      },
      {
        name: "ostd::proc",
        tier: "ostd",
        status: "active",
        description: "Zero-copy process execution and task handle management",
        workers: 4,
        memoryKb: 2110,
      },
      {
        name: "ostd::secrets",
        tier: "ostd",
        status: "active",
        description: "Protected cryptographic store with memory-locked pages",
        workers: 1,
        memoryKb: 512,
      },
      {
        name: "kernel::core",
        tier: "core",
        status: "active",
        description: "Central MCP router, token security broker, and system audit log",
        workers: 8,
        memoryKb: 6340,
      },
      {
        name: "kernel::events",
        tier: "core",
        status: "active",
        description: "Epoll & io_uring asynchronous event ring buffer",
        workers: 4,
        memoryKb: 3120,
      },
      {
        name: "kernel::execpolicy",
        tier: "core",
        status: "active",
        description: "Autonomous agent capability gates and execution isolation",
        workers: 2,
        memoryKb: 1240,
      },
      {
        name: "comp::drive",
        tier: "comp",
        status: "active",
        description: "Spacedrive VFS, volume hierarchy, and tag closures",
        workers: 6,
        memoryKb: 12450,
      },
      {
        name: "comp::diagnostics",
        tier: "comp",
        status: "active",
        description: "Hardware metrics, sysfs telemetry, and thermal probes",
        workers: 2,
        memoryKb: 1980,
      },
      {
        name: "comp::cron",
        tier: "comp",
        status: "active",
        description: "Recurring task scheduler and maintenance daemon",
        workers: 1,
        memoryKb: 760,
      },
      {
        name: "comp::jobs",
        tier: "comp",
        status: "active",
        description: "Asynchronous background compilation and neural jobs",
        workers: 4,
        memoryKb: 4520,
      },
      {
        name: "comp::winclean",
        tier: "comp",
        status: "ready",
        description: "Desktop optimization, registry pruning, and deep artifact cleanup",
        workers: 2,
        memoryKb: 1890,
      },
      {
        name: "comp::sandbox",
        tier: "comp",
        status: "active",
        description: "Landlock and cgroups v2 container containment",
        workers: 2,
        memoryKb: 2340,
      },
      {
        name: "lib::fsindex",
        tier: "lib",
        status: "active",
        description: "Everything SDK ultra-fast filesystem indexing (<1ms)",
        workers: 2,
        memoryKb: 8940,
      },
      {
        name: "lib::capture",
        tier: "lib",
        status: "standby",
        description: "Native screen, frame buffer, and audio device capture",
        workers: 1,
        memoryKb: 1120,
      },
    ];

    const dmesgLogs = [
      {
        time: "[    0.000000]",
        level: "info",
        tag: "Linux",
        msg: "linux-aphrody-v3 6.18.55-aphrody (builder@aphrody-alpine) (clang-23.1.3, rustc 1.98.1) #1 SMP PREEMPT_DYNAMIC",
      },
      {
        time: "[    0.000012]",
        level: "info",
        tag: "Rust",
        msg: "Kernel Rust runtime initialized: abstractions for PHY, DRM, NVMe enabled",
      },
      {
        time: "[    0.012480]",
        level: "info",
        tag: "ZSWAP",
        msg: "zswap: loaded using compressor zstd and zpool zsmalloc, ratio ~3.4:1",
      },
      {
        time: "[    0.048120]",
        level: "info",
        tag: "HugeTLB",
        msg: "Transparent Huge Pages: madvise mode activated, defer split enabled",
      },
      {
        time: "[    0.104230]",
        level: "info",
        tag: "aphrody-libc",
        msg: "Fast leaf overlay registered: SIMD memcmp, strlen, qsort (SSE2/NEON)",
      },
      {
        time: "[    0.218490]",
        level: "info",
        tag: "ostd",
        msg: "TCB Minimal core loaded: ostd::backend, ostd::guard, ostd::proc verified",
      },
      {
        time: "[    0.342110]",
        level: "info",
        tag: "SystemSubsystem",
        msg: "15 first-party subsystems attached to kernel bus",
      },
      {
        time: "[    0.512940]",
        level: "info",
        tag: "aphrody-sysctl",
        msg: "Applied 90-aphrody-bun.conf: somaxconn=8192, bbr=on, max_map=1048576",
      },
      {
        time: "[    0.684120]",
        level: "info",
        tag: "bunsh",
        msg: "Root login shell set to /bin/bunsh (Aphrody Bun Shell with elevate)",
      },
      {
        time: "[    0.891230]",
        level: "info",
        tag: "WireGuard",
        msg: "Interface wg1 up: private overlay mesh active (10.42.0.3/24)",
      },
      {
        time: "[    1.024500]",
        level: "success",
        tag: "aphrody-pc-agent",
        msg: "PC Agent daemon listening on /run/aphrody/agent.sock",
      },
      {
        time: "[    1.240190]",
        level: "success",
        tag: "aphrody-kernel",
        msg: "Kernel RPC & MCP router ready on 127.0.0.1:8786",
      },
    ];

    return simulatedJson({
      kernel: "linux-aphrody-v3 6.18.55-aphrody-v3",
      arch: "x86_64-alpine-linux-musl",
      tcb: "Asterinas Minimal TCB Core",
      uptime,
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
      zswap: {
        enabled: true,
        compressor: "zstd",
        pool: "zsmalloc",
        ratio: 3.42,
        compressedMb: 280,
        uncompressedMb: 957,
      },
      subsystems,
      sysctl: sysctlSettingsState,
      mesh: {
        interface: "wg1",
        address: "10.42.0.3/24",
        status: "active",
        txMb: 4.8,
        rxMb: 12.9,
        peers: [
          {
            endpoint: "194.164.72.10:51820",
            allowedIps: "10.42.0.1/32",
            latestHandshake: "12s ago",
            rx: "8.4 MB",
            tx: "3.1 MB",
          },
        ],
      },
      dmesg: dmesgLogs,
      timestamp: Date.now(),
    });
  }

  // 5. Kernel Sysctl Dynamic Tuning: POST /api/os/kernel/sysctl
  if (url.pathname === "/api/os/kernel/sysctl" && req.method === "POST") {
    const { key, value } = await req.json();
    if (key && value !== undefined) {
      sysctlSettingsState = sysctlSettingsState.map((s) =>
        s.key === key ? { ...s, value: String(value) } : s,
      );
      return simulatedJson({ success: true, key, value, sysctl: sysctlSettingsState });
    }
    return Response.json({ error: "Missing key or value" }, { status: 400 });
  }

  // 6. MCP Codex Studio Tool Dispatcher: POST /api/os/mcp/call
  if (url.pathname === "/api/os/mcp/call" && req.method === "POST") {
    const t0 = performance.now();
    const { tool } = await req.json();

    if (tool === "kernel_tools") {
      const summary = `Kernel 6.18.55-aphrody-v3: ${sysctlSettingsState.length} sysctl keys active, BBR=on, somaxconn=8192, zswap=zstd.`;
      return simulatedJson({
        tool,
        result: summary,
        durationMs: Math.round(performance.now() - t0),
      });
    }

    if (["git_inspect", "rag_query", "vfs_read", "run_command"].includes(tool)) {
      return hostAccessDenied();
    }

    if (tool === "bench_run") {
      const iters = 10000;
      const b0 = performance.now();
      for (let i = 0; i < iters; i++) {
        Bun.hash.wyhash("benchmark-payload-aphrody");
      }
      const b1 = performance.now();
      const benchMs = (b1 - b0).toFixed(2);
      return Response.json({
        tool,
        result: `Bun wyhash benchmark: ${iters} iterations completed in ${benchMs}ms (~${Math.round((iters / (b1 - b0)) * 1000)} ops/sec)`,
        durationMs: Math.round(performance.now() - t0),
      });
    }

    return Response.json(
      { tool, error: `Tool '${tool}' is not implemented.`, status: "unsupported" },
      { status: 501 },
    );
  }

  // 7. Alpine Package Hub API: GET /api/os/apk/packages & POST /api/os/apk/install
  if (url.pathname === "/api/os/apk/packages") {
    return simulatedJson({ packages: apkPackagesState, repo: "aphrody-3.24", signer: null });
  }

  if (url.pathname === "/api/os/apk/install" && req.method === "POST") {
    const { pkgName, action } = await req.json();
    if (!pkgName) {
      return Response.json({ error: "Missing pkgName" }, { status: 400 });
    }

    const isInstall = action !== "remove";
    apkPackagesState = apkPackagesState.map((p) =>
      p.name === pkgName ? { ...p, installed: isInstall } : p,
    );

    return simulatedJson({
      success: true,
      message: isInstall
        ? `(1/1) Installing ${pkgName} (signed: aphrody-labs.rsa.pub)... Executing bun-apk.trigger... OK.`
        : `(1/1) Purging ${pkgName}... Executing bun-apk.trigger... OK.`,
      packages: apkPackagesState,
    });
  }

  // Not handled by OS router
  return null;
}
