// SPDX-License-Identifier: Apache-2.0
// oxlint-disable-next-line import/no-unassigned-import -- démarre le serveur de test par son effet de bord à l'import
import "./server.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AgentBrowser, AgentPage } from "../src/index.ts";

let fixture: ReturnType<typeof Bun.serve>;
let url: string;

beforeAll(() => {
  fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        `<!doctype html><html><head><title>Before</title></head><body>
      <input id="query" aria-label="Query"><button id="submit" onclick="document.title=document.querySelector('#query').value">Go</button>
      <select id="choice"><option value="a">A</option><option value="b">B</option></select>
      <p id="result">Ready</p></body></html>`,
        { headers: { "content-type": "text/html" } },
      ),
  });
  url = `http://127.0.0.1:${fixture.port}/`;
});

afterAll(() => fixture.stop(true));

describe("agent-browser over Rust Obscura CDP", () => {
  test("snapshot references and actions use one Rust target", async () => {
    const page = await AgentBrowser.open(url);
    try {
      const snapshot = await page.snapshot();
      expect(snapshot.url).toBe(url);
      expect(snapshot.refs.get("@e1")?.role).toBe("input");
      expect(snapshot.raw).toContain("[ref=@e2]");
      await page.fill("@e1", "native");
      await page.type("#query", "!");
      expect(await page.evaluate<string>("document.querySelector('#query').value")).toBe("native!");
      await page.click("@e2");
      expect(await page.evaluate<string>("document.title")).toBe("native!");
      await page.select("#choice", "b");
      expect(await page.evaluate<string>("document.querySelector('#choice').value")).toBe("b");
      expect(await page.getText("#result")).toBe("Ready");
      expect(await page.getAttribute("#query", "id")).toBe("query");
      await page.waitFor("#result");
      const png = Buffer.from(await page.screenshot(), "base64");
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const pdf = Buffer.from(await page.pdf(), "base64");
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    } finally {
      await page.close();
    }
  });

  test("one-shot CLI command uses the local CDP client", async () => {
    const result = await AgentBrowser.execAsync(["open", url]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ url, title: "Before" });
  });

  test("direct AgentPage construction remains compatible", async () => {
    const page = new AgentPage("direct", { cdpUrl: process.env.APHRODY_BROWSER_CDP_URL });
    try {
      await page.goto(url);
      expect(page.url()).toBe(url);
      expect(await page.getText("#result")).toBe("Ready");
    } finally {
      await page.close();
    }
  });
});
