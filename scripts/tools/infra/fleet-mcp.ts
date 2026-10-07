#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Stdio process launcher for the canonical native MCP on the private fleet hub.
const policy = await Bun.file("/srv/aphrody-lab/fleet-policy.json").json();
const { hub } = policy;
if (
  hub.host !== "vps" ||
  hub.stdio !== "/home/ubuntu/.local/bin/aphrody-mcp" ||
  hub.clientTokenFile !== "/home/ubuntu/.aphrody/private/a2a/bearer" ||
  hub.a2a !== "http://127.0.0.1:8788/" ||
  hub.toolHosts?.bun !== "/home/ubuntu/.bun/bin/bun" ||
  hub.toolHosts?.yolo !== "/srv/aphrody-lab/yolo-tool-host.mjs" ||
  hub.toolHosts?.m3 !== "/srv/aphrody-lab/m3-tool-host.mjs"
)
  throw new Error("Unexpected declared fleet hub");
const child = Bun.spawn([hub.stdio], {
  cwd: hub.workspace,
  env: {
    ...process.env,
    APHRODY_A2A_ENDPOINT: hub.a2a,
    APHRODY_A2A_TOKEN_FILE: hub.clientTokenFile,
    APHRODY_YOLO_TOOL_HOST: `${hub.toolHosts.bun} ${hub.toolHosts.yolo}`,
    APHRODY_M3_TOOL_HOST: `${hub.toolHosts.bun} ${hub.toolHosts.m3}`,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.once("SIGTERM", () => child.kill("SIGTERM"));
process.once("SIGINT", () => child.kill("SIGINT"));
process.exitCode = await child.exited;
