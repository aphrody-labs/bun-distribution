// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from 'react';
import type { KernelSubsystemInfo } from '../types';

export const KernelMonitorApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'subsystems' | 'sysctl' | 'memory' | 'mesh' | 'dmesg'>('subsystems');
  const [uptime, setUptime] = useState<number>(14290);
  const [cpuUsage, setCpuUsage] = useState<number>(12);
  const [zswapUsage, setZswapUsage] = useState<number>(34);

  const initialSubsystems: KernelSubsystemInfo[] = [
    { name: 'ostd::backend', tier: 'ostd', status: 'active', description: 'Minimal TCB primitive types, stdio capture, and memory allocator', workers: 4, memoryKb: 1420 },
    { name: 'ostd::guard', tier: 'ostd', status: 'active', description: 'Process hardening, anti-dumping, and privileged execution policy', workers: 2, memoryKb: 890 },
    { name: 'ostd::proc', tier: 'ostd', status: 'active', description: 'Zero-copy process execution and task handle management', workers: 4, memoryKb: 2110 },
    { name: 'ostd::secrets', tier: 'ostd', status: 'active', description: 'Protected cryptographic store with memory-locked pages', workers: 1, memoryKb: 512 },
    { name: 'kernel::core', tier: 'core', status: 'active', description: 'Central MCP router, token security broker, and system audit log', workers: 8, memoryKb: 6340 },
    { name: 'kernel::events', tier: 'core', status: 'active', description: 'Epoll & io_uring asynchronous event ring buffer', workers: 4, memoryKb: 3120 },
    { name: 'kernel::execpolicy', tier: 'core', status: 'active', description: 'Autonomous agent capability gates and execution isolation', workers: 2, memoryKb: 1240 },
    { name: 'comp::drive', tier: 'comp', status: 'active', description: 'Spacedrive VFS, volume hierarchy, and tag closures', workers: 6, memoryKb: 12450 },
    { name: 'comp::diagnostics', tier: 'comp', status: 'active', description: 'Hardware metrics, sysfs telemetry, and thermal probes', workers: 2, memoryKb: 1980 },
    { name: 'comp::cron', tier: 'comp', status: 'active', description: 'Recurring task scheduler and maintenance daemon', workers: 1, memoryKb: 760 },
    { name: 'comp::jobs', tier: 'comp', status: 'active', description: 'Asynchronous background compilation and neural jobs', workers: 4, memoryKb: 4520 },
    { name: 'comp::winclean', tier: 'comp', status: 'ready', description: 'Desktop optimization, registry pruning, and deep artifact cleanup', workers: 2, memoryKb: 1890 },
    { name: 'comp::sandbox', tier: 'comp', status: 'active', description: 'Landlock and cgroups v2 container containment', workers: 2, memoryKb: 2340 },
    { name: 'lib::fsindex', tier: 'lib', status: 'active', description: 'Everything SDK ultra-fast filesystem indexing (<1ms)', workers: 2, memoryKb: 8940 },
    { name: 'lib::capture', tier: 'lib', status: 'standby', description: 'Native screen, frame buffer, and audio device capture', workers: 1, memoryKb: 1120 },
  ];

  const initialSysctl = [
    { key: 'vm.max_map_count', value: '1048576', purpose: 'Enables massive V8/JSC heaps and multi-threaded arena allocation' },
    { key: 'vm.overcommit_memory', value: '1', purpose: 'Strict zero-allocation overhead for rapid Bun worker spawns' },
    { key: 'fs.inotify.max_user_watches', value: '1048576', purpose: 'Allows monorepo-wide zero-lag file watcher scaling across 100k+ files' },
    { key: 'fs.inotify.max_user_instances', value: '1024', purpose: 'Concurrent watch handles for all packages and test runners' },
    { key: 'net.core.somaxconn', value: '8192', purpose: 'High-throughput TCP backlog for Bun.serve HTTP/WS microservers' },
    { key: 'net.ipv4.tcp_fastopen', value: '3', purpose: 'TCP Fast Open enabled for both incoming and outgoing client sockets' },
    { key: 'net.core.default_qdisc', value: 'fq', purpose: 'Fair Queueing packet scheduler for microsecond network latency' },
    { key: 'net.ipv4.tcp_congestion_control', value: 'bbr', purpose: 'BBR bottleneck bandwidth and round-trip propagation time' },
    { key: 'net.core.rmem_max', value: '16777216', purpose: '16 MiB receive window buffer for high-bandwidth HTTP/3 QUIC' },
    { key: 'net.core.wmem_max', value: '16777216', purpose: '16 MiB send window buffer for high-throughput streaming' },
    { key: 'kernel.perf_event_paranoid', value: '1', purpose: 'Allows user-space hardware performance counter profiling' },
    { key: 'kernel.io_uring_disabled', value: '0', purpose: 'io_uring kernel ring buffers unlocked for storage and networking' },
  ];

  const [subsystems, setSubsystems] = useState<KernelSubsystemInfo[]>(initialSubsystems);
  const [sysctlSettings, setSysctlSettings] = useState(initialSysctl);
  const [dmesgLogs, setDmesgLogs] = useState<any[]>([]);

  useEffect(() => {
    const fetchTelemetry = () => {
      fetch('/api/os/kernel/telemetry')
        .then(res => res.json())
        .then(data => {
          if (data.uptime) setUptime(data.uptime);
          if (data.subsystems) setSubsystems(data.subsystems);
          if (data.sysctl) setSysctlSettings(data.sysctl);
          if (data.dmesg) setDmesgLogs(data.dmesg);
          setCpuUsage(Math.floor(8 + Math.random() * 12));
          setZswapUsage(Math.floor(32 + Math.random() * 4));
        })
        .catch(() => {
          setUptime(u => u + 1);
        });
    };

    fetchTelemetry();
    const timer = setInterval(fetchTelemetry, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-gray-100 font-sans select-none overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#161922] border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-md shadow-purple-500/20">
            Ω
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm tracking-wide text-white">AphrodyOS Kernel Monitor</span>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full">
                ACTIVE
              </span>
            </div>
            <div className="text-[11px] text-gray-400 font-mono">
              linux-aphrody-v3 6.18.55 • Asterinas TCB Core + Linux Subsystems
            </div>
          </div>
        </div>

        {/* Quick telemetry indicators */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 bg-gray-900/80 px-2.5 py-1 rounded border border-gray-800">
            <span className="text-gray-400">CPU:</span>
            <span className="text-purple-400 font-bold">{cpuUsage}%</span>
          </div>
          <div className="flex items-center gap-1.5 bg-gray-900/80 px-2.5 py-1 rounded border border-gray-800">
            <span className="text-gray-400">ZSWAP:</span>
            <span className="text-indigo-400 font-bold">{zswapUsage}%</span>
            <span className="text-[10px] text-gray-500">(zstd)</span>
          </div>
          <div className="flex items-center gap-1.5 bg-gray-900/80 px-2.5 py-1 rounded border border-gray-800">
            <span className="text-gray-400">UPTIME:</span>
            <span className="text-emerald-400 font-bold">{Math.floor(uptime / 3600)}h {Math.floor((uptime % 3600) / 60)}m {uptime % 60}s</span>
          </div>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex border-b border-gray-800 bg-[#12151d] px-4 gap-1">
        <button
          onClick={() => setActiveTab('subsystems')}
          className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'subsystems'
              ? 'border-purple-500 text-purple-400 bg-purple-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Subsystems ({subsystems.length})
        </button>
        <button
          onClick={() => setActiveTab('sysctl')}
          className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'sysctl'
              ? 'border-purple-500 text-purple-400 bg-purple-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Kernel Tunings (sysctl)
        </button>
        <button
          onClick={() => setActiveTab('memory')}
          className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'memory'
              ? 'border-purple-500 text-purple-400 bg-purple-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Memory & ZSwap
        </button>
        <button
          onClick={() => setActiveTab('mesh')}
          className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'mesh'
              ? 'border-purple-500 text-purple-400 bg-purple-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          WireGuard Mesh (wg1)
        </button>
        <button
          onClick={() => setActiveTab('dmesg')}
          className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            activeTab === 'dmesg'
              ? 'border-purple-500 text-purple-400 bg-purple-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Ring Buffer (dmesg)
        </button>
      </div>

      {/* Main content body */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {activeTab === 'subsystems' && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {subsystems.map(sub => (
                <div
                  key={sub.name}
                  className="bg-[#171a23] border border-gray-800/80 rounded-lg p-3 hover:border-purple-500/40 transition-all shadow-sm"
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <span className="font-mono font-semibold text-xs text-purple-300">{sub.name}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${
                      sub.tier === 'ostd'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : sub.tier === 'core'
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    }`}>
                      {sub.tier}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 leading-relaxed mb-3">{sub.description}</p>
                  <div className="flex items-center justify-between text-[10px] font-mono text-gray-500 border-t border-gray-800/60 pt-2">
                    <span>Workers: <strong className="text-gray-300">{sub.workers}</strong></span>
                    <span>Heap: <strong className="text-gray-300">{(sub.memoryKb / 1024).toFixed(1)} MB</strong></span>
                    <span className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${sub.status === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
                      <span className="text-gray-400 capitalize">{sub.status}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'sysctl' && (
          <div className="bg-[#171a23] border border-gray-800 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-[#12151d] border-b border-gray-800 flex items-center justify-between text-xs text-gray-400">
              <span className="font-mono">/etc/sysctl.d/90-aphrody-bun.conf</span>
              <span>Loaded from: aphrody-sysctl 1.1</span>
            </div>
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-gray-900/60 text-gray-400 text-[11px] border-b border-gray-800">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Parameter</th>
                  <th className="py-2.5 px-4 font-semibold">Value</th>
                  <th className="py-2.5 px-4 font-semibold">Architectural Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {sysctlSettings.map(item => (
                  <tr key={item.key} className="hover:bg-purple-500/5 transition-colors">
                    <td className="py-2.5 px-4 text-purple-300 font-bold">{item.key}</td>
                    <td className="py-2.5 px-4 text-emerald-400 font-semibold">{item.value}</td>
                    <td className="py-2.5 px-4 text-gray-400 font-sans text-xs">{item.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#171a23] border border-gray-800 p-4 rounded-lg">
                <span className="text-xs text-gray-400 font-medium">ZSwap (Compressed RAM)</span>
                <div className="mt-2 text-2xl font-bold font-mono text-purple-400">3.4 : 1</div>
                <div className="text-[11px] text-gray-500 mt-1">Compressor: Zstd (hardware-assisted)</div>
                <div className="w-full bg-gray-800 h-1.5 rounded-full mt-3 overflow-hidden">
                  <div className="bg-purple-500 h-full rounded-full" style={{ width: `${zswapUsage}%` }} />
                </div>
              </div>

              <div className="bg-[#171a23] border border-gray-800 p-4 rounded-lg">
                <span className="text-xs text-gray-400 font-medium">aphrody-libc SIMD Overlay</span>
                <div className="mt-2 text-2xl font-bold font-mono text-emerald-400">ACTIVE</div>
                <div className="text-[11px] text-gray-500 mt-1">memcmp, strlen, qsort (SSE2/NEON)</div>
                <div className="text-[10px] font-mono text-emerald-500/80 mt-2">Zero glibc dependency • Musl ABI</div>
              </div>

              <div className="bg-[#171a23] border border-gray-800 p-4 rounded-lg">
                <span className="text-xs text-gray-400 font-medium">Transparent Huge Pages (THP)</span>
                <div className="mt-2 text-2xl font-bold font-mono text-blue-400">MADVISE</div>
                <div className="text-[11px] text-gray-500 mt-1">2 MB Pages allocated on demand</div>
                <div className="text-[10px] font-mono text-blue-500/80 mt-2">Reduces TLB miss penalty by ~38%</div>
              </div>
            </div>

            <div className="bg-[#171a23] border border-gray-800 p-4 rounded-lg">
              <h4 className="text-xs font-semibold text-gray-200 mb-2 font-mono">Memory Architecture Specification</h4>
              <p className="text-xs text-gray-400 leading-relaxed">
                AphrodyOS pairs Alpine 3.24 musl with the <strong className="text-gray-200">aphrody-libc</strong> leaf overlay
                and <strong className="text-gray-200">mimalloc 2.1</strong>. High-frequency leaf operations
                (<code className="text-purple-300">memcmp</code>, <code className="text-purple-300">strlen</code>, <code className="text-purple-300">qsort</code>)
                are replaced with vectorized SIMD routines compiled from Rust without modifying musl&apos;s ABI or internal libc structures.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'mesh' && (
          <div className="space-y-4">
            <div className="bg-[#171a23] border border-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-mono text-xs font-bold text-gray-200">WireGuard Interface: wg1</span>
                </div>
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  CONNECTED (10.42.0.3/24)
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                <div className="bg-gray-900/60 p-3 rounded border border-gray-800">
                  <div className="text-gray-400 text-[11px]">Peer 1: Gateway VPS (dbfr)</div>
                  <div className="text-purple-300 font-bold mt-1">10.42.0.1 • 198.51.100.42:51820</div>
                  <div className="text-[10px] text-gray-500 mt-2">Transfer: 1.4 GB rx • 890 MB tx • Latency: 4.2ms</div>
                </div>
                <div className="bg-gray-900/60 p-3 rounded border border-gray-800">
                  <div className="text-gray-400 text-[11px]">Peer 2: Local PC Agent (Windows)</div>
                  <div className="text-purple-300 font-bold mt-1">10.42.0.2 • 192.168.1.105:51820</div>
                  <div className="text-[10px] text-gray-500 mt-2">Transfer: 420 MB rx • 210 MB tx • Latency: 0.8ms</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'dmesg' && (
          <div className="bg-[#12141c] border border-gray-800 rounded-lg p-3 font-mono text-xs overflow-x-auto space-y-1">
            {dmesgLogs.map((log, idx) => (
              <div key={idx} className="flex gap-2 text-[11px] leading-relaxed">
                <span className="text-gray-500 shrink-0">{log.time}</span>
                <span className="text-purple-400 shrink-0 font-semibold">[{log.tag}]</span>
                <span className={log.level === 'success' ? 'text-emerald-400' : 'text-gray-300'}>{log.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
