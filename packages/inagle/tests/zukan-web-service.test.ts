import { zukanReferenceFrame } from "../src/zukan/reference-frame.ts";
import { afterEach, expect, test } from "bun:test";
import { fetchZukanSkillPage, zukanSkillPageUrl } from "../src/zukan/skill-videos.ts";
import {
  createZukanWebService,
  setZukanWebServiceFactory,
  zukanResponseHtml,
} from "../src/zukan/web-service.ts";

afterEach(() => setZukanWebServiceFactory(null));

test("skill acquisition delegates the exact locale and page URL to Web", async () => {
  const urls: string[] = [];
  setZukanWebServiceFactory(() => ({
    response: async (url) => {
      urls.push(url);
      return {
        status: 200,
        truncated: false,
        body: `<ul class="skillListBox"><li><div class="nameBox"><span class="name">テスト</span></div><div class="lBox skillLbox"><div class="btnBox"><a data-movie-url="../movie/hash.wmv" data-poster-url="../poster/hash.png">Shot</a></div></div></li></ul>`,
      };
    },
    bytes: async () => new Uint8Array(),
  }));
  const skills = await fetchZukanSkillPage("ja", 2);
  expect(skills).toHaveLength(1);
  expect(skills[0]?.name).toBe("テスト");
  expect(skills[0]?.videoUrl).toBe("https://dxi4wb638ujep.cloudfront.net/1/movie/hash.webm");
  expect(urls).toEqual([zukanSkillPageUrl("ja", 2)]);
});

test("original HTML is preserved and incomplete or failed responses are rejected", async () => {
  let status = 200;
  let truncated = false;
  const html = "<script>const imageCount = 12;</script>\n";
  const service = {
    response: async () => ({ status, truncated, body: html }),
    bytes: async () => new Uint8Array(),
  };
  expect(await zukanResponseHtml(service, "https://zukan.inazuma.jp/en/", "Page")).toBe(html);
  status = 404;
  await expect(zukanResponseHtml(service, "https://zukan.inazuma.jp/en/", "Page")).rejects.toThrow(
    "Page: HTTP 404",
  );
  status = 200;
  truncated = true;
  await expect(zukanResponseHtml(service, "https://zukan.inazuma.jp/en/", "Page")).rejects.toThrow(
    "truncated response",
  );
});

test("host injection preserves binary bytes", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  setZukanWebServiceFactory(() => ({
    response: async () => ({ status: 200, truncated: false, body: "" }),
    bytes: async () => bytes,
  }));
  const service = await createZukanWebService();
  expect(await service.bytes("https://example.com/frame.png")).toEqual(bytes);
});

test("PNG frame validation preserves bytes and manifest dimensions/hash", () => {
  const bytes = Buffer.from("89504e470d0a1a0a0000000d494844520000000200000003", "hex");
  const frame = zukanReferenceFrame(bytes, "https://example.com/frame.png");
  expect(frame.bytes).toEqual(bytes);
  expect(frame.metadata.width).toBe(2);
  expect(frame.metadata.height).toBe(3);
  expect(frame.metadata.bytes).toBe(24);
  expect(frame.metadata.sha256).toBe(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"));
  expect(() => zukanReferenceFrame(new Uint8Array([0xff, 0]), "invalid")).toThrow("Invalid PNG");
});
