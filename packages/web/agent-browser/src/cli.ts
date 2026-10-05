// SPDX-License-Identifier: Apache-2.0
import { AgentBrowser, type AgentPage } from "./client.ts";
import type { LaunchOptions } from "./types.ts";

export const browserHelp =
  "yolo browser <open|snapshot|click|fill|type|press|hover|select|get|eval|wait|screenshot|pdf> [args] [--url URL] [--cdp WS_URL] [--session ID]";

/** `yolo browser <command> [args]`: one CDP command on the Obscura endpoint, printed as one JSON result line. */
export async function runAgentBrowser(raw: readonly string[]): Promise<number> {
  if (raw[0] === "mcp") {
    console.error("Browser MCP tools are served by aphrody-mcp.");
    return 2;
  }
  if (raw.includes("--help") || raw.includes("-h") || raw[0] === "help") {
    console.log(browserHelp);
    return 0;
  }
  if (raw.includes("--version") || raw[0] === "version") {
    console.log("@aphrody/agent-browser 1.0.0-canary");
    return 0;
  }

  const args: string[] = [];
  const options: LaunchOptions = {};
  let url: string | undefined;
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === "--cdp") options.cdpUrl = raw[++i];
    else if (arg === "--session") options.session = raw[++i];
    else if (arg === "--url") url = raw[++i];
    else if (arg !== "--json" && arg !== undefined) args.push(arg);
  }
  const [command, ...rest] = args;
  if (!command) {
    console.error("yolo browser: a command is required; run --help");
    return 2;
  }

  let page: AgentPage | undefined;
  try {
    page = await AgentBrowser.open(command === "open" ? rest[0] : url, options);
    let data: unknown;
    switch (command) {
      case "open":
        data = { url: page.url(), title: await page.evaluate("document.title") };
        break;
      case "snapshot":
        data = (await page.snapshot()).raw;
        break;
      case "click":
        await page.click(rest[0] as string);
        data = true;
        break;
      case "fill":
        await page.fill(rest[0] as string, rest[1] ?? "");
        data = true;
        break;
      case "type":
        await page.type(rest[0] as string, rest[1] ?? "");
        data = true;
        break;
      case "press":
        await page.press(rest[0] as string);
        data = true;
        break;
      case "hover":
        await page.hover(rest[0] as string);
        data = true;
        break;
      case "select":
        await page.select(rest[0] as string, rest[1] ?? "");
        data = true;
        break;
      case "eval":
        data = await page.evaluate(rest[0] ?? "undefined");
        break;
      case "wait":
        await page.waitFor(/^\d+$/.test(rest[0] ?? "") ? Number(rest[0]) : (rest[0] as string));
        data = true;
        break;
      case "screenshot":
        data = await page.screenshot(rest[0]);
        break;
      case "pdf":
        data = await page.pdf(rest[0]);
        break;
      case "get":
        if (rest[0] === "text") data = await page.getText(rest[1] as string);
        else if (rest[0] === "attribute")
          data = await page.getAttribute(rest[1] as string, rest[2] as string);
        else throw new Error(`Unsupported get command: ${rest[0]}`);
        break;
      default:
        throw new Error(`Unsupported command: ${command}`);
    }
    console.log(JSON.stringify({ id: options.session ?? "", success: true, data }));
    return 0;
  } catch (error) {
    console.log(
      JSON.stringify({
        id: options.session ?? "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return 1;
  } finally {
    if (page) await page.close();
  }
}

// AgentBrowser.exec/execAsync run each command in this file as a child process (synchronous API, timeouts).
if (import.meta.main) process.exitCode = await runAgentBrowser(process.argv.slice(2));
