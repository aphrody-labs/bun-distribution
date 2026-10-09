// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'bun:test';
import { handleOsRequest } from '../src/os/os-router';

describe('Aphrody OS & Alpine Bun Web Endpoints', () => {
  it('GET /api/os/kernel/telemetry returns full kernel & TCB subsystem status', async () => {
    const req = new Request('http://localhost:3000/api/os/kernel/telemetry');
    const res = await handleOsRequest(req, new URL(req.url));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const data = await res!.json();
    expect(data.kernel).toBe('linux-aphrody-v3 6.18.55-aphrody-v3');
    expect(data.arch).toBe('x86_64-alpine-linux-musl');
    expect(data.tcb).toBe('Asterinas Minimal TCB Core');
    expect(Array.isArray(data.subsystems)).toBe(true);
    expect(data.subsystems.length).toBeGreaterThanOrEqual(15);
    expect(data.subsystems.some((s: any) => s.name === 'ostd::backend')).toBe(true);
    expect(data.subsystems.some((s: any) => s.name === 'comp::drive')).toBe(true);
    expect(data.zswap.compressor).toBe('zstd');
    expect(data.mesh.interface).toBe('wg1');
    expect(data.mesh.address).toBe('10.42.0.3/24');
  });

  it('POST /api/os/exec runs virtual Alpine system commands (uname, cat, dmesg, free)', async () => {
    // 1. uname -a
    const unameReq = new Request('http://localhost:3000/api/os/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'uname -a' }),
    });
    const unameRes = await handleOsRequest(unameReq, new URL(unameReq.url));
    const unameData = await unameRes!.json();
    expect(unameData.exitCode).toBe(0);
    expect(unameData.stdout).toContain('Linux aphrody-alpine 6.18.55-aphrody-v3');

    // 2. cat /etc/os-release
    const osRelReq = new Request('http://localhost:3000/api/os/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'cat /etc/os-release' }),
    });
    const osRelRes = await handleOsRequest(osRelReq, new URL(osRelReq.url));
    const osRelData = await osRelRes!.json();
    expect(osRelData.exitCode).toBe(0);
    expect(osRelData.stdout).toContain('NAME="Aphrody Alpine Linux"');
    expect(osRelData.stdout).toContain('SHELL="/bin/bunsh"');

    // 3. dmesg
    const dmesgReq = new Request('http://localhost:3000/api/os/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'dmesg' }),
    });
    const dmesgRes = await handleOsRequest(dmesgReq, new URL(dmesgReq.url));
    const dmesgData = await dmesgRes!.json();
    expect(dmesgData.exitCode).toBe(0);
    expect(dmesgData.stdout).toContain('6.18.55-aphrody-v3');
    expect(dmesgData.stdout).toContain('zswap: loaded using compressor zstd');
  });

  it('POST /api/os/exec executes native bun and aphrody commands', async () => {
    // 1. bun -v
    const bunReq = new Request('http://localhost:3000/api/os/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'bun -v' }),
    });
    const bunRes = await handleOsRequest(bunReq, new URL(bunReq.url));
    const bunData = await bunRes!.json();
    expect(bunData.exitCode).toBe(0);
    expect(bunData.stdout).toContain('1.4.3');

    // 2. aphrody web status
    const aphrodyReq = new Request('http://localhost:3000/api/os/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'aphrody web status' }),
    });
    const aphrodyRes = await handleOsRequest(aphrodyReq, new URL(aphrodyReq.url));
    const aphrodyData = await aphrodyRes!.json();
    expect(aphrodyData.exitCode).toBe(0);
    expect(aphrodyData.stdout).toContain('Aphrody Web: ready');
  });

  it('GET /api/os/vfs/list lists both virtual rootfs and live repository filesystem with wyhash', async () => {
    // 1. Rootfs /
    const rootReq = new Request('http://localhost:3000/api/os/vfs/list?path=/');
    const rootRes = await handleOsRequest(rootReq, new URL(rootReq.url));
    const rootData = await rootRes!.json();
    expect(rootData.path).toBe('/');
    expect(rootData.entries.some((e: any) => e.name === 'bin')).toBe(true);
    expect(rootData.entries.some((e: any) => e.name === 'etc')).toBe(true);
    expect(rootData.entries.some((e: any) => e.name === 'work')).toBe(true);

    // 2. Real repository path /work/crates
    const cratesReq = new Request('http://localhost:3000/api/os/vfs/list?path=/work/crates');
    const cratesRes = await handleOsRequest(cratesReq, new URL(cratesReq.url));
    const cratesData = await cratesRes!.json();
    expect(cratesData.entries.some((e: any) => e.name === 'os')).toBe(true);
    expect(cratesData.entries.some((e: any) => e.name === 'ui')).toBe(true);

    // 3. Checksum presence on file
    const rootWorkReq = new Request('http://localhost:3000/api/os/vfs/list?path=/work');
    const rootWorkRes = await handleOsRequest(rootWorkReq, new URL(rootWorkReq.url));
    const rootWorkData = await rootWorkRes!.json();
    const cargoEntry = rootWorkData.entries.find((e: any) => e.name === 'Cargo.toml');
    expect(cargoEntry).toBeDefined();
    expect(cargoEntry.hash).toMatch(/^wy:/);
  });

  it('GET /api/os/vfs/read reads real file contents and wyhash checksum', async () => {
    const req = new Request('http://localhost:3000/api/os/vfs/read?path=/work/Cargo.toml');
    const res = await handleOsRequest(req, new URL(req.url));
    expect(res!.status).toBe(200);

    const data = await res!.json();
    expect(data.content).toContain('[workspace]');
    expect(data.size).toBeGreaterThan(0);
    expect(data.hash).toMatch(/^wy:/);
    expect(data.mime).toBe('text/x-toml');
  });

  it('POST /api/os/mcp/call dispatches tools (kernel_tools, git_inspect, bench_run)', async () => {
    // 1. kernel_tools
    const kReq = new Request('http://localhost:3000/api/os/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'kernel_tools', args: {} }),
    });
    const kRes = await handleOsRequest(kReq, new URL(kReq.url));
    const kData = await kRes!.json();
    expect(kData.tool).toBe('kernel_tools');
    expect(kData.result).toContain('6.18.55-aphrody-v3');

    // 2. bench_run
    const bReq = new Request('http://localhost:3000/api/os/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'bench_run', args: {} }),
    });
    const bRes = await handleOsRequest(bReq, new URL(bReq.url));
    const bData = await bRes!.json();
    expect(bData.tool).toBe('bench_run');
    expect(bData.result).toContain('SIMD wyhash benchmark');
  });

  it('GET and POST /api/os/apk/packages manages signed package state', async () => {
    const listReq = new Request('http://localhost:3000/api/os/apk/packages');
    const listRes = await handleOsRequest(listReq, new URL(listReq.url));
    const listData = await listRes!.json();
    expect(listData.repo).toBe('aphrody-3.24');
    expect(listData.signer).toBe('aphrody-labs.rsa.pub');
    expect(listData.packages.some((p: any) => p.name === 'bun')).toBe(true);

    // Install toggle
    const toggleReq = new Request('http://localhost:3000/api/os/apk/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkgName: 'llvm23', action: 'install' }),
    });
    const toggleRes = await handleOsRequest(toggleReq, new URL(toggleReq.url));
    const toggleData = await toggleRes!.json();
    expect(toggleData.success).toBe(true);
    expect(toggleData.packages.find((p: any) => p.name === 'llvm23').installed).toBe(true);
  });
});
