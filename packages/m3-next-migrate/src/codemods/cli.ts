// SPDX-License-Identifier: Apache-2.0
// `next-migrate codemod ...` and `next-migrate pages-hints ...`: the @aphrody/next-bun codemod CLI with the MUI group.
import {
  codemodHelp,
  runCodemodCli as runNextCodemodCli,
} from "@aphrody/next-bun/codemods/cli";
import { CODEMODS } from "./index";

const options = {
  program: "next-migrate",
  codemods: CODEMODS,
  groupHelp: [
    "mui        MUI Button, Switch, Checkbox, Divider, Typography, Stack, Box, Paper -> Base UI wrappers and M3 classes",
  ],
};

export const CODEMOD_HELP = codemodHelp(options);

/** Run a codemod subcommand; returns the exit code. */
export async function runCodemodCli(args: string[]): Promise<number> {
  return await runNextCodemodCli(args, options);
}
