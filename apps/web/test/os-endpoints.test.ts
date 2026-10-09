// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "bun:test";
import { handleOsRequest } from "../src/os/os-router";

describe("Aphrody OS & Alpine Bun Web Endpoints", () => {
  it("GET /api/os/kernel/telemetry returns explicitly simulated kernel & TCB data", async () => {
    const req = new Request("http://localhost:3000/api/os/kernel/telemetry");
    const res = await handleOsRequest(req, new URL(req.url));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);

    const data = await res!.json();
    expect(data.simulated).toBe(true);
    expect(data.source).toBe("webos-prototype");
    expect(data.status).toBe("simulation");
    expect(data.signatureVerified).toBe(false);
    expect(data.kernel).toBe("linux-aphrody-v3 6.18.55-aphrody-v3");
    expect(data.arch).toBe("x86_64-alpine-linux-musl");
    expect(data.tcb).toBe("Asterinas Minimal TCB Core");
    expect(Array.isArray(data.subsystems)).toBe(true);
    expect(data.subsystems.length).toBeGreaterThanOrEqual(15);
    expect(data.subsystems.some((s: any) => s.name === "ostd::backend")).toBe(true);
    expect(data.subsystems.some((s: any) => s.name === "comp::drive")).toBe(true);
    expect(data.zswap.compressor).toBe("zstd");
    expect(data.mesh.interface).toBe("wg1");
    expect(data.mesh.address).toBe("10.42.0.3/24");
  });

  it("POST /api/os/exec runs virtual Alpine system commands (uname, cat, dmesg, free)", async () => {
    // 1. uname -a
    const unameReq = new Request("http://localhost:3000/api/os/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "uname -a" }),
    });
    const unameRes = await handleOsRequest(unameReq, new URL(unameReq.url));
    const unameData = await unameRes!.json();
    expect(unameData.exitCode).toBe(0);
    expect(unameData.stdout).toContain("Linux aphrody-alpine 6.18.55-aphrody-v3");

    // 2. cat /etc/os-release
    const osRelReq = new Request("http://localhost:3000/api/os/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "cat /etc/os-release" }),
    });
    const osRelRes = await handleOsRequest(osRelReq, new URL(osRelReq.url));
    const osRelData = await osRelRes!.json();
    expect(osRelData.exitCode).toBe(0);
    expect(osRelData.stdout).toContain('NAME="Aphrody Alpine Linux"');
    expect(osRelData.stdout).toContain('SHELL="/bin/bunsh"');

    // 3. dmesg
    const dmesgReq = new Request("http://localhost:3000/api/os/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "dmesg" }),
    });
    const dmesgRes = await handleOsRequest(dmesgReq, new URL(dmesgReq.url));
    const dmesgData = await dmesgRes!.json();
    expect(dmesgData.exitCode).toBe(0);
    expect(dmesgData.stdout).toContain("6.18.55-aphrody-v3");
    expect(dmesgData.stdout).toContain("zswap: loaded using compressor zstd");
  });

  it("POST /api/os/exec refuses host commands without native authorization", async () => {
    await Promise.all(
      ["bun -v", "aphrody web status", "cmd.exe /c echo unsafe", "cat ../../protected-file"].map(
        async (command) => {
          const req = new Request("http://localhost/api/os/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command, isRoot: true }),
          });
          const res = await handleOsRequest(req, new URL(req.url));
          expect(res!.status).toBe(403);
          expect((await res!.json()).status).toBe("permission_denied");
        },
      ),
    );
  });

  it("GET /api/os/vfs/list lists simulated rootfs and refuses host filesystem access", async () => {
    // 1. Rootfs /
    const rootReq = new Request("http://localhost:3000/api/os/vfs/list?path=/");
    const rootRes = await handleOsRequest(rootReq, new URL(rootReq.url));
    const rootData = await rootRes!.json();
    expect(rootData.path).toBe("/");
    expect(rootData.entries.some((e: any) => e.name === "bin")).toBe(true);
    expect(rootData.entries.some((e: any) => e.name === "etc")).toBe(true);
    expect(rootData.entries.some((e: any) => e.name === "work")).toBe(true);

    expect(rootData.simulated).toBe(true);
    const req = new Request("http://localhost/api/os/vfs/list?path=/work/crates");
    expect((await handleOsRequest(req, new URL(req.url)))!.status).toBe(403);
  });

  it("VFS rejects host reads, traversal and absolute paths", async () => {
    await Promise.all(
      ["/work/Cargo.toml", "/work/../../protected-file", "C:/Users/private-file"].map(
        async (path) => {
          const req = new Request(
            "http://localhost/api/os/vfs/read?path=" + encodeURIComponent(path),
          );
          expect((await handleOsRequest(req, new URL(req.url)))!.status).toBe(403);
        },
      ),
    );
  });

  it("POST /api/os/mcp/call labels kernel fixture and measures real Bun hash benchmark", async () => {
    // 1. kernel_tools
    const kReq = new Request("http://localhost:3000/api/os/mcp/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "kernel_tools", args: {} }),
    });
    const kRes = await handleOsRequest(kReq, new URL(kReq.url));
    const kData = await kRes!.json();
    expect(kData.tool).toBe("kernel_tools");
    expect(kData.result).toContain("6.18.55-aphrody-v3");

    // 2. bench_run
    const bReq = new Request("http://localhost:3000/api/os/mcp/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "bench_run", args: {} }),
    });
    const bRes = await handleOsRequest(bReq, new URL(bReq.url));
    const bData = await bRes!.json();
    expect(bData.tool).toBe("bench_run");
    expect(bData.result).toContain("Bun wyhash benchmark");
  });

  it("MCP host operations need native authorization and unknown tools fail", async () => {
    await Promise.all(
      ["vfs_read", "run_command", "git_inspect", "rag_query", "unknown-tool"].map(async (tool) => {
        const req = new Request("http://localhost/api/os/mcp/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool,
            args: { path: "../../protected-file", command: "echo unsafe" },
          }),
        });
        const res = await handleOsRequest(req, new URL(req.url));
        expect(res!.status).toBe(tool === "unknown-tool" ? 501 : 403);
      }),
    );
  });

  it("GET and POST /api/os/apk/packages manages simulated package state without verified signatures", async () => {
    const listReq = new Request("http://localhost:3000/api/os/apk/packages");
    const listRes = await handleOsRequest(listReq, new URL(listReq.url));
    const listData = await listRes!.json();
    expect(listData.repo).toBe("aphrody-3.24");
    expect(listData.signer).toBeNull();
    expect(listData.simulated).toBe(true);
    expect(listData.signatureVerified).toBe(false);
    expect(listData.packages.every((p: any) => p.signed === false)).toBe(true);
    expect(listData.packages.some((p: any) => p.name === "bun")).toBe(true);

    // Install toggle
    const toggleReq = new Request("http://localhost:3000/api/os/apk/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pkgName: "llvm23", action: "install" }),
    });
    const toggleRes = await handleOsRequest(toggleReq, new URL(toggleReq.url));
    const toggleData = await toggleRes!.json();
    expect(toggleData.success).toBe(true);
    expect(toggleData.status).toBe("simulation");
    expect(toggleData.message).toContain("[SIMULATION]");
    expect(toggleData.packages.find((p: any) => p.name === "llvm23").installed).toBe(true);
  });
});
