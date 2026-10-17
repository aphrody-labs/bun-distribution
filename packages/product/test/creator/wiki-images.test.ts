import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "../../src/creator/commands/wiki-images.ts";
import { resolveTarget, safeName, titleFromPath } from "../../src/creator/commands/wiki-images/mediawiki.ts";

let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/wiki/Sol/Gallery") {
        return new Response(
          `<html><head><link rel="EditURI" type="application/rsd+xml" href="${base}/api.php?action=rsd"></head></html>`,
        );
      }
      if (url.pathname.startsWith("/files/")) return new Response(`bytes:${url.pathname}`);
      if (url.pathname === "/api.php") {
        const q = url.searchParams;
        if (q.get("meta") === "siteinfo") return Response.json({ query: { general: {} } });
        const info = (n: string, size: number) => ({
          url: `${base}/files/${n}`,
          size,
          width: 10,
          height: 10,
          mime: "image/png",
          descriptionurl: `${base}/wiki/File:${n}`,
        });
        if (q.get("generator") === "images") {
          if (!q.get("gimcontinue")) {
            return Response.json({
              continue: { gimcontinue: "x", continue: "gimcontinue||" },
              query: {
                pages: {
                  "1": {
                    title: "File:A.png",
                    imageinfo: [info("A.png", "bytes:/files/A.png".length)],
                  },
                },
              },
            });
          }
          return Response.json({
            query: {
              pages: {
                "2": {
                  title: "File:B?.png",
                  imageinfo: [info("B.png", "bytes:/files/B.png".length)],
                },
                "3": {
                  title: "File:notes.pdf",
                  imageinfo: [info("notes.pdf", 12)],
                },
              },
            },
          });
        }
      }
      return new Response("nope", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

test("titleFromPath decodes wiki paths", () => {
  expect(titleFromPath(new URL("https://x.fandom.com/wiki/Sol_Badguy/Gallery"))).toBe("Sol Badguy/Gallery");
  expect(titleFromPath(new URL("https://x.org/index.php?title=A_b"))).toBe("A b");
});

test("safeName strips reserved characters and device names", () => {
  expect(safeName('a<b>:"c".png')).toBe("a_b___c_.png");
  expect(safeName("CON.png")).toBe("_CON.png");
  expect(safeName("trail. ")).toBe("trail");
});

test("resolveTarget finds api.php through the RSD link", async () => {
  const target = await resolveTarget(`${base}/wiki/Sol/Gallery`);
  expect(target.apiUrl).toBe(`${base}/api.php`);
  expect(target.title).toBe("Sol/Gallery");
});

test("downloads gallery images across API continuations, filters non images", async () => {
  const out = await mkdtemp(join(tmpdir(), "wiki-images-"));
  const code = await run([`${base}/wiki/Sol/Gallery`, "--out", out], fetch);
  expect(code).toBe(0);
  expect((await readdir(out)).toSorted()).toEqual(["A.png", "B_.png", "manifest.json"]);
  expect(await readFile(join(out, "A.png"), "utf8")).toBe("bytes:/files/A.png");
  // second run skips existing files with the same size
  const logs: string[] = [];
  const original = console.log;
  console.log = (line: string) => logs.push(line);
  try {
    expect(await run([`${base}/wiki/Sol/Gallery`, "--out", out], fetch)).toBe(0);
  } finally {
    console.log = original;
  }
  expect(logs.join("\n")).toContain("déjà présents : 2");
});
