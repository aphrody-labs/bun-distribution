// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { webJobWait, webMediaExtract, webMediaResolveSubmit } from "./index.ts";

test("media extraction crosses the shared Rust ABI", () => {
  const result = webMediaExtract(
    '<script>file: "https://cdn.example/video.m3u8"</script>',
    "https://player.example/embed",
  );
  expect(result.candidates[0]?.url).toBe("https://cdn.example/video.m3u8");
  expect(result.candidates[0]?.kind).toBe("hls");
});

test("invalid media URL completes without network access", async () => {
  const result = JSON.parse(await webJobWait(webMediaResolveSubmit("file:///tmp/video"))) as {
    error: string;
  };
  expect(result.error).toContain("only http and https");
});
