// SPDX-License-Identifier: Apache-2.0
import type { Context } from "../lib/context.ts";

export interface Command {
  name: string;
  summary: string;
  /** Returns the process exit code. Throws UsageError (creator-kit args) for bad arguments. */
  run(argv: string[], ctx: Context): Promise<number>;
}
