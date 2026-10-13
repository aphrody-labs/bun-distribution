// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { findWorkspaceRoot } from "@aphrody/paths";

export function webOptions(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      host: { type: "string" },
      port: { type: "string" },
      root: { type: "string" },
    },
  });
  const bind = env.APHRODY_SITE_BIND ? new URL(`http://${env.APHRODY_SITE_BIND}`) : undefined;
  const hostname = values.host || bind?.hostname.replace(/^\[|\]$/g, "") || "127.0.0.1";
  const port = Number(values.port ?? (bind?.port || env.PORT || "3000"));
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid Aphrody web port");
  const configuredRoot = values.root || env.APHRODY_APP_UI_ROOT;
  return {
    staticRoot: configuredRoot
      ? resolve(configuredRoot)
      : resolve(findWorkspaceRoot(undefined, env), "crates/ui/app/ui-dist"),
    hostname,
    port,
  };
}

export async function startWeb(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { serveM3Site } = await import("@aphrody/web/site");
  return serveM3Site(webOptions(args, env));
}

export async function main(args: string[]): Promise<number> {
  const [action = "start", ...rest] = args;
  if ((args.includes("--help") && action !== "cloudflare") || action === "help") {
    console.log(
      "aphrody-product web start [--host HOST] [--port PORT] [--root DIR]\naphrody-product web public\naphrody-product web os\naphrody-product web cloudflare <wrangler arguments>",
    );
    return 0;
  }
  if (action === "os") {
    const { startForkWebOS } =
      await import("@aphrody/web-source/integrations/m3/packages/app-ui/webos.ts");
    const server = await startForkWebOS();
    console.log(`Aphrody WebOS: ${server.url}`);
    return 0;
  }
  if (action === "public") {
    if (rest.length) throw new Error("Public server uses DOWNLOADS_* and SITE_* configuration");
    const { startPublicServer } = await import("./downloads/server.ts");
    const server = startPublicServer();
    console.log(`Aphrody public: ${server.url}`);
    return 0;
  }
  if (action === "cloudflare") {
    return (await import("./cloudflare.ts")).main(rest);
  }
  if (action !== "start") throw new Error(`Unknown web action: ${action}`);
  const server = await startWeb(rest);
  console.log(`Aphrody: http://${server.hostname}:${server.port}`);
  return 0;
}
