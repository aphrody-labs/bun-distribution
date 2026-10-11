// Installs the versioned terminal configuration of this directory:
//   settings.json            -> Windows Terminal LocalState (previous file kept as settings.json.bak)
//   rio/config.toml, themes/ -> %RIO_CONFIG_HOME%, else %USERPROFILE%\AppData\Local\rio
// `--check` only reports drift (exit 1). Regenerate the themes first with `aphrody identity terminal-theme`.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const check = process.argv.includes("--check");
const here = import.meta.dir;
const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const rio = process.env.RIO_CONFIG_HOME ?? join(homedir(), "AppData", "Local", "rio");
const wt = join(local, "Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState");

const pairs: [string, string][] = [[join(here, "rio", "config.toml"), join(rio, "config.toml")]];
for (const name of readdirSync(join(here, "rio", "themes")))
  pairs.push([join(here, "rio", "themes", name), join(rio, "themes", name)]);
if (existsSync(wt)) pairs.push([join(here, "settings.json"), join(wt, "settings.json")]);
else console.log(`skip       Windows Terminal (${wt} absent)`);

let drift = 0;
for (const [from, to] of pairs) {
  const text = readFileSync(from);
  if (existsSync(to) && readFileSync(to).equals(text)) {
    console.log(`unchanged  ${to}`);
    continue;
  }
  if (check) {
    console.log(`DIFFERS    ${to}`);
    drift++;
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to)) copyFileSync(to, `${to}.bak`);
  writeFileSync(to, text);
  console.log(`installed  ${to}`);
}
process.exit(drift ? 1 : 0);
