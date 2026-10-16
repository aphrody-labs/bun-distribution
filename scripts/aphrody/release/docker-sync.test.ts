// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { parseArgs, plan } from "./docker-sync";

describe("docker-sync", () => {
  test("plans only hosts whose image differs", () => {
    const p = plan("vps", {
      vps: { "a:1": "sha256:x" },
      pc: { "a:1": "sha256:x" },
      dbfr: { "a:1": "sha256:y" },
    });
    expect(p).toEqual([
      { host: "dbfr", image: "a:1", from: "sha256:x", to: "sha256:y" },
    ]);
  });
  test("missing image on a host is shipped", () => {
    expect(
      plan("vps", { vps: { "a:1": "x" }, pc: {}, dbfr: { "a:1": "x" } }),
    ).toHaveLength(1);
  });
  test("rejects unknown options and hosts", () => {
    expect(() => parseArgs(["--nope"])).toThrow();
    expect(() => parseArgs(["--source", "mars"])).toThrow();
    expect(parseArgs([]).images).toContain("aphrody:runtime");
  });
});
