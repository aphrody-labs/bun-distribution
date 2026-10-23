import { expect, test } from "bun:test";
import { CHAT_DIGESTS, chatRecoveryCompose } from "./shenron-chat-recovery";
const options = {
  image: "aphrody:toolbox-f1346b77156f",
  root: "/srv/chat",
  runtime: "/runtime",
  base: "/models/base.gguf",
  adapter: "/models/adapter.gguf",
};
test("the exact adapter runs on loopback with read-only weights and bounded resources", () => {
  const service = chatRecoveryCompose(options).services["shenron-chat"];
  expect(service.command).toContain("127.0.0.1");
  expect(service.command).toContain("shenron-chat-v2");
  expect(service.volumes.every(m => m.endsWith(":ro"))).toBe(true);
  expect(service.mem_limit).toBe("4500m");
  expect(service.cpus).toBe(5);
  expect(service.command.slice(service.command.indexOf("--threads-batch"), -2)).toEqual(["--threads-batch", "5"]);
  expect(service.read_only).toBe(true);
  expect(service.user).toBe("1000:1000");
  expect(CHAT_DIGESTS.adapter).toBe("aab485357c68fdcbb6d4ba55911632b8228964106047db035e0223e2aecc6107");
});
test("mutable images and invalid mount paths are refused", () => {
  expect(() => chatRecoveryCompose({ ...options, image: "aphrody:latest" })).toThrow();
  for (const path of ["relative", "/tmp/a:b", "/tmp/a\nb"]) {
    expect(() => chatRecoveryCompose({ ...options, adapter: path })).toThrow();
  }
});
