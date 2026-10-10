// SPDX-License-Identifier: Apache-2.0
// Skips until the cdylib exists (cargo build -p aphrody-ffi, then APHRODY_FFI_DEV=1 or APHRODY_FFI_LIB=...).
import { expect, test } from "bun:test";
import { webJobWait, webMediaExtract, webMediaResolveSubmit } from "../src/engine";
import { resolveNativeLibraryPath } from "../src/library";

let available = false;
try {
  available = resolveNativeLibraryPath() !== undefined;
} catch {
  available = false;
}
const native = test.skipIf(!available);

native("media extraction crosses the shared Rust ABI", () => {
  const result = webMediaExtract(
    '<script>file: "https://cdn.example/video.m3u8"</script>',
    "https://player.example/embed",
  );
  expect(result.candidates[0]?.url).toBe("https://cdn.example/video.m3u8");
  expect(result.candidates[0]?.kind).toBe("hls");
});

native("invalid media URL completes without network access", async () => {
  const result = JSON.parse(await webJobWait(webMediaResolveSubmit("file:///tmp/video"))) as {
    error: string;
  };
  expect(result.error).toContain("only http and https");
});
