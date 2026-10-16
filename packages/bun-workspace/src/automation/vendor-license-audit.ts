import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function gitPaths(root: string, args: string[]) {
  const result = Bun.spawnSync(["git", "-C", root, "ls-files", "-z", ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ls-files ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
  return new Set(result.stdout.toString().split("\0").filter(Boolean));
}

export async function runVendorLicenseAudit(args: string[]): Promise<number> {
  let root = process.cwd();
  const vendorRoots: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--vendor") {
      const value = args[++index];
      if (!value) throw new Error("--vendor requires a repository-relative path");
      vendorRoots.push(value);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops vendor-license-audit [--root <repository>] --vendor <path> [...]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root || vendorRoots.length === 0) throw new Error("--root and at least one --vendor are required");
  root = resolve(root);
  const tracked = gitPaths(root, []);
  const ignored = gitPaths(root, ["--others", "--ignored", "--exclude-standard", "--", ...vendorRoots]);
  const failures: string[] = [];
  for (const vendorRoot of vendorRoots) {
    const absoluteRoot = join(root, vendorRoot);
    if (!existsSync(absoluteRoot)) {
      failures.push(`${vendorRoot}: missing`);
      continue;
    }
    const files = readdirSync(absoluteRoot, { withFileTypes: true });
    const notice = files.some(entry => entry.isFile() && /^(?:license|copying|notice|readme)/iu.test(entry.name));
    if (!notice) failures.push(`${vendorRoot}: no local license/readme notice`);
    const stack = [{ absolute: absoluteRoot, relative: vendorRoot }];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      for (const entry of readdirSync(current.absolute, {
        withFileTypes: true,
      })) {
        const relative = `${current.relative}/${entry.name}`;
        const absolute = join(current.absolute, entry.name);
        if (entry.isDirectory()) stack.push({ absolute, relative });
        else if (statSync(absolute).isFile() && !tracked.has(relative) && !ignored.has(relative))
          failures.push(`${relative}: not tracked by Git`);
      }
    }
  }
  if (failures.length) throw new Error(`License/vendor audit failed:\n${failures.join("\n")}`);
  console.log(`license/vendor audit passed: ${vendorRoots.length} declared roots, all source files tracked`);
  return 0;
}

if (import.meta.main) process.exit(await runVendorLicenseAudit(process.argv.slice(2)));
