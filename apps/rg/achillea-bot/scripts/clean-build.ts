import { existsSync, lstatSync, rmSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const buildDirectory = resolve(appRoot, "build");

if (basename(buildDirectory) !== "build" || dirname(buildDirectory) !== appRoot) {
	throw new Error(`Refusing to clean an unexpected path: ${buildDirectory}`);
}

if (!existsSync(buildDirectory)) process.exit(0);

// Never follow a build symlink: remove the link itself, not the service tree it targets.
if (lstatSync(buildDirectory).isSymbolicLink()) unlinkSync(buildDirectory);
else rmSync(buildDirectory, { recursive: true, force: true });
