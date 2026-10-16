// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { parseOptions, privateEndpoint, sessionStamp } from "./kernel-session.ts";
import { classify } from "./live-openai-inventory.ts";
import { compareVersions, findMsixPackage, parsePackageFullName } from "./msix.ts";

describe("msix", () => {
  test("parses package full names into identity and family", () => {
    expect(parsePackageFullName("OpenAI.Codex_26.930.7945.0_x64__2p2nqsd0c76g0")).toEqual({
      name: "OpenAI.Codex",
      version: "26.930.7945.0",
      architecture: "x64",
      family: "OpenAI.Codex_2p2nqsd0c76g0",
      fullName: "OpenAI.Codex_26.930.7945.0_x64__2p2nqsd0c76g0",
    });
    expect(parsePackageFullName("NotAPackage")).toBeUndefined();
    expect(parsePackageFullName("Name_latest_x64__pub")).toBeUndefined();
  });

  test("compares dotted versions numerically", () => {
    expect(compareVersions("26.930.7945.0", "26.1000.1.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0.10", "2.0.0.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3.4", "1.2.3.4")).toBe(0);
  });

  test("reports no package for an unknown name", () => {
    expect(findMsixPackage("Aphrody.Absent.Package")).toBeUndefined();
  });
});

describe("live inventory", () => {
  test("classifies sensitive names before extensions", () => {
    expect(classify("C:/u/.codex/auth.json", "codex-home")).toBe("sensitive-metadata-only");
    expect(classify("C:/app/ChatGPT.exe", "msix-install")).toBe("binary");
    expect(classify("C:/app/resources/app.asar", "msix-install")).toBe("archive");
    expect(classify("C:/u/state.sqlite", "codex-home")).toBe("database-metadata-only");
    expect(classify("C:/app/blob", "msix-localstate")).toBe("application-data");
    expect(classify("C:/u/notes", "codex-home")).toBe("user-data-metadata-only");
  });

  test("stamps sessions as yyyyMMddTHHmmssfffZ", () => {
    expect(sessionStamp(new Date("2026-10-09T15:32:00.123Z"))).toBe("20261009T153200123Z");
  });

  test("names a private endpoint per run", () => {
    const endpoint = privateEndpoint("probe", "20261009T153200123Z");
    expect(endpoint).toContain("aphrody-probe-20261009T153200123Z");
  });

  test("parses --name value options", () => {
    expect(parseOptions(["--source", "a.exe"], ["source"]).get("source")).toBe("a.exe");
    expect(parseOptions(["--help"], []).has("help")).toBe(true);
    expect(() => parseOptions(["--unknown", "x"], ["source"])).toThrow();
    expect(() => parseOptions(["--source"], ["source"])).toThrow();
  });
});
