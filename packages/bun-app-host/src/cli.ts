#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { resolve } from "node:path";
import { repositoryRoot } from "@aphrody/bun-workspace";
import { productCatalog } from "./build.ts";
import { startProduct } from "./product.ts";

if (import.meta.main) {
  const [action = "help", root = repositoryRoot] = Bun.argv.slice(2);
  if (action === "help" || action === "--help") console.log("Aphrody / Bun server: cli.ts serve [ROOT] | --version");
  else if (action === "--version") console.log("Aphrody / Bun server 1.4.4");
  else if (action === "serve") {
    const server = startProduct(await productCatalog(resolve(root)));
    console.log("Aphrody / Bun server: " + server.url);
    const stop = () => server.stop(true);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } else throw new Error("Use serve or --version.");
}
