// Forwards Rust-owned subcommands (`dbxv2`, Steam depot operations) to the `bunre` binary so `re`
// stays the single reverse-engineering CLI.
import { findBinary } from "./pipeline/runner.js";

export async function runBunre(args: string[]): Promise<number> {
  const bin = await findBinary();
  return Bun.spawn([bin, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
}

/** `re dbxv2 ...` */
export async function main(argv: string[]): Promise<number> {
  return runBunre(["dbxv2", ...argv]);
}
