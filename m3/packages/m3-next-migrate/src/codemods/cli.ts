// SPDX-License-Identifier: Apache-2.0
// `next-migrate codemod ...` and `next-migrate pages-hints ...`.
import { resolve } from "node:path";
import { CODEMODS, CODEMOD_GROUPS, pagesHints, runCodemods } from "./index";

export const CODEMOD_HELP = `
CODEMODS:
  next-migrate codemod <ids|group|all> <DIR> [--apply] [--json]
  next-migrate codemod --list
  next-migrate pages-hints <DIR> [--json]

  Groups: ${CODEMOD_GROUPS.join(", ")}. Without --apply nothing is written (a report of what would change).
  next16     Next 14/15 -> 16: next.config, middleware -> proxy, async request APIs and route props, revalidateTag, package.json
  mui        MUI Button, Switch, Checkbox, Divider, Typography, Stack, Box, Paper -> Base UI wrappers and M3 classes
  tailwind4  Tailwind v3 -> v4: @tailwind directives, renamed utilities, tailwind.config -> @theme, PostCSS, package.json
  pages-hints  Pages Router -> App Router plan: where each file goes and what its data functions become (no rewrite)
`;

/** Run a codemod subcommand; returns the exit code. */
export async function runCodemodCli(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  const json = rest.includes("--json");
  const apply = rest.includes("--apply");
  const positional = rest.filter((a) => !a.startsWith("--"));

  if (command === "pages-hints") {
    const dir = resolve(process.cwd(), positional[0] ?? ".");
    const hints = await pagesHints(dir);
    if (json) console.log(JSON.stringify(hints, null, 2));
    else {
      console.log(
        `Pages Router plan for ${dir}: ${hints.length} file${hints.length === 1 ? "" : "s"}\n`,
      );
      for (const hint of hints) {
        console.log(`${hint.file}  ->  ${hint.target}  (${hint.kind})`);
        for (const note of hint.notes) console.log(`    - ${note}`);
      }
    }
    return 0;
  }

  if (rest.includes("--list")) {
    for (const codemod of CODEMODS)
      console.log(`${codemod.group.padEnd(10)} ${codemod.id.padEnd(22)} ${codemod.title}`);
    return 0;
  }
  const dirArg = positional.length > 1 ? positional[positional.length - 1]! : ".";
  const ids = positional.length > 1 ? positional.slice(0, -1) : positional;
  const dir = resolve(process.cwd(), dirArg);
  let reports;
  try {
    reports = await runCodemods({ dir, ids, apply });
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  if (json) {
    console.log(JSON.stringify(reports, null, 2));
    return 0;
  }
  const files = new Set(reports.map((r) => r.file));
  console.log(
    `${apply ? "Applied" : "Would apply"} ${reports.length} codemod run${reports.length === 1 ? "" : "s"} on ${files.size} file${files.size === 1 ? "" : "s"} in ${dir}\n`,
  );
  for (const report of reports) {
    console.log(
      `${report.file}${report.rename ? `  ->  ${report.rename}` : ""}  [${report.codemod}]`,
    );
    for (const change of report.changes) console.log(`    + ${change}`);
    for (const warning of report.warnings) console.log(`    ! ${warning}`);
  }
  if (!apply && reports.length > 0) console.log("\nRe-run with --apply to write the changes.");
  return 0;
}
