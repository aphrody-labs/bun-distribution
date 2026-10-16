// SPDX-License-Identifier: Apache-2.0
// Keep file IO and lifecycle probes bounded and ordered.
/* oxlint-disable no-await-in-loop */
// Local release adapter: verified assets, private credentials, atomic activation and systemd.
import { chmod, cp, mkdir, readFile, readlink, rename, symlink, lstat, rm } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";

const source = process.argv[2] && resolve(process.argv[2]);
if (!source)
  throw new Error("Usage: bun scripts/dev/ui/install-local-app.ts <extracted-release> [--apply]");
const state = join(homedir(), ".local/share/aphrody/local-app");
const privateDir = join(homedir(), ".config/aphrody/local-app");
const manifest = (await Bun.file(join(source, "manifest.json")).json()) as {
  id: string;
  revision: string;
  files: Record<string, { sha256: string; bytes: number }>;
};
if (!/^[a-f0-9]{12}-\d+$/.test(manifest.id) || !/^[a-f0-9]{40}$/.test(manifest.revision))
  throw new Error("Invalid release identity");
for (const [path, expected] of Object.entries(manifest.files)) {
  if (path.startsWith("/") || path.split("/").includes(".."))
    throw new Error("Unsafe release path");
  if (!(await lstat(join(source, path))).isFile())
    throw new Error(`Non-file release entry: ${path}`);
  const data = await Bun.file(join(source, path)).arrayBuffer();
  if (
    data.byteLength !== expected.bytes ||
    new Bun.CryptoHasher("sha256").update(data).digest("hex") !== expected.sha256
  )
    throw new Error(`Release integrity failure: ${path}`);
}
for (const required of [
  "bin/aphrody",
  "bin/aphrody-kernel",
  "bin/aphrody-mcp",
  "bin/aphrody-embed",
  "ui/index.html",
  "ui/app.js",
  "ui/app.css",
  "ui/pkg/aphrody_shell_web_bg.wasm",
  "ui/shell/worker.js",
]) {
  if (!manifest.files[required]) throw new Error(`Required release file absent: ${required}`);
}
if (!process.argv.includes("--apply")) {
  console.log(
    JSON.stringify({
      verified: true,
      revision: manifest.revision,
      destination: state,
      public: "https://0.0.0.0:1421",
      backend: "127.0.0.1:8765",
      supervisor: "systemd --user",
      credentials: join(privateDir, "credentials.json"),
    }),
  );
  process.exit(0);
}
async function run(args: string[], stdin?: string) {
  const child = Bun.spawn(args, {
    windowsHide: true,
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(`${args[0]} failed: ${stderr}`);
  return stdout.trim();
}
await mkdir(privateDir, { recursive: true, mode: 0o700 });
await chmod(privateDir, 0o700);
await mkdir(join(state, "releases"), { recursive: true });
await mkdir(join(state, "client-body"), { recursive: true });
await mkdir(join(state, "proxy"), { recursive: true });
const destination = join(state, "releases", manifest.id);
if (await Bun.file(join(destination, "manifest.json")).exists())
  throw new Error("Release already installed; use a fresh release id");
await cp(source, destination, { recursive: true, dereference: false });
await chmod(join(destination, "bin/aphrody"), 0o755);
await chmod(join(destination, "bin/aphrody-kernel"), 0o755);
await chmod(join(destination, "bin/aphrody-mcp"), 0o755);
await chmod(join(destination, "bin/aphrody-embed"), 0o755);
const credentialPath = join(privateDir, "credentials.json");
if (!(await Bun.file(credentialPath).exists())) {
  const password = Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  const hash = await run(["openssl", "passwd", "-6", "-stdin"], `${password}\n`);
  await Bun.write(join(privateDir, "htpasswd"), `aphrody:${hash}\n`);
  await Bun.write(
    credentialPath,
    `${JSON.stringify({ username: "aphrody", password }, null, 2)}\n`,
  );
  await chmod(credentialPath, 0o600);
  await chmod(join(privateDir, "htpasswd"), 0o600);
}
const mcpEnv = join(privateDir, "mcp.env");
if (!(await Bun.file(mcpEnv).exists())) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  await Bun.write(mcpEnv, `APHRODY_AI_HTTP_TOKEN=${token}\n`);
  await Bun.write(
    join(privateDir, "mcp-auth.conf"),
    `proxy_set_header Authorization "Bearer ${token}";\n`,
  );
  await chmod(mcpEnv, 0o600);
  await chmod(join(privateDir, "mcp-auth.conf"), 0o600);
}
if (!(await Bun.file(join(privateDir, "tls.key")).exists())) {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry?.family === "IPv4")
    .map((entry) => `IP:${entry!.address}`);
  await run([
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:3072",
    "-sha256",
    "-days",
    "365",
    "-nodes",
    "-subj",
    "/CN=localhost",
    "-addext",
    `subjectAltName=DNS:localhost,${[...new Set(addresses)].join(",")}`,
    "-keyout",
    join(privateDir, "tls.key"),
    "-out",
    join(privateDir, "tls.crt"),
  ]);
  await chmod(join(privateDir, "tls.key"), 0o600);
}
const yoloRoot =
  process.env.YOLO_ROOT ?? process.env.APHRODY_YOLO_ROOT ?? join(homedir(), "src", "aphrody");
const configPath = join(privateDir, "nginx.conf");
await Bun.write(
  configPath,
  (await readFile(join(yoloRoot, "tools/config/host/nginx/aphrody/aphrody-local.conf"), "utf8"))
    .replaceAll("@STATE@", state)
    .replaceAll("@PRIVATE@", privateDir),
);
await run(["nginx", "-t", "-p", `${state}/`, "-c", configPath]);
const units = join(homedir(), ".config/systemd/user");
await mkdir(units, { recursive: true });
const kernelOverride = join(units, "aphrody-kernel.service.d/local-app.conf");
const previousKernelOverride = await readFile(kernelOverride, "utf8").catch(() => undefined);
await run([
  "bun",
  join(yoloRoot, "packages/engine/core/src/units/cli.ts"),
  "render",
  "--out",
  units,
  "aphrody-app-server.service",
  "aphrody-app-ui.service",
  "aphrody-local-mcp.service",
  "aphrody-kernel.service.d",
]);
const current = join(state, "current");
const previous = await readlink(current).catch(() => undefined);
async function activate(path: string) {
  const temporary = join(state, `current-${process.pid}`);
  await symlink(path, temporary);
  await rename(temporary, current);
}
await activate(destination);
try {
  await run(["systemctl", "--user", "daemon-reload"]);
  await run(["systemctl", "--user", "restart", "aphrody-kernel.service"]);
  await run([
    "systemctl",
    "--user",
    "enable",
    "aphrody-app-server.service",
    "aphrody-app-ui.service",
    "aphrody-local-mcp.service",
  ]);
  await run([
    "systemctl",
    "--user",
    "restart",
    "aphrody-app-server.service",
    "aphrody-app-ui.service",
    "aphrody-local-mcp.service",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 30 && !ready; attempt++) {
    await Bun.sleep(1000);
    ready = await fetch("http://127.0.0.1:8765/healthz")
      .then((response) => response.ok)
      .catch(() => false);
  }
  if (!ready) throw new Error("App backend failed its health probe");
  await run(["systemctl", "--user", "is-active", "aphrody-app-ui.service"]);
  await run(["systemctl", "--user", "is-active", "aphrody-kernel.service"]);
  await run(["systemctl", "--user", "is-active", "aphrody-local-mcp.service"]);
  if (previous) await Bun.write(join(state, "previous-release.txt"), `${previous}\n`);
} catch (error) {
  if (previous) {
    await activate(previous);
    await run([
      "systemctl",
      "--user",
      "restart",
      "aphrody-app-server.service",
      "aphrody-app-ui.service",
      "aphrody-local-mcp.service",
    ]);
  } else {
    await run([
      "systemctl",
      "--user",
      "stop",
      "aphrody-app-ui.service",
      "aphrody-app-server.service",
      "aphrody-local-mcp.service",
    ]);
    await run([
      "systemctl",
      "--user",
      "disable",
      "aphrody-app-ui.service",
      "aphrody-app-server.service",
      "aphrody-local-mcp.service",
    ]);
  }
  if (previousKernelOverride === undefined) await rm(kernelOverride);
  else await Bun.write(kernelOverride, previousKernelOverride);
  await run(["systemctl", "--user", "daemon-reload"]);
  await run(["systemctl", "--user", "restart", "aphrody-kernel.service"]);
  throw error;
}
console.log(
  JSON.stringify({
    installed: destination,
    revision: manifest.revision,
    url: "https://localhost:1421",
    credentials: credentialPath,
    certificate: join(privateDir, "tls.crt"),
  }),
);
