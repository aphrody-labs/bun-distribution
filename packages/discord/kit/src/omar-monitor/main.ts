// SPDX-License-Identifier: Apache-2.0
import { parseArgs } from "node:util";
import { startOmarMonitor } from "./service.ts";
import type { Policy } from "./store.ts";

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      policy: { type: "string" },
      probe: { type: "boolean" },
      smoke: { type: "boolean" },
      guide: { type: "boolean" },
      "upgrade-check": { type: "boolean" },
      "ready-check": { type: "boolean" },
      "expect-pid": { type: "string" },
      capabilities: { type: "boolean" },
    },
  });
  if (values.capabilities) {
    console.log(JSON.stringify({ upgradeProtocol: 2 }));
    process.exit(0);
  }
  if (!values.policy) throw new Error("--policy required");
  if (
    values["expect-pid"] &&
    ((!values["upgrade-check"] && !values["ready-check"]) ||
      !/^[1-9][0-9]*$/.test(values["expect-pid"]))
  )
    throw new Error("--expect-pid requires a readiness/upgrade check and a positive PID");
  const modes = [
    values.probe,
    values.smoke,
    values.guide,
    values["upgrade-check"],
    values["ready-check"],
  ].filter(Boolean);
  if (modes.length > 1) throw new Error("Choose one monitor mode");
  const policy = (await Bun.file(values.policy).json()) as Policy;
  await startOmarMonitor(policy, {
    expectedPid: values["expect-pid"] ? Number(values["expect-pid"]) : undefined,
    mode: values["ready-check"]
      ? "ready-check"
      : values["upgrade-check"]
        ? "upgrade-check"
        : values.smoke
          ? "smoke"
          : values.probe
            ? "probe"
            : values.guide
              ? "guide"
              : "serve",
  });
}
