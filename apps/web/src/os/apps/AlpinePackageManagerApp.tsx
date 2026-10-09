// SPDX-License-Identifier: Apache-2.0
import React, { useState } from 'react';
import type { ApkPackageInfo, ContainerInfo } from '../types';

export const AlpinePackageManagerApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'packages' | 'containers' | 'repo'>('packages');
  const [search, setSearch] = useState('');

  const [packages, setPackages] = useState<ApkPackageInfo[]>([
    { name: 'bun', version: '1.4.3_p2-r0', description: 'Fast all-in-one JavaScript runtime & native bundler', installed: true, size: '94.2 MB', repo: 'aphrody-3.24', signed: true },
    { name: 'bun-shell', version: '1.4.3_p2-r0', description: '/bin/bunsh root login shell with elevate and elevate.rs integration', installed: true, size: '4.8 MB', repo: 'aphrody-3.24', signed: true },
    { name: 'bun-apk', version: '1.0-r1', description: 'Automatic trigger for npm modules and binary linking into /usr/lib/bun/bin', installed: true, size: '120 KB', repo: 'aphrody-3.24', signed: true },
    { name: 'aphrody', version: '3.3.8-r0', description: 'Unified Rust multicall binary & Bun monorepo CLI orchestrator', installed: true, size: '28.4 MB', repo: 'aphrody-3.24', signed: true },
    { name: 'n2b', version: '0.7.1-r0', description: 'Zero-configuration Node-to-Bun AST migration and transform engine', installed: true, size: '8.1 MB', repo: 'aphrody-3.24', signed: true },
    { name: 'aphrody-libc', version: '0.1.0-r0', description: 'SIMD leaf overlay for musl: memcmp, strlen, qsort (SSE2/NEON)', installed: true, size: '480 KB', repo: 'aphrody-3.24', signed: true },
    { name: 'sudo-rs', version: '0.2.15-r1', description: 'Memory-safe Rust implementation of sudo replacing GNU sudo/doas', installed: true, size: '1.9 MB', repo: 'aphrody-3.24', signed: true },
    { name: 'aphrody-sysctl', version: '1.1-r0', description: 'High-throughput kernel tunings (somaxconn=8192, BBR, max_map_count)', installed: true, size: '16 KB', repo: 'aphrody-3.24', signed: true },
    { name: 'llvm23', version: '23.1.3-r0', description: 'Backported LLVM and Clang 23 toolchain from edge/main', installed: false, size: '410 MB', repo: 'aphrody-3.24', signed: true },
    { name: 'rust-nightly', version: '2026.09.15-r0', description: 'Pinned Rust compiler toolchain matching rust-toolchain.toml', installed: false, size: '640 MB', repo: 'aphrody-3.24', signed: true },
  ]);

  const containers: ContainerInfo[] = [
    { id: 'cnt-01', name: 'shenron-bot-docker', image: 'ghcr.io/aphrody-labs/alpine:3.24', status: 'Up 14 hours', ports: '8080:8080/tcp', memoryMb: 84, cpuPercent: 1.2 },
    { id: 'cnt-02', name: 'shenron-site-docker', image: 'ghcr.io/aphrody-labs/alpine:3.24', status: 'Up 14 hours', ports: '3000:3000/tcp', memoryMb: 62, cpuPercent: 0.8 },
    { id: 'cnt-03', name: 'aphrody-builder-alpine', image: 'aphrody/build-alpine:3.24', status: 'Standby', ports: 'None', memoryMb: 124, cpuPercent: 0.0 },
    { id: 'cnt-04', name: 'vps-tunnel-wg1', image: 'aphrody/wireguard:1.0', status: 'Active (10.42.0.1)', ports: '51820:51820/udp', memoryMb: 18, cpuPercent: 0.2 },
  ];

  React.useEffect(() => {
    fetch('/api/os/apk/packages')
      .then(res => res.json())
      .then(data => {
        if (data.packages && data.packages.length > 0) {
          setPackages(data.packages);
        }
      })
      .catch(() => {});
  }, []);

  const toggleInstall = async (pkgName: string) => {
    const pkg = packages.find(p => p.name === pkgName);
    const nextAction = pkg?.installed ? 'remove' : 'install';

    // Optimistic update
    setPackages(prev =>
      prev.map(p => (p.name === pkgName ? { ...p, installed: !p.installed } : p))
    );

    try {
      const res = await fetch('/api/os/apk/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pkgName, action: nextAction }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.packages) {
          setPackages(data.packages);
        }
      }
    } catch {}
  };

  const filteredPackages = packages.filter(
    p => p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-[#0e1017] text-gray-200 font-sans select-none overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#141722] border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">
            📦
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-white">Aphrody Alpine Package & Container Hub</span>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full">
                ALPINE 3.24.2
              </span>
            </div>
            <div className="text-[11px] text-gray-400 font-mono">
              Signed APK Repository • aports 3.24-stable • musl libc + aphrody-libc
            </div>
          </div>
        </div>

        <div className="w-64">
          <input
            type="text"
            placeholder="Search packages or containers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded px-2.5 py-1 text-xs text-gray-200 outline-none focus:border-blue-500 font-mono"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-[#11131c] px-4 gap-1 text-xs">
        <button
          onClick={() => setActiveTab('packages')}
          className={`px-3 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'packages'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Signed APK Packages ({packages.length})
        </button>
        <button
          onClick={() => setActiveTab('containers')}
          className={`px-3 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'containers'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Containers & MicroVMs ({containers.length})
        </button>
        <button
          onClick={() => setActiveTab('repo')}
          className={`px-3 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'repo'
              ? 'border-blue-500 text-blue-400 bg-blue-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Repository & GPG Keys
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {activeTab === 'packages' && (
          <div className="space-y-2.5">
            {filteredPackages.map(pkg => (
              <div
                key={pkg.name}
                className="bg-[#151824] border border-gray-800/80 rounded-lg p-3 hover:border-blue-500/40 transition-colors flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-blue-300">{pkg.name}</span>
                    <span className="font-mono text-[11px] text-gray-400">{pkg.version}</span>
                    <span className="px-1.5 py-0.2 text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded">
                      SIGNED (RSA-4096)
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{pkg.description}</p>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-gray-500 mt-2">
                    <span>Repository: <strong className="text-gray-400">{pkg.repo}</strong></span>
                    <span>Size: <strong className="text-gray-400">{pkg.size}</strong></span>
                    <span>ABI: <strong className="text-gray-400">musl x86_64</strong></span>
                  </div>
                </div>

                <div className="shrink-0">
                  <button
                    onClick={() => toggleInstall(pkg.name)}
                    className={`px-3 py-1.5 rounded text-xs font-semibold font-mono transition-colors ${
                      pkg.installed
                        ? 'bg-gray-800 hover:bg-red-500/20 text-gray-300 hover:text-red-400 border border-gray-700'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                    }`}
                  >
                    {pkg.installed ? 'Installed (Remove)' : 'apk add'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'containers' && (
          <div className="space-y-3">
            {containers.map(cnt => (
              <div
                key={cnt.id}
                className="bg-[#151824] border border-gray-800/80 rounded-lg p-3 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-mono font-bold text-xs text-gray-100">{cnt.name}</span>
                    <span className="text-[10px] font-mono text-gray-500">({cnt.id})</span>
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono mt-1">Image: {cnt.image}</div>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-gray-500 mt-2">
                    <span>Status: <strong className="text-emerald-400">{cnt.status}</strong></span>
                    <span>Ports: <strong className="text-gray-300">{cnt.ports}</strong></span>
                    <span>RAM: <strong className="text-gray-300">{cnt.memoryMb} MB</strong></span>
                    <span>CPU: <strong className="text-purple-400">{cnt.cpuPercent}%</strong></span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => alert(`Showing logs for container: ${cnt.name}`)}
                    className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs font-mono"
                  >
                    Logs
                  </button>
                  <button
                    onClick={() => alert(`Spawning bunsh inside container: ${cnt.name}`)}
                    className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-mono font-medium"
                  >
                    Exec bunsh
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'repo' && (
          <div className="space-y-4 text-xs">
            <div className="bg-[#151824] border border-gray-800 rounded-lg p-4 font-mono">
              <span className="text-gray-400 block mb-1">/etc/apk/repositories:</span>
              <pre className="p-3 bg-gray-950 rounded text-purple-300 border border-gray-800/80 overflow-x-auto">
https://github.com/aphrody-labs/aports/releases/download/aphrody-3.24-$&#123;APK_ARCH&#125;/APKINDEX.tar.gz
http://dl-cdn.alpinelinux.org/alpine/v3.24/main
http://dl-cdn.alpinelinux.org/alpine/v3.24/community
              </pre>
            </div>

            <div className="bg-[#151824] border border-gray-800 rounded-lg p-4 font-mono">
              <span className="text-gray-400 block mb-1">Signature Verification Key (/etc/apk/keys/aphrody-labs.rsa.pub):</span>
              <div className="text-emerald-400 text-xs mt-1">Fingerprint: 15e5:fcd2:686d:113b:0ebc:0f35:6bcb:974e:1e61:2d58</div>
              <p className="text-gray-400 font-sans text-xs mt-2 leading-relaxed">
                All packages in the Aphrody Alpine distribution are cryptographically signed before publication in the
                Aphrody aports CI pipeline using RSA-4096. Packages are validated automatically during <code className="text-purple-300">apk add</code>.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
