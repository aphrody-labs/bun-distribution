import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runDocsLinks } from "./docs-links.ts";

async function command(root: string, args: string[]): Promise<{ code: number; out: string }> {
  const child = Bun.spawn(args, {
    windowsHide: true,
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return { code, out: stdout.trim() };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export async function runRepositoryHealth(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: yolo ops repository-health [--root <repository>] [--stale <regex>] [--fail-on-links]");
    return 0;
  }
  const root = resolve(option(args, "--root") ?? process.cwd());
  const stale = option(args, "--stale");
  const failOnLinks = args.includes("--fail-on-links");
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || !["--root", "--stale", "--fail-on-links"].includes(arg))
      throw new Error("Usage: yolo ops repository-health [--root <repository>] [--stale <regex>] [--fail-on-links]");
    if (arg !== "--fail-on-links") index += 1;
  }
  const cargo = await readFile(`${root}/Cargo.toml`, "utf8").catch(() => "");
  const members = (cargo.match(/^members\s*=\s*\[[\s\S]*?^\]/m)?.[0].match(/"[^"]+"/g) ?? []).length;
  const [crates, packages, apps, docs, stubs, paths] = await Promise.all([
    command(root, ["sh", "-c", "find crates -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l"]),
    command(root, ["sh", "-c", "find packages -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l"]),
    command(root, ["sh", "-c", "find apps -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l"]),
    command(root, ["sh", "-c", "find docs -name '*.md' 2>/dev/null | wc -l"]),
    command(root, ["rg", "-l", "todo!\\(\\)|unimplemented!\\(\\)|TODO: ?implement|FIXME", "crates"]),
    command(root, ["rg", "-l", "/home/[a-z][a-z0-9_-]*/|C:\\\\Users\\\\|/Users/[a-z]", "scripts", "crates", ".cargo"]),
  ]);
  const staleResult = stale ? await command(root, ["rg", "-l", stale, "--glob", "*.md", "."]) : { code: 1, out: "" };
  console.log(`Cargo workspace members: ${members}`);
  console.log(`crate dirs: ${crates.out}; packages: ${packages.out}; apps: ${apps.out}; docs: ${docs.out}`);
  console.log(
    `stale references: ${staleResult.out ? staleResult.out.split("\n").length : 0}; stubs: ${stubs.out ? stubs.out.split("\n").length : 0}; machine paths: ${paths.out ? paths.out.split("\n").length : 0}`,
  );
  const links = await runDocsLinks(["--root", root, "--scope", "repository", "--json"]);
  return failOnLinks && links !== 0 ? links : 0;
}
