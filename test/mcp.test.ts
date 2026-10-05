import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { handleMcpMessage, MCP_PROTOCOL_VERSION, SERVER_NAME, TOOLS } from "../apps/yolo/cli/src/mcp";

const rootDir = resolve(import.meta.dir, "..");

describe("yolo mcp (Model Context Protocol 2024-11-05 Server)", () => {
  it("should respond to initialize request with protocolVersion and capabilities", async () => {
    const initReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    const resRaw = await handleMcpMessage(initReq, rootDir);
    expect(resRaw).not.toBeNull();
    const res = JSON.parse(resRaw!);
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(res.result.serverInfo.name).toBe(SERVER_NAME);
    expect(res.result.capabilities.tools).toBeDefined();
  });

  it("should negotiate protocolVersion 2025-06-18 for modern kernel clients", async () => {
    const initReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        clientInfo: { name: "aphrody-kernel", version: "1.4.0" },
      },
    });

    const resRaw = await handleMcpMessage(initReq, rootDir);
    expect(resRaw).not.toBeNull();
    const res = JSON.parse(resRaw!);
    expect(res.result.protocolVersion).toBe("2025-06-18");
  });

  it("should ignore notifications/initialized without response", async () => {
    const notif = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    const resRaw = await handleMcpMessage(notif, rootDir);
    expect(resRaw).toBeNull();
  });

  it("should respond to ping", async () => {
    const pingReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
    });

    const resRaw = await handleMcpMessage(pingReq, rootDir);
    expect(resRaw).not.toBeNull();
    const res = JSON.parse(resRaw!);
    expect(res.id).toBe(2);
    expect(res.result).toEqual({});
  });

  it("should list available tools with tools/list", async () => {
    const listReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
    });

    const resRaw = await handleMcpMessage(listReq, rootDir);
    expect(resRaw).not.toBeNull();
    const res = JSON.parse(resRaw!);
    expect(res.result.tools).toBeDefined();
    expect(res.result.tools.length).toBe(TOOLS.length);

    const toolNames = res.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("yolo_verify");
    expect(toolNames).toContain("yolo_status");
    expect(toolNames).toContain("yolo_scan");
    expect(toolNames).toContain("yolo_parse");
    expect(toolNames).toContain("yolo_doctor");
    expect(toolNames).toContain("yolo_bench");
  });

  it("should call yolo_status via tools/call", async () => {
    const callReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "yolo_status",
        arguments: {},
      },
    });

    const resRaw = await handleMcpMessage(callReq, rootDir);
    expect(resRaw).not.toBeNull();
    const res = JSON.parse(resRaw!);
    expect(res.id).toBe(4);
    expect(res.result.content[0].type).toBe("text");
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.schema).toBe("yolo.status/1");
    expect(payload.packages.length).toBeGreaterThan(0);
  });

  it("should call yolo_scan via tools/call", async () => {
    const callReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "yolo_scan",
        arguments: {
          path: "apps/cli/src",
          exts: "ts",
        },
      },
    });

    const resRaw = await handleMcpMessage(callReq, rootDir);
    expect(resRaw).not.toBeNull();
    const res = JSON.parse(resRaw!);
    expect(res.id).toBe(5);
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.schema).toBe("yolo.scan/1");
    expect(payload.totalFiles).toBeGreaterThan(5);
  });

  it("should call yolo_bench via tools/call", async () => {
    const callReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "yolo_bench",
        arguments: {
          iterations: 10_000,
        },
      },
    });

    const resRaw = await handleMcpMessage(callReq, rootDir);
    expect(resRaw).not.toBeNull();
    const res = JSON.parse(resRaw!);
    expect(res.id).toBe(6);
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.schema).toBe("yolo.bench/1");
    expect(payload.wyhash.opsPerSec).toBeGreaterThan(0);
  });

  it("should return error for unknown method or unknown tool", async () => {
    const badMethodReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "non_existent_method",
    });

    const resRaw1 = await handleMcpMessage(badMethodReq, rootDir);
    const res1 = JSON.parse(resRaw1!);
    expect(res1.error).toBeDefined();
    expect(res1.error.code).toBe(-32601);

    const badToolReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "unknown_tool",
      },
    });

    const resRaw2 = await handleMcpMessage(badToolReq, rootDir);
    const res2 = JSON.parse(resRaw2!);
    expect(res2.result.isError).toBe(true);
  });
});
