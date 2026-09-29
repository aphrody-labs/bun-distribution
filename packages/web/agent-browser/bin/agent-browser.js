#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { AgentBrowser } from "../src/client.ts";

const raw = process.argv.slice(2);
if (raw[0] === "mcp") {
  console.error("Browser MCP tools are served by aphrody-mcp.");
  process.exit(2);
}
if (raw.includes("--help") || raw.includes("-h") || raw[0] === "help") {
  console.log("agent-browser <open|snapshot|click|fill|type|press|hover|select|get|eval|wait|screenshot|pdf> [args] [--url URL] [--cdp WS_URL]");
  process.exit(0);
}
if (raw.includes("--version") || raw[0] === "version") {
  console.log("@aphrody/agent-browser 1.0.0-canary");
  process.exit(0);
}

const args = [];
const options = {};
let url;
for (let i = 0; i < raw.length; i++) {
  const arg = raw[i];
  if (arg === "--cdp") options.cdpUrl = raw[++i];
  else if (arg === "--session") options.session = raw[++i];
  else if (arg === "--url") url = raw[++i];
  else if (arg === "--json") continue;
  else args.push(arg);
}
const [command, ...rest] = args;
if (!command) {
  console.error("agent-browser command is required; run --help");
  process.exit(2);
}

let page;
try {
  page = await AgentBrowser.open(command === "open" ? rest[0] : url, options);
  let data;
  switch (command) {
    case "open": data = { url: page.url(), title: await page.evaluate("document.title") }; break;
    case "snapshot": data = (await page.snapshot()).raw; break;
    case "click": await page.click(rest[0]); data = true; break;
    case "fill": await page.fill(rest[0], rest[1] ?? ""); data = true; break;
    case "type": await page.type(rest[0], rest[1] ?? ""); data = true; break;
    case "press": await page.press(rest[0]); data = true; break;
    case "hover": await page.hover(rest[0]); data = true; break;
    case "select": await page.select(rest[0], rest[1] ?? ""); data = true; break;
    case "eval": data = await page.evaluate(rest[0] ?? "undefined"); break;
    case "wait": await page.waitFor(/^\d+$/.test(rest[0] ?? "") ? Number(rest[0]) : rest[0]); data = true; break;
    case "screenshot": data = await page.screenshot(rest[0]); break;
    case "pdf": data = await page.pdf(rest[0]); break;
    case "get":
      if (rest[0] === "text") data = await page.getText(rest[1]);
      else if (rest[0] === "attribute") data = await page.getAttribute(rest[1], rest[2]);
      else throw new Error(`Unsupported get command: ${rest[0]}`);
      break;
    default: throw new Error(`Unsupported command: ${command}`);
  }
  console.log(JSON.stringify({ id: options.session ?? "", success: true, data }));
} catch (error) {
  console.log(JSON.stringify({ id: options.session ?? "", success: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  if (page) await page.close();
}
