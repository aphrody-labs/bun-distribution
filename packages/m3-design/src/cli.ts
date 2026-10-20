// SPDX-License-Identifier: Apache-2.0
import { main as searchMain } from "../intelligence/ui-ux-pro-max/scripts/search.ts";
import { DesignCompiler } from "./generator.ts";
import { parseCliArgs, runCli } from "./handlers.ts";
import { nativeSpecValidator } from "./native.ts";
import { loadDesignSystemFromDisk } from "./node.ts";

const args = process.argv.slice(2);
const command = args[0] === "compile" ? "compile" : "search";

if (command === "compile") {
  const options = parseCliArgs(args.slice(1));
  if (!options) {
    console.error("Usage: m3-design compile --prompt <brief> [--color <hex>] [--design-system <id>]");
    process.exitCode = 2;
  } else {
    const compiler = new DesignCompiler({
      validateSpec: nativeSpecValidator,
      loadDesignSystem: loadDesignSystemFromDisk,
    });
    process.exitCode = runCli(options, compiler);
  }
} else {
  process.exitCode = await searchMain(args[0] === "search" ? args.slice(1) : args);
}
