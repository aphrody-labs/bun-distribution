// Packs a deployable archive: the compiled server, the precompiled runtime library, a launcher and
// a systemd unit. Untar it anywhere on a server of the same target and run ./run.sh.
import { copyFileSync, chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultLibraryPath, libraryFile } from "@aphrody/runtime-sdk";
import { hostTarget } from "@aphrody/runtime-sdk/artifact";

const name = "__NAME__";
const binary = join("dist", name);
if (!existsSync(binary)) throw new Error("run `bun run build:bin` first");
const library = defaultLibraryPath();
if (!existsSync(library)) throw new Error(`runtime library not found: ${library}`);

const stage = join("dist", `${name}-${hostTarget()}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "lib"), { recursive: true });
copyFileSync(binary, join(stage, name));
chmodSync(join(stage, name), 0o755);
copyFileSync(library, join(stage, "lib", libraryFile()));

writeFileSync(
  join(stage, "run.sh"),
  `#!/bin/sh
here="$(cd "$(dirname "$0")" && pwd)"
export YOLO_RUNTIME_LIB="$here/lib/${libraryFile()}"
export PORT="\${PORT:-3000}"
exec "$here/${name}" "$@"
`,
);
chmodSync(join(stage, "run.sh"), 0o755);
writeFileSync(
  join(stage, `${name}.service`),
  `[Unit]
Description=${name}
After=network.target

[Service]
ExecStart=/opt/${name}/run.sh
WorkingDirectory=/opt/${name}
Environment=PORT=3000
Environment=DB_PATH=/var/lib/${name}/app.sqlite
StateDirectory=${name}
DynamicUser=yes
Restart=on-failure

[Install]
WantedBy=multi-user.target
`,
);
const archive = `${stage}.tar.gz`;
const tar = Bun.spawnSync(["tar", "-czf", archive, "-C", "dist", `${name}-${hostTarget()}`]);
if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
console.log(`packed ${archive}`);
