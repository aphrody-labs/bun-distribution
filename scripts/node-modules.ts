#!/usr/bin/env bun
/** Retire redundant installs only after proving the root package owner. */
import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
const root = resolve(import.meta.dir, "..");
const qualificationBudgetMs = Bun.argv.includes("--retire-aligned") ? 180_000 : 120_000;
const deadline = performance.now() + qualificationBudgetMs;
const args = Bun.argv.slice(2);
const planOnly = args.includes("--plan");
const retireAligned = args.includes("--retire-aligned");
let buildReceipt: string | undefined;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--plan" || args[index] === "--retire-aligned") continue;
  if (args[index] === "--build-receipt" && !buildReceipt && args[index + 1]) {
    buildReceipt = args[++index];
    continue;
  }
  throw new Error(
    "Usage: bun scripts/node-modules.ts [--plan] [--retire-aligned --build-receipt build/frontend/<output>/build-receipt.json]",
  );
}
if (buildReceipt && !retireAligned) throw new Error("A build receipt requires --retire-aligned.");
const product = await Bun.file(join(root, "package.json")).json();
if (!Array.isArray(product.workspaces) || product.workspaces.some((value: unknown) => typeof value !== "string"))
  throw new Error("Root workspaces must be string patterns.");
function assertWithin(path: string): void {
  const within = relative(root, resolve(path));
  if (isAbsolute(within) || within === ".." || within.startsWith(".." + sep))
    throw new Error("Workspace path is outside the product root.");
}
async function regularPath(path: string): Promise<boolean> {
  if (performance.now() > deadline)
    throw new Error(`Nested install qualification exceeded its ${qualificationBudgetMs / 1000} second budget.`);
  assertWithin(path);
  let current = root;
  for (const part of ["", ...relative(root, resolve(path)).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    const info = await lstat(current).catch(error => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) return false;
    if (info.isSymbolicLink()) throw new Error("Workspace reparse or symbolic link path refused.");
    assertWithin(await realpath(current));
  }
  return true;
}
const members = new Set<string>();
for (const declared of product.workspaces as string[]) {
  const pattern = declared.replaceAll("\\", "/").replace(/\/$/, "");
  if (
    isAbsolute(pattern) ||
    pattern.includes("**") ||
    pattern
      .split("/")
      .some(
        part =>
          [
            "..",
            ".",
            ".git",
            ".local",
            "secrets",
            "external",
            "node_modules",
            "target",
            "build",
            "var",
            "install",
          ].includes(part) || !part,
      )
  )
    throw new Error("Unsafe root workspace pattern.");
  const pieces = pattern.split("/");
  const firstGlob = pieces.findIndex(part => ["*", "?", "[", "]", "{", "}"].some(char => part.includes(char)));
  const prefix = pieces.slice(0, firstGlob < 0 ? pieces.length : firstGlob).join("/");
  if (prefix) await regularPath(join(root, prefix));
  for await (const manifest of new Bun.Glob(`${pattern}/package.json`).scan({
    cwd: root,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    const path = resolve(root, manifest);
    if (!(await regularPath(path))) throw new Error("Workspace manifest disappeared.");
    const source = await Bun.file(path).json();
    if (typeof source.name !== "string" || !source.name) throw new Error("Workspace identity missing.");
    members.add(dirname(path));
  }
}
async function compareTree(local: string, shared: string): Promise<number> {
  if (!(await regularPath(local)) || !(await regularPath(shared))) throw new Error("Package owner path missing.");
  let files = 0;
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const sourcePath = join(local, entry.name),
      targetPath = join(shared, entry.name);
    if (!(await regularPath(sourcePath))) throw new Error("Installed file disappeared.");
    if (entry.isDirectory()) files += await compareTree(sourcePath, targetPath);
    else if (entry.isFile()) {
      if (!(await regularPath(targetPath))) throw new Error("Root package lacks an installed file.");
      const [source, target] = await Promise.all([
        Bun.file(sourcePath).arrayBuffer(),
        Bun.file(targetPath).arrayBuffer(),
      ]);
      if (
        source.byteLength !== target.byteLength ||
        Bun.CryptoHasher.hash("sha256", source, "hex") !== Bun.CryptoHasher.hash("sha256", target, "hex")
      )
        throw new Error("Root package differs from nested package bytes.");
      files++;
    } else throw new Error("Nonregular installed entry refused.");
  }
  return files;
}
async function qualify(directory: string): Promise<{ packages: number; files: number }> {
  assertWithin(directory);
  if (directory === join(root, "node_modules") || !(await regularPath(directory)))
    throw new Error("Nested owner path invalid.");
  const packages: { name: string; path: string }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (!(await regularPath(path))) throw new Error("Installed entry disappeared.");
    if (entry.name === ".bin") {
      await compareTree(path, join(root, "node_modules", ".bin"));
      continue;
    }
    if (!entry.isDirectory() || entry.name.startsWith(".")) throw new Error("Unknown nested install entry refused.");
    if (entry.name.startsWith("@")) {
      for (const scoped of await readdir(path, { withFileTypes: true })) {
        if (!scoped.isDirectory()) throw new Error("Nonregular scoped package refused.");
        packages.push({
          name: `${entry.name}/${scoped.name}`,
          path: join(path, scoped.name),
        });
      }
    } else packages.push({ name: entry.name, path });
  }
  let files = 0;
  for (const installed of packages) {
    const canonical = join(root, "node_modules", installed.name);
    if (!(await regularPath(installed.path)) || !(await regularPath(canonical)))
      throw new Error("Root package owner missing.");
    const [local, shared] = await Promise.all([
      Bun.file(join(installed.path, "package.json")).json(),
      Bun.file(join(canonical, "package.json")).json(),
    ]);
    if (local.name !== installed.name || local.name !== shared.name || local.version !== shared.version)
      throw new Error(`Root package does not replace ${installed.name}.`);
    files += await compareTree(installed.path, canonical);
  }
  return { packages: packages.length, files };
}
interface InstallProof {
  member: string;
  eligible: boolean;
  packages?: number;
  files?: number;
  reason?: string;
}
const retirementMembers = new Set(["apps/desktop", "packages/artcraft-frontend", "apps/artcraft-web-app"]);
const frontendSources = ["packages/artcraft-frontend", "apps/artcraft-web-app"];
async function git(argv: string[], cwd = root): Promise<string> {
  const result = await runProcess(["git", ...argv], cwd, {
    timeoutMs: 15_000,
    maxOutputBytes: 2 * 1024 * 1024,
    stderr: "discard",
  });
  if (result.code !== 0) throw new Error("Retirement Git provenance gate failed.");
  return result.stdout;
}
async function hashFile(path: string): Promise<string> {
  const digest = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) {
    if (performance.now() > deadline)
      throw new Error(`Retirement proof exceeded its ${qualificationBudgetMs / 1000} second budget.`);
    digest.update(chunk);
  }
  return digest.digest("hex");
}
type DependencySection = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";
type LockedWorkspace = {
  name: string;
  version?: string;
} & Partial<Record<DependencySection, Record<string, string>>>;
interface BunLockfile {
  workspaces?: Record<string, LockedWorkspace>;
  packages?: Record<string, [identity: string, ...metadata: unknown[]]>;
}
async function proveConsumer(member: string, lock: BunLockfile): Promise<Set<string>> {
  const label = relative(root, member).replaceAll("\\", "/");
  const consumer = await Bun.file(join(member, "package.json")).json();
  const locked = lock.workspaces?.[label];
  if (
    !locked ||
    locked.name !== consumer.name ||
    locked.version !== consumer.version ||
    consumer.version !== product.version
  )
    throw new Error("Consumer manifest is not aligned with the root lockfile.");
  const known = new Set<string>();
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    for (const [name, requested] of Object.entries(consumer[section] ?? {})) {
      known.add(name);
      if (locked[section]?.[name] !== requested) throw new Error("Consumer declaration differs from lockfile.");
      const canonical = join(root, "node_modules", name);
      assertWithin(await realpath(canonical));
      const physical = await Bun.file(join(canonical, "package.json")).json();
      if (physical.name !== name) throw new Error("Shared physical dependency identity differs.");
      const expected = requested === "catalog:" ? product.catalog?.[name] : requested;
      if (typeof expected !== "string") throw new Error("Shared dependency catalog entry missing.");
      if (expected.startsWith("workspace:")) {
        if (physical.version !== product.version) throw new Error("Shared workspace dependency version differs.");
      } else if (expected.startsWith("file:")) {
        const source = await Bun.file(join(root, expected.slice(5), "package.json")).json();
        if (source.name !== name || source.version !== physical.version)
          throw new Error("Shared file dependency owner differs.");
      } else if (!expected.startsWith("github:") && !Bun.semver.satisfies(physical.version, expected))
        throw new Error("Shared physical dependency is not the declared aligned version.");
      const lockedIdentity = lock.packages?.[name]?.[0];
      if (
        !expected.startsWith("workspace:") &&
        !expected.startsWith("file:") &&
        !expected.startsWith("github:") &&
        lockedIdentity !== `${name}@${physical.version}`
      )
        throw new Error("Shared dependency differs from root package lock identity.");
      if (
        expected.startsWith("github:") &&
        (typeof lockedIdentity !== "string" || !lockedIdentity.startsWith(`${name}@github:`))
      )
        throw new Error("Git dependency lacks its immutable root lock identity.");
    }
  }
  return known;
}
async function proveBuild(): Promise<void> {
  if (!buildReceipt) throw new Error("Aligned retirement requires a fresh build receipt.");
  const path = resolve(root, buildReceipt);
  const label = relative(root, path).replaceAll("\\", "/");
  if (!label.startsWith("build/frontend/") || !label.endsWith("/build-receipt.json") || !(await regularPath(path)))
    throw new Error("Unsafe or missing frontend receipt.");
  const receipt = await Bun.file(path).json();
  if (
    receipt.schemaVersion !== 1 ||
    receipt.action !== "build" ||
    receipt.status !== "success" ||
    receipt.compiled !== true ||
    receipt.sourcePinsUnchangedDuringBuild !== true ||
    receipt.runtime?.version !== Bun.version ||
    receipt.runtime?.revision !== Bun.revision ||
    receipt.artifactsBuilt < 1 ||
    receipt.output !== relative(root, dirname(path)).replaceAll("\\", "/")
  )
    throw new Error("Frontend receipt is not a qualified current build.");
  const head = (await git(["rev-parse", "HEAD"])).trim();
  if (!/^[0-9a-f]{40}$/.test(receipt.sources?.rootGitHead ?? ""))
    throw new Error("Frontend receipt lacks its root revision.");
  await git(["merge-base", "--is-ancestor", receipt.sources.rootGitHead, head]);
  await git(["diff", "--exit-code", "HEAD", "--", ...frontendSources]);
  if ((await git(["ls-files", "--others", "--exclude-standard", "--", ...frontendSources])).trim())
    throw new Error("Uncommitted frontend source files exist.");
  for (const file of ["package.json", "bun.lock"]) {
    const committed = await git(["show", `HEAD:${file}`]);
    if (Bun.CryptoHasher.hash("sha256", committed, "hex") !== (await hashFile(join(root, file))))
      throw new Error("Root dependency inputs are not committed unchanged.");
  }
  if (receipt.sources.bunLockSHA256 !== (await hashFile(join(root, "bun.lock"))))
    throw new Error("Build receipt lockfile has changed.");
  const lock = Bun.JSONC.parse(await Bun.file(join(root, "bun.lock")).text()) as BunLockfile;
  for (const member of members) await proveConsumer(member, lock);
  const files: { path: string; bytes: number; sha256: string }[] = [];
  async function walk(directory: string): Promise<void> {
    if (!(await regularPath(directory))) throw new Error("Built artifact path missing.");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const current = join(directory, entry.name);
      if (current === path) continue;
      if (!(await regularPath(current))) throw new Error("Built artifact missing.");
      if (entry.isDirectory()) await walk(current);
      else if (entry.isFile())
        files.push({
          path: relative(dirname(path), current).replaceAll("\\", "/"),
          bytes: (await lstat(current)).size,
          sha256: await hashFile(current),
        });
      else throw new Error("Nonregular built artifact refused.");
      if (files.length > 100_000) throw new Error("Artifact receipt bounds exceeded.");
    }
  }
  await walk(dirname(path));
  files.sort((a, b) => a.path.localeCompare(b.path));
  const digest = new Bun.CryptoHasher("sha256");
  for (const file of files) digest.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  if (
    receipt.artifactTree?.files !== files.length ||
    receipt.artifactTree.bytes !== files.reduce((sum, file) => sum + file.bytes, 0) ||
    receipt.artifactTree.sha256 !== digest.digest("hex")
  )
    throw new Error("Frontend artifact tree differs from its build receipt.");
  if ((await git(["rev-parse", "HEAD"])).trim() !== head) throw new Error("Root HEAD changed during build proof.");
  if (receipt.sources.bunLockSHA256 !== (await hashFile(join(root, "bun.lock"))))
    throw new Error("Root lock changed during build proof.");
}
async function qualifyAligned(member: string): Promise<{ links: string[]; snapshot: string; packages: number }> {
  const label = relative(root, member).replaceAll("\\", "/");
  if (!retirementMembers.has(label) || !members.has(member))
    throw new Error("Aligned retirement is limited to the three declared known installs.");
  const directory = join(member, "node_modules");
  if (!(await regularPath(directory)) || directory === join(root, "node_modules"))
    throw new Error("Unsafe nested install root.");
  const owner: string = root;
  const ownerPath = relative(owner, directory).replaceAll("\\", "/");
  if ((await git(["ls-files", "--", ownerPath], owner)).trim())
    throw new Error("Nested install contains Git-tracked paths.");
  await git(["check-ignore", "--quiet", ownerPath], owner);
  const lock = Bun.JSONC.parse(await Bun.file(join(root, "bun.lock")).text()) as BunLockfile;
  const known = await proveConsumer(member, lock);
  // The immutable original frontend manifests identify removed tooling; they do not authorize source deletion.
  if (owner !== root) {
    const anchor = "2134266d638094b8aac37d3fe7b190123bd46bc6";
    await git(["merge-base", "--is-ancestor", anchor, "HEAD"], owner);
    const oldManifest = JSON.parse(
      await git(["show", `${anchor}:${relative(owner, join(member, "package.json")).replaceAll("\\", "/")}`], owner),
    );
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
      for (const name of Object.keys(oldManifest[section] ?? {})) known.add(name);
  }
  const links: string[] = [];
  const metadata: string[] = [];
  const binNames = new Set<string>();
  let binDirectory: string | undefined;
  let packages = 0;
  async function walk(path: string): Promise<void> {
    assertWithin(path);
    if (performance.now() > deadline || metadata.length > 100_000)
      throw new Error("Old install inventory exceeded bounds.");
    const item = await lstat(path);
    const local = relative(directory, path).replaceAll("\\", "/");
    if (/(?:^|\/)(?:\.git|\.local|secrets|cookies|external|\.env(?:\..*)?)(?:\/|$)/.test(local))
      throw new Error("Protected install entry refused.");
    if (item.isSymbolicLink()) {
      assertWithin(await realpath(path));
      links.push(path);
      metadata.push(`link\0${local}`);
      return;
    }
    if (item.isDirectory()) {
      metadata.push(`dir\0${local}`);
      for (const entry of await readdir(path)) await walk(join(path, entry));
    } else if (item.isFile()) metadata.push(`file\0${local}\0${item.size}\0${item.mtimeMs}`);
    else throw new Error("Nonregular old install entry refused.");
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === ".bin") {
      binDirectory = path;
      continue;
    }
    if (entry.name.startsWith(".")) throw new Error("Unknown old install store metadata refused.");
    const scope = await lstat(path);
    if (entry.name.startsWith("@") && (!scope.isDirectory() || scope.isSymbolicLink()))
      throw new Error("Reparse or nonregular scope directory refused.");
    const candidates = entry.name.startsWith("@")
      ? (await readdir(path)).map(name => ({
          name: `${entry.name}/${name}`,
          path: join(path, name),
        }))
      : [{ name: entry.name, path }];
    for (const pkg of candidates) {
      if (!known.has(pkg.name) && !lock.packages?.[pkg.name]) throw new Error("Unknown old installed package refused.");
      if ((await lstat(pkg.path)).isSymbolicLink()) assertWithin(await realpath(pkg.path));
      const manifestMetadata = await lstat(join(pkg.path, "package.json"));
      if (manifestMetadata.isSymbolicLink() || !manifestMetadata.isFile())
        throw new Error("Old package manifest is not a regular metadata file.");
      const identity = await Bun.file(join(pkg.path, "package.json")).json();
      if (
        identity.name !== pkg.name ||
        typeof identity.version !== "string" ||
        !Bun.semver.satisfies(identity.version, "*")
      )
        throw new Error("Old package identity invalid.");
      if (typeof identity.bin === "string") binNames.add(pkg.name.split("/").at(-1)!);
      else for (const name of Object.keys(identity.bin ?? {})) binNames.add(name);
      await walk(pkg.path);
      packages++;
    }
  }
  if (binDirectory) {
    for (const entry of await readdir(binDirectory)) {
      const name = entry.replace(/\.(?:bunx|exe|cmd|ps1)$/, "");
      if (!binNames.has(name)) throw new Error("Unknown old command shim refused.");
    }
    await walk(binDirectory);
  }
  metadata.sort();
  return {
    links: links.sort(),
    snapshot: Bun.CryptoHasher.hash("sha256", metadata.join("\n"), "hex"),
    packages,
  };
}
if (retireAligned) {
  try {
    await proveBuild();
    const proofs = [];
    for (const label of retirementMembers) {
      const member = join(root, label);
      if (!(await regularPath(join(member, "node_modules")))) continue;
      proofs.push({ member: label, ...(await qualifyAligned(member)) });
    }
    if (planOnly) {
      console.log(
        JSON.stringify(
          {
            action: "retire-aligned-plan",
            changed: false,
            ready: true,
            installs: proofs.map(({ member, packages, links, snapshot }) => ({
              member,
              packages,
              links: links.length,
              snapshot,
            })),
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }
    for (const proof of proofs) {
      await proveBuild();
      const directory = join(root, proof.member, "node_modules");
      const current = await qualifyAligned(join(root, proof.member));
      if (current.snapshot !== proof.snapshot) throw new Error("Old install changed before retirement.");
      for (const link of current.links) {
        if (process.platform === "win32") {
          const result = await runProcess(
            [
              "powershell.exe",
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "& { param([string]$target) Remove-Item -LiteralPath $target -Force -ErrorAction Stop }",
              link,
            ],
            root,
            { timeoutMs: 15_000, maxOutputBytes: 4096 },
          );
          if (result.code !== 0) throw new Error("Old link-only retirement failed.");
        } else await rm(link);
      }
      async function refuseRemainingLinks(path: string): Promise<void> {
        if (!(await regularPath(path))) throw new Error("Old install path changed during retirement.");
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const child = join(path, entry.name);
          if (!(await regularPath(child))) throw new Error("Old entry changed.");
          if (entry.isDirectory()) await refuseRemainingLinks(child);
        }
      }
      await refuseRemainingLinks(directory);
      await proveBuild();
      if (process.platform === "win32") {
        const result = await runProcess(
          [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "& { param([string]$target) Remove-Item -LiteralPath $target -Recurse -ErrorAction Stop }",
            directory,
          ],
          root,
          { timeoutMs: 30_000, maxOutputBytes: 4096 },
        );
        if (result.code !== 0) throw new Error("Aligned nested install retirement failed.");
      } else await rm(directory, { recursive: true });
    }
    console.log(
      JSON.stringify({
        action: "retire-aligned",
        changed: proofs.length > 0,
        retired: proofs.map(proof => proof.member),
      }),
    );
    process.exit(0);
  } catch (error) {
    if (!planOnly) throw error;
    console.log(
      JSON.stringify({
        action: "retire-aligned-plan",
        changed: false,
        ready: false,
        reason: error instanceof Error ? error.message : "Retirement proof failed.",
      }),
    );
    process.exit(0);
  }
}
const inventory: InstallProof[] = [];
for (const member of [...members].sort()) {
  const directory = join(member, "node_modules");
  const label = relative(root, member).replaceAll("\\", "/");
  try {
    if (!(await regularPath(directory))) continue;
    inventory.push({
      member: label,
      eligible: true,
      ...(await qualify(directory)),
    });
  } catch (error) {
    inventory.push({
      member: label,
      eligible: false,
      reason: error instanceof Error ? error.message : "Qualification failed.",
    });
  }
}
if (planOnly) {
  console.log(
    JSON.stringify(
      {
        action: "plan",
        changed: false,
        members: members.size,
        nestedInstalls: inventory,
        ready: inventory.every(item => item.eligible),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const refused = inventory.filter(item => !item.eligible);
if (refused.length)
  throw new Error(
    `Nested install proof failed; inspect --plan before cleanup.\n${refused.map(item => `  ${item.member}: ${item.reason ?? "refused"}`).join("\n")}`,
  );
for (const item of inventory) {
  const directory = join(root, item.member, "node_modules");
  await qualify(directory);
  if (process.platform === "win32") {
    const removed = await runProcess(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "& { param([string]$target) Remove-Item -LiteralPath $target -Recurse -ErrorAction Stop }",
        directory,
      ],
      root,
      { timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 },
    );
    if (removed.code !== 0) throw new Error("Workspace install cleanup failed.");
  } else await rm(directory, { recursive: true });
  console.log(`Root node_modules now owns ${item.member}`);
}
