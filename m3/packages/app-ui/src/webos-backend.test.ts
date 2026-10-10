// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { memoryImageStore, openWebOs } from "@aphrody/webos-wasm";
import { SpacedriveClient } from "@aphrody/drive-client";
import {
  setWebOsForTesting,
  wantsHttpBackend,
  webOsRagSearch,
  webOsReadDir,
  webOsReadText,
  webOsTransport,
} from "./webos-backend";
import { fsReadDir, getRagStats, runRagSearch, usesBrowserBackend } from "./tauri-bridge";
import { keyToInput } from "./routes/terminal/keys";

const wasm = await Bun.file(
  join(import.meta.dir, "../../../../packages/web/webos-wasm/wasm/aphrody_webos_wasm_bg.wasm"),
).arrayBuffer();

beforeEach(() => {
  setUrl("/");
  setWebOsForTesting(openWebOs({ store: memoryImageStore(), wasm, flushDelayMs: 1 }));
});
afterEach(() => setWebOsForTesting(undefined));

const setUrl = (path: string) =>
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    `http://localhost${path}`,
  );
const sd = (path: string) => ({ Physical: { device_slug: "webos", path } });
const text = (value: string) => new TextEncoder().encode(value);

test("outside Tauri the Rust backend is used unless ?backend=http", () => {
  expect(usesBrowserBackend()).toBe(true);
  expect(wantsHttpBackend("?backend=http")).toBe(true);
  setUrl("/?backend=http");
  expect(usesBrowserBackend()).toBe(false);
});

test("Files commands read the WASM file system", async () => {
  const os = await (await import("./webos-backend")).getWebOs();
  os.fs.write("/home/user/docs/a.txt", text("alpha"));
  const listing = await fsReadDir("/home/user/docs");
  expect(listing?.entries).toEqual([
    { name: "a.txt", path: "/home/user/docs/a.txt", is_dir: false, size: 5 },
  ]);
  expect((await webOsReadDir("/home/user")).entries.map((e) => e.name)).toContain("docs");
  expect((await webOsReadText("/home/user/docs/a.txt")).content).toBe("alpha");
});

test("RAG search and stats come from the Rust module", async () => {
  const os = await (await import("./webos-backend")).getWebOs();
  os.fs.write("/home/user/zebra.md", text("# Zebra\n\nStripes help a zebra confuse predators.\n"));
  os.fs.write("/home/user/other.md", text("# Other\n\nNothing relevant here.\n"));
  const response = await runRagSearch("zebra stripes", 3);
  expect(response.results[0]?.path).toBe("/home/user/zebra.md");
  expect(response.results[0]?.text).toContain("Stripes");
  expect(response.results[0]?.language).toBe("en");
  expect((await webOsRagSearch("zebra", 1)).length).toBe(1);
  expect(await getRagStats()).toEqual({ documents: 2, chunks: 2 });
});

test("the explorer client lists, creates through the terminal, renames and deletes", async () => {
  const client = new SpacedriveClient(webOsTransport());
  const libraries = await client.execute<unknown, { id: string; name: string }[]>(
    "query:libraries.list",
    {},
  );
  client.setCurrentLibrary(libraries[0]!.id);
  const os = await (await import("./webos-backend")).getWebOs();
  const terminal = os.terminal(80, 24);
  terminal.type("mkdir photos\recho hi > photos/note.txt\r");
  const listing = await client.execute<unknown, { files: { name: string; kind: string }[] }>(
    "query:files.directory_listing",
    {
      path: sd("/home/user"),
      limit: null,
      include_hidden: null,
      sort_by: "name",
      folders_first: true,
    },
  );
  expect(listing.files.map((f) => [f.name, f.kind])).toEqual([["photos", "Directory"]]);
  await client.execute("action:files.rename", {
    target: sd("/home/user/photos/note.txt"),
    new_name: "renamed.txt",
  });
  expect(new TextDecoder().decode(os.fs.read("/home/user/photos/renamed.txt"))).toBe("hi\n");
  await client.execute("action:files.delete", {
    targets: { paths: [sd("/home/user/photos")] },
    permanent: true,
    recursive: true,
  });
  await expect(
    client.execute("query:files.directory_listing", {
      path: sd("/home/user/photos"),
      limit: null,
      include_hidden: null,
      sort_by: "name",
      folders_first: null,
    }),
  ).rejects.toThrow();
});

const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
  keyToInput({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

test("terminal key mapping", () => {
  expect(key("a")).toBe("a");
  expect(key("Enter")).toBe("\r");
  expect(key("ArrowUp")).toBe("\x1b[A");
  expect(key("c", { ctrlKey: true })).toBe("\x03");
  expect(key("c", { metaKey: true })).toBeNull();
  expect(key("Shift")).toBeNull();
});
