import { describe, expect, test } from "bun:test";
import { classifyAndroidEntries, planLowering } from "../src";

describe("Android artifact classification", () => {
  test.each([
    ["apk", ["AndroidManifest.xml", "classes.dex", "lib/arm64-v8a/libapp.so"]],
    ["aab", ["base/manifest/AndroidManifest.xml", "base/dex/classes.dex"]],
    ["apks", ["splits/base-master.apk", "toc.pb"]],
    ["apex", ["apex_manifest.pb", "apex_payload.img"]],
  ] as const)("classifies %s", (format, entries) => {
    expect(classifyAndroidEntries(entries).format).toBe(format);
  });

  test("does not claim opaque conversion", () => {
    const artifact = classifyAndroidEntries([
      "AndroidManifest.xml",
      "classes.dex",
    ]);
    expect(planLowering(artifact, "wasm").convertible).toBeFalse();
    expect(planLowering(artifact, "elf", true)).toMatchObject({
      convertible: true,
      strategy: "native-rebuild",
    });
  });
});
