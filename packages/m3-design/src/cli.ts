#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { main as searchMain } from "../intelligence/ui-ux-pro-max/scripts/search.ts";

const args = process.argv.slice(2);
const command = args[0] === "compile" ? "compile" : "search";

if (command === "compile") {
  const { parseCliArgs, runCli } = await import("./handlers.ts");
  const options = parseCliArgs(args.slice(1));
  if (!options) {
    console.error("Usage: m3-design compile --prompt <brief> [--color <hex>] [--design-system <id>]");
    process.exitCode = 2;
  } else {
    const { DesignCompiler } = await import("./generator.ts");
    const { nativeSpecValidator } = await import("./native.ts");
    const { loadDesignSystemFromDisk } = await import("./node.ts");
    const compiler = new DesignCompiler({
      validateSpec: nativeSpecValidator,
      loadDesignSystem: loadDesignSystemFromDisk,
    });
    process.exitCode = runCli(options, compiler);
  }
} else {
  process.exitCode = await searchMain(args[0] === "search" ? args.slice(1) : args);
}
