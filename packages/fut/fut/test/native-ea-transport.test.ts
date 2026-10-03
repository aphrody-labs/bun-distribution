// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EaUtasClient, type EaHttpTransport } from "../src/ea/client.ts";
import type { WebHttpRequestOptions } from "@aphrody/bun/web";

test("EA API retains authenticated GET/POST/PUT/DELETE contracts through shared transport", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fut-ea-transport-"));
  const requests: Array<{ url: string; options: WebHttpRequestOptions }> = [];
  const transport: EaHttpTransport = {
    async fetch(url, options = {}) {
      requests.push({ url, options });
      return Response.json({
        credits: 1200,
        id: 44,
        auctionInfo: [{ bidState: "highest" }],
        totalCredits: 5,
        items: [8],
      });
    },
  };
  const client = new EaUtasClient({ sessionPath: join(directory, "session.json") }, transport);
  try {
    client.setSession({ sid: "fixture-sid", phishingToken: "fixture-phishing" });
    expect(await client.getUserCredits()).toBe(1200);
    await client.listAuction({ itemId: 8, startingBid: 150, buyNowPrice: 200 });
    await client.bid(44, 180);
    await client.quickSell([8]);
    expect(requests.map(({ options }) => options.method)).toEqual(["GET", "POST", "PUT", "DELETE"]);
    for (const { options } of requests) {
      const headers = new Headers(options.headers);
      expect(headers.get("x-ut-sid")).toBe("fixture-sid");
      expect(headers.get("x-ut-phishing-token")).toBe("fixture-phishing");
      expect(headers.get("origin")).toBe("https://www.ea.com");
    }
    expect(JSON.parse(requests[1]!.options.body!)).toEqual({
      itemData: { id: 8 },
      startingBid: 150,
      buyNowPrice: 200,
      duration: 3600,
    });
    expect(JSON.parse(requests[2]!.options.body!)).toEqual({ bid: 180 });
    expect(requests[3]!.url).toContain("/item?itemIds=8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
