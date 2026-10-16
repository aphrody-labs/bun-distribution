// SPDX-License-Identifier: Apache-2.0
import { runAgentPlugins } from "./agent-plugins.ts";

/** Compatibility entry point; provider behavior belongs to the central manager. */
export async function runAgentPluginSync(args: string[]): Promise<number> {
  return runAgentPlugins(args);
}
if (import.meta.main)
  process.exit(await runAgentPluginSync(process.argv.slice(2)));
