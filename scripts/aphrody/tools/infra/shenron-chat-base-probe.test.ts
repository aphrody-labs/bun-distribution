import { expect, test } from "bun:test";
import { BASE_PROBE_MODEL, baseProbeArgs } from "./shenron-chat-base-probe";
test("base probe has an explicit identity, loopback port, read-only base and one CPU", () => {
  const args = baseProbeArgs("aphrody:toolbox-f1346b77156f", "/runtime", "/base.gguf");
  expect(args).toContain(BASE_PROBE_MODEL);
  expect(args).toContain("127.0.0.1");
  expect(args).toContain("8800");
  expect(args).not.toContain("--lora");
  expect(args).toContain("/base.gguf:/models/base.gguf:ro");
  expect(args[args.indexOf("--cpus") + 1]).toBe("1");
  expect(args[args.indexOf("--memory") + 1]).toBe("3500m");
});
test("mutable images and mount separators are rejected", () => {
  expect(() => baseProbeArgs("latest", "/runtime", "/base")).toThrow();
  expect(() => baseProbeArgs("aphrody:toolbox-f1346b77156f", "/runtime:rw", "/base")).toThrow();
});
