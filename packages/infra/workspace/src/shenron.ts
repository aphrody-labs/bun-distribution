// SPDX-License-Identifier: Apache-2.0
// Shenron operations through Aphrody Infra. The product source (site, bot, pipeline, Koharu) lives in
// aphrody-labs/shenron and runs its own package scripts; its host plane (systemd, nginx, deploy adapter,
// backups) stays in this repository's Infra catalog.
import { runRustBridge } from "./bridges.ts";

const USAGE = "usage: aphrody-ops shenron <infra|service|deploy|dev-env> ...";

export async function runShenron(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  const inherit = { stdout: "inherit", stderr: "inherit" } as const;
  if (action === "infra") {
    if (!rest.length)
      throw new Error("usage: aphrody-ops shenron infra <aphrody-infra arguments...>");
    return runRustBridge("aphrody-infra", rest, inherit);
  }
  if (action === "service") return runRustBridge("aphrody-infra", ["service", ...rest], inherit);
  if (action === "deploy") {
    const targetIndex = rest.indexOf("--target");
    if (
      targetIndex < 0 ||
      !rest[targetIndex + 1] ||
      !rest.includes("--release") ||
      !rest[rest.indexOf("--release") + 1] ||
      rest.includes("--stack") ||
      rest.filter((argument) => argument === "--target").length !== 1
    )
      throw new Error(
        "usage: aphrody-ops shenron deploy --target <infra-target> --release <path> [--apply]",
      );
    return runRustBridge("aphrody-infra", ["deploy", "--stack", "shenron", ...rest], inherit);
  }
  if (action === "dev-env") return runRustBridge("aphrody-infra", ["dev-env", ...rest], inherit);
  throw new Error(USAGE);
}
