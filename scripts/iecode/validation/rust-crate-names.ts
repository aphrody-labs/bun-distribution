#!/usr/bin/env bun
/** Check Cargo package identities in the active IECODE workspace. */

import { basename, relative, resolve } from "node:path";

interface CargoPackage {
  id: string;
  name: string;
  manifest_path: string;
}

interface CargoMetadata {
  packages: CargoPackage[];
  workspace_members: string[];
}

const root = resolve(import.meta.dir, "../../..");
const cargoProcess = Bun.spawn(["cargo", "metadata", "--no-deps", "--format-version", "1"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(cargoProcess.stdout).text(),
  new Response(cargoProcess.stderr).text(),
  cargoProcess.exited,
]);
if (exitCode !== 0) throw new Error(`cargo metadata failed: ${stderr.trim()}`);

const metadata = JSON.parse(stdout) as CargoMetadata;
const members = new Set(metadata.workspace_members);
const errors: string[] = [];
let checked = 0;
let nie = 0;

for (const crate of metadata.packages) {
  if (!members.has(crate.id)) continue;
  checked++;
  const path = relative(root, crate.manifest_path).replaceAll("\\", "/");
  if (!/^aphrody-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(crate.name)) {
    errors.push(`${path}: workspace package must use the aphrody- namespace: ${crate.name}`);
  }
  if (crate.name.split("-").slice(1).includes("aphrody")) {
    errors.push(`${path}: do not repeat aphrody inside a package name: ${crate.name}`);
  }
  if (path.startsWith("crates/nie/")) {
    nie++;
    if (!crate.name.startsWith("aphrody-nie-")) {
      errors.push(`${path}: NIE package must use aphrody-nie-: ${crate.name}`);
    }
    if (basename(resolve(crate.manifest_path, "..")) !== crate.name) {
      errors.push(`${path}: NIE directory must match package name: ${crate.name}`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Rust crate names: ${checked} workspace packages, ${nie} NIE packages checked`);
