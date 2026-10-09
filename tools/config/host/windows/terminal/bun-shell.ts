// Interactive Bun Shell for the Windows Terminal "Bun Shell" profile: each line runs through `$`.
import { $ } from "bun";
import { homedir } from "node:os";
import { resolve } from "node:path";

const home = homedir();
const expand = (p: string) => (p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? home + p.slice(1) : p);
const prompt = () => {
  const cwd = process.cwd();
  const shown = cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  process.stdout.write(`\x1b[38;5;213mbun\x1b[0m \x1b[36m${shown}\x1b[0m $ `);
};

async function run(line: string) {
  const cd = /^cd(?:\s+(.+))?$/.exec(line);
  if (cd) {
    try {
      process.chdir(resolve(expand(cd[1]?.trim().replace(/^["']|["']$/g, "") || "~")));
    } catch (e) {
      console.error(`cd: ${(e as Error).message}`);
    }
    return;
  }
  const exp = /^export\s+([A-Za-z_]\w*)=(.*)$/.exec(line);
  if (exp) {
    process.env[exp[1]] = exp[2].replace(/^["']|["']$/g, "");
    return;
  }
  const result = await $`${{ raw: line }}`.cwd(process.cwd()).env(process.env).nothrow();
  if (result.exitCode !== 0) console.error(`\x1b[31m[${result.exitCode}]\x1b[0m`);
}

process.on("SIGINT", () => {});
console.log(`Bun Shell ${Bun.version} (${Bun.revision.slice(0, 9)}) — exit pour quitter`);
prompt();
for await (const raw of console) {
  const line = raw.trim();
  if (line === "exit" || line === "quit") break;
  if (line) await run(line);
  prompt();
}
