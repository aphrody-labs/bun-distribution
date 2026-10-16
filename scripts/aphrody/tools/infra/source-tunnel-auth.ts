#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Source-only Gitea browser sign-in for the trusted WireGuard tunnel.
// Usage: bun scripts/tools/infra/source-tunnel-auth.ts [plan|--apply acme-challenge|auth-proxy|gitea-auth]
const root = `${import.meta.dir}/../../..`;
const sourceConf = await Bun.file(`${root}/infra/config/host/nginx/aphrody/control.aphrody.app.conf`).text();
const expectedMap = await Bun.file(`${root}/infra/config/host/nginx/shared/source-tunnel-auth.conf`).text();
const expectedSnippet = await Bun.file(`${root}/infra/config/host/nginx/snippets/source-tunnel-auth.inc`).text();
const args = process.argv.slice(2);
const apply = args[0] === "--apply";
const phase = apply ? (args[1] ?? "") : "plan";
const phases = ["plan", "acme-challenge", "auth-proxy", "gitea-auth"];
if (!phases.includes(phase) || (apply && args.length !== 2)) {
  console.error(`usage: bun ${import.meta.file} [plan|--apply acme-challenge|auth-proxy|gitea-auth]`);
  process.exit(2);
}

function serverBlock(text: string, marker: string): { start: number; end: number; lines: string[]; text: string } {
  const lines = text.split(/\r?\n/);
  const match = lines.findIndex(line => line.trim() === marker);
  if (match < 0) throw new Error(`server marker missing: ${marker}`);
  let start = match;
  while (start >= 0 && lines[start]?.trim() !== "server {") start--;
  if (start < 0) throw new Error("server block start missing");
  let depth = 0;
  let end = start;
  for (; end < lines.length; end++) {
    const line = lines[end] ?? "";
    depth += (line.match(/{/g) ?? []).length;
    depth -= (line.match(/}/g) ?? []).length;
    if (depth === 0) break;
  }
  if (depth !== 0) throw new Error("server block is incomplete");
  return { start, end, lines, text: lines.slice(start, end + 1).join("\n") };
}

const canonicalSource = serverBlock(sourceConf, "server_name source.aphrody.app;").text;
if (!canonicalSource.includes("include snippets/source-tunnel-auth.inc;"))
  throw new Error("Source auth header include is missing");
if (!canonicalSource.includes("include snippets/bun-os-product-api.inc;"))
  throw new Error("Source product route was unexpectedly removed from the canonical model");
const sourceBlockForLive = canonicalSource.replace("    include snippets/bun-os-product-api.inc;\n", "");
if (sourceBlockForLive.includes("bun-os-product-api.inc"))
  throw new Error("unqualified product route would enter the live patch");

if (!apply) {
  console.log(
    JSON.stringify({
      mode: "plan",
      phases: ["acme-challenge", "auth-proxy", "gitea-auth"],
      tunnel: "10.200.77.0/24",
      mappedUser: "aphrody-dev",
      trustedBackend: "172.18.0.1/32",
      sourceCertificate: "/etc/letsencrypt/live/source.aphrody.app",
      liveCompose: "/home/ubuntu/apps/gitea/compose.yaml (selected env keys only)",
      liveNginx: "/etc/nginx/sites-available/control.aphrody.app.conf (forge blocks only)",
      productRoutesApplied: false,
    }),
  );
  process.exit(0);
}

const payload = JSON.stringify({
  phase,
  expectedMap,
  expectedSnippet,
  sourceBlockForLive,
});
const remoteTemplate = String.raw`
const d = JSON.parse(__PAYLOAD__);
function fail(message) { throw new Error(message); }
function run(args, stdin) {
  const p = Bun.spawnSync(args, { stdin: stdin === undefined ? "ignore" : stdin, stdout: "pipe", stderr: "pipe", timeout: 45000 });
  if (p.exitCode !== 0) fail("bounded remote command failed (exit " + (p.exitCode ?? "unknown") + ")");
  return p.stdout.toString();
}
function status(args) {
  const p = Bun.spawnSync(args, { stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: 45000 });
  return p.exitCode === 0;
}
function sha(value) { return new Bun.CryptoHasher("sha256").update(value).digest("hex"); }
function block(text, marker) {
  const lines = text.split(/\r?\n/);
  const found = lines.findIndex(line => line.trim() === marker);
  if (found < 0) fail("expected live Nginx server is absent or changed");
  let start = found;
  while (start >= 0 && lines[start].trim() !== "server {") start--;
  if (start < 0) fail("live server start is absent");
  let depth = 0, end = start;
  for (; end < lines.length; end++) {
    depth += (lines[end].match(/{/g) || []).length;
    depth -= (lines[end].match(/}/g) || []).length;
    if (depth === 0) break;
  }
  if (depth !== 0) fail("live server block is incomplete");
  return { start, end, lines, text: lines.slice(start, end + 1).join("\n") };
}
function addChallenge(value) {
  if (value.includes("location ^~ /.well-known/acme-challenge/")) return value;
  const anchor = "    location / {";
  if (value.split(anchor).length !== 2) fail("forge location anchor changed");
  return value.replace(anchor, "    location ^~ /.well-known/acme-challenge/ {\n        root /var/www/letsencrypt;\n        default_type text/plain;\n        try_files $uri =404;\n    }\n\n" + anchor);
}
async function rootWrite(target, contents) {
  const temp = "/tmp/source-auth-" + crypto.randomUUID();
  const stage = target + ".stage-" + crypto.randomUUID();
  await Bun.write(temp, contents);
  try {
    run(["sudo", "-n", "install", "-m", "0644", temp, stage]);
    run(["sudo", "-n", "mv", stage, target]);
  } finally {
    run(["rm", "-f", temp]);
    run(["sudo", "-n", "rm", "-f", stage]);
  }
}
async function rootRemove(target) {
  if (await Bun.file(target).exists()) run(["sudo", "-n", "rm", "-f", target]);
}
async function restoreRoot(target, contents) {
  if (contents === null) return rootRemove(target);
  return rootWrite(target, contents);
}
async function homeWrite(target, contents) {
  const temp = target + ".stage-" + crypto.randomUUID();
  if (!status(["test", "!", "-L", target])) fail("refusing symlinked live Compose path");
  await Bun.write(temp, contents);
  run(["chmod", "--reference", target, temp]);
  run(["mv", temp, target]);
}
function addIdentityOverwrites(value, mapped) {
  const headers = mapped
    ? "        proxy_set_header X-WEBAUTH-USER \"\";\n        proxy_set_header X-WEBAUTH-EMAIL \"\";\n        proxy_set_header X-WEBAUTH-FULLNAME \"\";\n        proxy_set_header X-Aphrody-Tunnel-User $aphrody_source_tunnel_user;\n        proxy_set_header X-Forwarded-For $remote_addr;"
    : "        proxy_set_header X-WEBAUTH-USER \"\";\n        proxy_set_header X-WEBAUTH-EMAIL \"\";\n        proxy_set_header X-WEBAUTH-FULLNAME \"\";\n        proxy_set_header X-Aphrody-Tunnel-User \"\";\n        proxy_set_header X-Forwarded-For $remote_addr;";
  const host = "        proxy_set_header Host $host;";
  if (value.split(host).length !== 2) fail("Gitea proxy header anchor changed");
  let result = value.replace(host, host + "\n" + headers);
  result = result.replace("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n", "");
  return result;
}

try {
if (d.phase === "acme-challenge") {
  const path = "/etc/nginx/sites-available/control.aphrody.app.conf";
  if (!status(["test", "!", "-L", path])) fail("canonical Nginx config is unexpectedly a symlink");
  const original = await Bun.file(path).text();
  const before = sha(original);
  const selected = block(original, "server_name git.aphrody.app source.aphrody.app;");
  if (!selected.text.includes("source-origin/fullchain.pem")) fail("unexpected active forge TLS owner");
  const updatedBlock = addChallenge(selected.text);
  if (updatedBlock === selected.text) {
    console.log(JSON.stringify({ ok: true, phase: d.phase, changed: false }));
  } else {
    const updated = [...selected.lines.slice(0, selected.start), ...updatedBlock.split("\n"), ...selected.lines.slice(selected.end + 1)].join("\n");
    if (sha(await Bun.file(path).text()) !== before) fail("live Nginx file changed during preflight");
    await rootWrite(path, updated);
    if (!status(["sudo", "-n", "nginx", "-t"])) {
      await restoreRoot(path, original);
      fail("Nginx validation failed; original config restored in place");
    }
    if (!status(["sudo", "-n", "systemctl", "reload", "nginx.service"])) {
      await restoreRoot(path, original);
      status(["sudo", "-n", "nginx", "-t"]);
      status(["sudo", "-n", "systemctl", "reload", "nginx.service"]);
      fail("Nginx reload failed; original config restored in place");
    }
    console.log(JSON.stringify({ ok: true, phase: d.phase, changed: true, nginxTest: true, reloaded: true }));
  }
} else if (d.phase === "auth-proxy") {
  const cert = "/etc/letsencrypt/live/source.aphrody.app/fullchain.pem";
  if (!status(["sudo", "-n", "openssl", "x509", "-in", cert, "-noout", "-checkhost", "source.aphrody.app"])) fail("Source TLS certificate is absent or does not cover the hostname");
  const path = "/etc/nginx/sites-available/control.aphrody.app.conf";
  if (!status(["test", "!", "-L", path])) fail("canonical Nginx config is unexpectedly a symlink");
  if (run(["readlink", "-f", "/etc/nginx/sites-enabled/control.aphrody.app.conf"]).trim() !== path) fail("active Nginx site does not resolve to the qualified canonical file");
  const original = await Bun.file(path).text();
  const before = sha(original);
  const selected = block(original, "server_name git.aphrody.app source.aphrody.app;");
  if (!selected.text.includes("source-origin/fullchain.pem") || selected.text.includes("bun-os-product-api.inc")) fail("live forge block drifted or contains an unqualified product route");
  if (original.includes("server_name source.aphrody.app;")) fail("Source vhost already split; inspect before retrying");
  let git = selected.text.replace("server_name git.aphrody.app source.aphrody.app;", "server_name git.aphrody.app;");
  git = addIdentityOverwrites(addChallenge(git), false);
  const source = addChallenge(d.sourceBlockForLive);
  const replacement = git + "\n\n" + source;
  const updated = [...selected.lines.slice(0, selected.start), ...replacement.split("\n"), ...selected.lines.slice(selected.end + 1)].join("\n");
  const mapTarget = "/etc/nginx/conf.d/source-tunnel-auth.conf";
  const snippetTarget = "/etc/nginx/snippets/source-tunnel-auth.inc";
  const oldMap = await Bun.file(mapTarget).text().catch(() => null);
  const oldSnippet = await Bun.file(snippetTarget).text().catch(() => null);
  if (oldMap !== null && oldMap !== d.expectedMap) fail("global source map exists with different contents");
  if (oldSnippet !== null && oldSnippet !== d.expectedSnippet) fail("source header snippet exists with different contents");
  if (sha(await Bun.file(path).text()) !== before) fail("live Nginx file changed during preflight");
  try {
    await rootWrite(mapTarget, d.expectedMap);
    await rootWrite(snippetTarget, d.expectedSnippet);
    await rootWrite(path, updated);
    if (!status(["sudo", "-n", "nginx", "-t"])) fail("Nginx validation failed");
    if (!status(["sudo", "-n", "systemctl", "reload", "nginx.service"])) fail("Nginx reload failed");
  } catch {
    await restoreRoot(path, original);
    await restoreRoot(mapTarget, oldMap);
    await restoreRoot(snippetTarget, oldSnippet);
    status(["sudo", "-n", "nginx", "-t"]);
    status(["sudo", "-n", "systemctl", "reload", "nginx.service"]);
    fail("Nginx apply failed; original files restored in place");
  }
  console.log(JSON.stringify({ ok: true, phase: d.phase, sourceOnlyIdentity: true, gitIdentityHeadersOverwritten: true, nginxTest: true, reloaded: true }));
} else if (d.phase === "gitea-auth") {
  const nginxPath = "/etc/nginx/sites-available/control.aphrody.app.conf";
  const activeNginx = await Bun.file(nginxPath).text();
  const activeSource = block(activeNginx, "server_name source.aphrody.app;").text;
  const activeGit = block(activeNginx, "server_name git.aphrody.app;").text;
  if (!activeSource.includes("include snippets/source-tunnel-auth.inc;") || !activeGit.includes("proxy_set_header X-Aphrody-Tunnel-User \"\";")) fail("auth proxy must include the Source identity policy and sanitize the Git host first");
  if (await Bun.file("/etc/nginx/conf.d/source-tunnel-auth.conf").text().catch(() => "") !== d.expectedMap) fail("global tunnel map is not active");
  if (await Bun.file("/etc/nginx/snippets/source-tunnel-auth.inc").text().catch(() => "") !== d.expectedSnippet) fail("Source proxy header policy is not active");
  const cert = "/etc/letsencrypt/live/source.aphrody.app/fullchain.pem";
  if (!status(["sudo", "-n", "openssl", "x509", "-in", cert, "-noout", "-checkhost", "source.aphrody.app"])) fail("Source TLS certificate is absent or invalid");
  const path = "/home/ubuntu/apps/gitea/compose.yaml";
  if (!status(["test", "!", "-L", path])) fail("refusing symlinked live Compose path");
  const original = await Bun.file(path).text();
  let text = original;
  if (!text.includes("container_name: aphrody-gitea") || !text.includes("docker.gitea.com/gitea:28.1.0@sha256:f505a0d3a41323b786e05942fc7a4075e07ae7c169fd9485649aa55ee543a21a")) fail("live Compose is not the qualified Gitea service");
  const settings = {
    GITEA__security__REVERSE_PROXY_AUTHENTICATION_USER: "X-Aphrody-Tunnel-User",
    GITEA__security__REVERSE_PROXY_LIMIT: "1",
    GITEA__security__REVERSE_PROXY_TRUSTED_PROXIES: "172.18.0.1/32",
    GITEA__service__ENABLE_REVERSE_PROXY_AUTHENTICATION: "true",
    GITEA__service__ENABLE_REVERSE_PROXY_AUTHENTICATION_API: "false",
    GITEA__service__ENABLE_REVERSE_PROXY_AUTO_REGISTRATION: "false",
    GITEA__service__ENABLE_REVERSE_PROXY_EMAIL: "false",
    GITEA__service__ENABLE_REVERSE_PROXY_FULL_NAME: "false",
  };
  const lines = text.split(/\r?\n/);
  for (const [key, value] of Object.entries(settings)) {
    const present = lines.filter(line => line.trimStart().startsWith(key + ":"));
    if (present.length > 1 || (present.length === 1 && !present[0].includes(JSON.stringify(value)))) fail("live auth settings conflict with the declared policy");
  }
  const anchor = '      GITEA__service__DISABLE_REGISTRATION: "true"';
  if (text.split(anchor).length !== 2) fail("live Gitea environment anchor changed");
  const existing = new Set(Object.keys(settings).filter(key => lines.some(line => line.trimStart().startsWith(key + ":"))));
  const missing = Object.entries(settings).filter(([key]) => !existing.has(key)).map(([key, value]) => "      " + key + ": " + JSON.stringify(value));
  if (missing.length) text = text.replace(anchor, anchor + "\n" + missing.join("\n"));
  const before = sha(original);
  if (text !== original) {
    if (sha(await Bun.file(path).text()) !== before) fail("live Compose changed during preflight");
    await homeWrite(path, text);
  }
  const compose = "/home/ubuntu/apps/compose.yaml";
  let composeStarted = false;
  try {
    run(["timeout", "45s", "docker", "compose", "-f", compose, "config", "--quiet"]);
    const inspectedBefore = JSON.parse(run(["sudo", "-n", "docker", "inspect", "aphrody-gitea"]));
    const expectedImage = "docker.gitea.com/gitea:28.1.0@sha256:f505a0d3a41323b786e05942fc7a4075e07ae7c169fd9485649aa55ee543a21a";
    const labels = inspectedBefore[0]?.Config?.Labels || {};
    if (labels["com.docker.compose.service"] !== "gitea" || !String(labels["com.docker.compose.project.config_files"]).includes("/home/ubuntu/apps/compose.yaml") || inspectedBefore[0]?.Config?.Image !== expectedImage) fail("active Gitea container identity changed");
    const envBefore = new Set(inspectedBefore[0]?.Config?.Env || []);
    if (missing.length || Object.entries(settings).some(([key, value]) => !envBefore.has(key + "=" + value))) {
      composeStarted = true;
      run(["timeout", "60s", "docker", "compose", "-f", compose, "up", "--pull", "never", "--no-build", "--no-deps", "-d", "gitea"]);
    }
  } catch {
    if (!composeStarted && text !== original && sha(await Bun.file(path).text()) === sha(text)) await homeWrite(path, original);
    fail(composeStarted ? "Gitea apply reported failure after targeted Compose up; inspect the service before retrying" : "Gitea Compose preflight failed; source Compose restored");
  }
  const inspected = JSON.parse(run(["sudo", "-n", "docker", "inspect", "aphrody-gitea"]));
  const env = new Set(inspected[0]?.Config?.Env || []);
  for (const [key, value] of Object.entries(settings)) if (!env.has(key + "=" + value)) fail("live Gitea auth policy did not match after restart");
  const response = await fetch("http://127.0.0.1:29020/api/v1/version", { signal: AbortSignal.timeout(30000) });
  if (!response.ok) fail("Gitea health HTTP " + response.status);
  let version;
  try { version = (await response.json()).version; } catch { fail("Gitea health response was not JSON"); }
  if (version !== "28.1.0") fail("Gitea health version mismatch");
  console.log(JSON.stringify({ ok: true, phase: d.phase, configured: true, giteaVersion: "28.1.0", secretsPrinted: false }));
} else fail("unknown phase");
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const safeError = /^(?:bounded remote command failed \(exit (?:-?\d+|unknown)\)|Gitea health HTTP [1-5]\d\d|Gitea health response was not JSON|Gitea health version mismatch)$/.test(message)
    ? message
    : "remote phase failed precondition or qualification";
  console.log(JSON.stringify({ ok: false, phase: d.phase, error: safeError }));
}
`;
const remote = remoteTemplate.replace("__PAYLOAD__", JSON.stringify(payload));
const sshProc = Bun.spawn(
  [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=2",
    "vps",
    "timeout",
    "90s",
    "/home/ubuntu/.bun/bin/bun-1.4.4",
    "-",
  ],
  { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
);
sshProc.stdin.write(remote);
sshProc.stdin.end();
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(sshProc.stdout).text(),
  new Response(sshProc.stderr).text(),
  sshProc.exited,
]);
if (exitCode !== 0) {
  console.error(`Source tunnel auth ${phase} failed (${exitCode}); remote diagnostics suppressed.`);
  if (stderr.includes("Permission denied") || stderr.includes("timed out"))
    console.error("SSH or operation boundary rejected or timed out.");
  process.exit(1);
}
try {
  const receipt = JSON.parse(stdout.trim());
  if (receipt.ok !== true) {
    const error =
      typeof receipt.error === "string" &&
      /^(?:bounded remote command failed \(exit (?:-?\d+|unknown)\)|Gitea health HTTP [1-5]\d\d|Gitea health response was not JSON|Gitea health version mismatch|remote phase failed precondition or qualification)$/.test(
        receipt.error,
      )
        ? receipt.error
        : "remote phase failed precondition or qualification";
    console.error(JSON.stringify({ ok: false, phase, error }));
    process.exit(1);
  }
  console.log(JSON.stringify(receipt));
} catch {
  console.error("Source tunnel auth returned no sanitized receipt.");
  process.exit(1);
}
