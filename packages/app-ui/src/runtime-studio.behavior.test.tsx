// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MONOREPO_BUN_CATALOG } from "./generated/bun-catalog";
import { BENCHMARK_ITERATIONS, RuntimeStudio } from "./routes/studio/RuntimeStudio";
import { studioSection } from "./routes/studio/navigation";

let root: Root | undefined;
const host = document.createElement("div");
document.body.append(host);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.replaceChildren();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

test("Studio > Moteur shows the Bun catalog and runs the yolo-core probes over IPC", async () => {
  expect(studioSection("runtime")).toBe("runtime");
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: async (command: string, args: Record<string, unknown>) => {
        calls.push({ command, args });
        return command === "aphrody_system_stats"
          ? { os: "linux", arch: "x86_64", timestamp_ms: 0 }
          : { message: "ok", latency_us: 42 };
      },
    },
  });
  root = createRoot(host);
  await act(async () => root!.render(createElement(RuntimeStudio)));
  expect(host.textContent).toContain(`Bun ${MONOREPO_BUN_CATALOG.bunVersion}`);
  expect(host.querySelectorAll("li")).toHaveLength(MONOREPO_BUN_CATALOG.capabilities.length);
  const [probe, bench] = [...host.querySelectorAll("button")];
  await act(async () => probe!.click());
  expect(host.querySelector("output")?.textContent).toContain("linux x86_64");
  await act(async () => bench!.click());
  expect(host.querySelector("output")?.textContent).toContain("42 µs");
  expect(calls).toEqual([
    { command: "aphrody_system_stats", args: {} },
    {
      command: "aphrody_benchmark",
      args: { iterations: BENCHMARK_ITERATIONS },
    },
  ]);
});
