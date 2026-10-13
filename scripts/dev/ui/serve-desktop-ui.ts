#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Historical desktop preview consumes the canonical product UI transport.
import { parseArgs } from "node:util";
import { main } from "@aphrody/product/web";

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      port: { type: "string", short: "p", default: process.env.PORT ?? "1421" },
      host: { type: "string", short: "h", default: process.env.HOST ?? "127.0.0.1" },
      backend: { type: "string" },
      help: { type: "boolean" },
    },
  });
  const args = values.help ? ["--help"] : ["--port", values.port!, "--host", values.host!];
  if (values.backend) args.push("--backend", values.backend);
  process.exitCode = await main(["start", ...args]);
}
