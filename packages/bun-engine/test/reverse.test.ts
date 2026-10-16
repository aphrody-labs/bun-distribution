import { describe, expect, test } from "bun:test";
import { reverseEngineeringPipeline } from "../src/pipeline/reverse";
import { inspectPeForGhidra, probeGhidraWindows } from "../src/re/ghidra";

describe("Ghidra Windows pipeline", () => {
  test("binds every reverse-engineering owner", () => {
    expect(reverseEngineeringPipeline.windowsHost).toBe("bun:windows");
    expect(reverseEngineeringPipeline.stages.map(({ id }) => id)).toEqual([
      "inspect-pe",
      "decompile-rust",
      "analyze-ghidra",
      "load-ntr",
    ]);
  });

  test.if(process.platform === "win32")("qualifies Win32 and both Ghidra sources", async () => {
    const probe = await probeGhidraWindows();
    expect(probe.windows.isWindows11).toBeTrue();
    expect(probe.sourceReady).toBeTrue();
    expect(probe.ntrExtensionReady).toBeTrue();
    expect(probe.windowsSdk).not.toBeNull();
  });

  test.if(process.platform === "win32")("parses the running PE through bun:windows", async () => {
    const image = await inspectPeForGhidra(process.execPath);
    expect(image.kind).toBe("exe");
    expect(image.machine).toMatch(/x64|arm64/);
    expect(image.sections).toBeGreaterThan(0);
  });
});
