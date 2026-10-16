import { afterEach, expect, test } from "bun:test";
import { crawlZukanOrderPages } from "../src/zukan/order.ts";
import { setWebCdpPageFactory } from "../src/zukan/web-cdp.ts";

const fullPage = `<ul class="charaListBox">${[1, 2, 3].map(id => `<li><img src="https://example.cloudfront.net/1/hash${id}.png" alt="Character ${id}" /></li>`).join("")}</ul>`;

afterEach(() => setWebCdpPageFactory(null));

function fixture(pages: (string | Error)[], status = 200) {
  let current = -1;
  let closed = false;
  setWebCdpPageFactory(async () => ({
    goto: async () => {
      current++;
      const page = pages[current];
      if (page instanceof Error) throw page;
      return { status, ok: status < 400 };
    },
    evaluate: async <T>() => 3 as T,
    content: async () => pages[current] as string,
    close: async () => {
      closed = true;
    },
  }));
  return () => closed;
}

const log = () => {};

test("complete short character page returns ordered results and closes the transport", async () => {
  const closed = fixture([fullPage]);
  const rows = await crawlZukanOrderPages({ perPage: 4, maxPages: 2, log });
  expect(rows.map(row => row.order)).toEqual([0, 1, 2]);
  expect(rows.map(row => row.zukanHash)).toEqual(["hash1", "hash2", "hash3"]);
  expect(closed()).toBe(true);
});

test("an empty terminal page completes a full preceding page", async () => {
  const closed = fixture([fullPage, '<ul class="charaListBox"></ul>']);
  expect(await crawlZukanOrderPages({ perPage: 3, maxPages: 2, log })).toHaveLength(3);
  expect(closed()).toBe(true);
});

test("a failed later page rejects instead of returning earlier partial results", async () => {
  const closed = fixture([fullPage, new Error("navigation disconnected")]);
  await expect(crawlZukanOrderPages({ perPage: 3, maxPages: 2, log })).rejects.toThrow(
    "partial results were discarded",
  );
  expect(closed()).toBe(true);
});

test("HTTP failures and an empty first page cannot report a successful crawl", async () => {
  const closed = fixture([fullPage], 503);
  await expect(crawlZukanOrderPages({ perPage: 4, maxPages: 1, log })).rejects.toThrow("page 1");
  expect(closed()).toBe(true);
  fixture(['<ul class="charaListBox"></ul>']);
  await expect(crawlZukanOrderPages({ perPage: 3, maxPages: 1, log })).rejects.toThrow("page 1");
});

test("a full last allowed page rejects as incomplete", async () => {
  const closed = fixture([fullPage]);
  await expect(crawlZukanOrderPages({ perPage: 3, maxPages: 1, log })).rejects.toThrow("before completion");
  expect(closed()).toBe(true);
});

test("invalid bounds fail before connecting", async () => {
  setWebCdpPageFactory(async () => {
    throw new Error("must not connect");
  });
  await expect(crawlZukanOrderPages({ maxPages: 0, log })).rejects.toThrow("positive safe integers");
  await expect(crawlZukanOrderPages({ perPage: 1.5, log })).rejects.toThrow("positive safe integers");
});
