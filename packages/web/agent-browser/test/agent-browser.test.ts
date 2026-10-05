// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { AgentBrowser, DEFAULT_OBSCURA_CDP_URL, prepareAgentBrowserArgs } from "../src/index.ts";

describe("@aphrody/agent-browser", () => {
  it("runs the local Bun CLI without an external agent-browser binary", () => {
    const res = AgentBrowser.exec(["--version"]);
    expect(res.success).toBe(true);
    expect(res.data).toContain("@aphrody/agent-browser");
  });

  it("executes --help cleanly", () => {
    const res = AgentBrowser.exec(["--help"]);
    expect(res.success).toBe(true);
  });

  it("routes browser commands to the Obscura CDP endpoint", () => {
    const args = prepareAgentBrowserArgs(["open", "https://example.com"], { session: "test" });
    expect(args).toContain("--cdp");
    expect(args[args.indexOf("--cdp") + 1]).toBe(
      process.env.APHRODY_BROWSER_CDP_URL ?? process.env.APHRODY_CDP_URL ?? DEFAULT_OBSCURA_CDP_URL,
    );
    expect(args).toContain("--json");
    expect(args.at(-1)).toBe("--json");
    expect(args).toContain("test");
  });

  it("preserves explicit CDP and maps headed mode without duplicates", () => {
    const args = prepareAgentBrowserArgs(
      ["open", "--cdp", "ws://127.0.0.1:9333/devtools/browser", "--json"],
      { cdpUrl: "ws://127.0.0.1:9222/devtools/browser", headless: false },
    );
    expect(args.filter((arg) => arg === "--cdp")).toHaveLength(1);
    expect(args.filter((arg) => arg === "--json")).toHaveLength(1);
    expect(args).toContain("--headed");
    expect(args).not.toContain("--headless");
  });

  it("runs metadata commands asynchronously without starting a browser", async () => {
    const args = prepareAgentBrowserArgs(["--help"]);
    expect(args).not.toContain("--cdp");
    const res = await AgentBrowser.execAsync(["--help"]);
    expect(res.success).toBe(true);
  });

  it("does not start a second MCP host", async () => {
    const cli = join(import.meta.dir, "../src/cli.ts");
    const proc = Bun.spawn([process.execPath, cli, "mcp"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(status).toBe(2);
    expect(stderr).toContain("aphrody-mcp");
  });
});
