// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";

export async function main(args: string[]): Promise<number> {
  const [action = "start"] = args;
  if (args.includes("--help") || action === "help") {
    console.log("aphrody-product web start|os [--help]");
    return 0;
  }
  if (action === "os") {
    const { startForkWebOS } =
      await import("@aphrody/web-source/integrations/m3/packages/app-ui/webos.ts");
    const server = await startForkWebOS();
    console.log(`Aphrody WebOS: ${server.url}`);
    return 0;
  }
  if (action !== "start") throw new Error(`Unknown web action: ${action}`);
  const { serveM3Site } = await import("@aphrody/web/site");
  const [hostname = "127.0.0.1", portText = process.env.PORT || "3000"] = (
    process.env.APHRODY_SITE_BIND || ""
  ).split(":");
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid Aphrody web port");
  const server = await serveM3Site({
    staticRoot:
      process.env.APHRODY_APP_UI_ROOT || resolve(findWorkspaceRoot(), "crates/ui/app/ui-dist"),
    hostname,
    port,
  });
  console.log(`Aphrody: http://${server.hostname}:${server.port}`);
  return 0;
}
