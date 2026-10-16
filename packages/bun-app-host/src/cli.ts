#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { resolve } from "node:path";
import { repositoryRoot } from "@aphrody/bun-workspace";
import { productCatalog } from "./build.ts";
import { startProduct } from "./product.ts";
import { verifyProduct } from "./verify.ts";

export async function runProductCLI(args: readonly string[]): Promise<void> {
  const [action = "help", root = repositoryRoot, receipt] = args;
  if (action === "help" || action === "--help")
    console.log(
      "Aphrody / Bun server: cli.ts serve [ROOT] | verify [BINARY] [RECEIPT] | --version",
    );
  else if (action === "--version") console.log("Aphrody / Bun server 1.4.4");
  else if (action === "serve") {
    const server = startProduct(await productCatalog(resolve(root)));
    console.log("Aphrody / Bun server: " + server.url);
    const stop = () => server.stop(true);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } else if (action === "verify") {
    const binary = resolve(
      root === repositoryRoot
        ? repositoryRoot +
            "/build/apps/bun-os-server" +
            (process.platform === "win32" ? ".exe" : "")
        : root,
    );
    console.log(
      JSON.stringify(
        await verifyProduct(
          binary,
          receipt ? resolve(receipt) : binary + ".json",
        ),
      ),
    );
  } else throw new Error("Use serve, verify or --version.");
}

if (import.meta.main) await runProductCLI(Bun.argv.slice(2));
