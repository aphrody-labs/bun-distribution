#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { runProcess } from "../packages/bun-workspace/src/process.ts";

export interface ReVendor {
  path: string;
  url: string;
  revision: string;
  state: "missing" | "ready" | "dirty" | "revision-mismatch" | "occupied";
  actualRevision?: string;
  windowsSparse: boolean;
}

async function git(cwd: string, args: string[], timeoutMs = 30_000) {
  return runProcess(["git", ...args], cwd, {
    timeoutMs,
    maxOutputBytes: 2 * 1024 * 1024,
    env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

async function requireGit(cwd: string, args: string[], timeoutMs?: number): Promise<string> {
  const result = await git(cwd, args, timeoutMs);
  if (result.code !== 0) throw new Error(`Git operation failed (${args[0]}, exit ${result.code})`);
  return result.stdout.trim();
}

export function validateVendorPath(path: string): void {
  if (isAbsolute(path) || path.includes("\\") || !/^third_party\/[a-zA-Z0-9._-]+$/.test(path))
    throw new Error(`Invalid RE vendor path: ${path}`);
  if (path.split("/").some(part => part === "." || part === "..")) throw new Error(`Invalid RE vendor path: ${path}`);
}

/** Sparse source/docs checkout avoids Windows-invalid filenames in upstream test fixtures. */
export function vendorInitializationCommands(vendor: ReVendor, platform: string): string[][] {
  validateVendorPath(vendor.path);
  if (!/^[0-9a-f]{40}$/.test(vendor.revision)) throw new Error("Invalid gitlink revision");
  if (!/^https:\/\/[^\s]+$/.test(vendor.url)) throw new Error("RE vendors require a declared HTTPS URL");
  if (vendor.state !== "missing") return [];
  if (platform !== "win32" || !vendor.windowsSparse) return [["submodule", "update", "--init", "--", vendor.path]];
  return [
    ["submodule", "init", "--", vendor.path],
    ["clone", "--no-checkout", "--", vendor.url, vendor.path],
    ["-C", vendor.path, "sparse-checkout", "set", "--cone", "unblob", "docs"],
    ["-C", vendor.path, "-c", "core.protectNTFS=false", "checkout", "--detach", vendor.revision],
    ["submodule", "absorbgitdirs", "--", vendor.path],
  ];
}

export async function inspectReVendors(root: string, platform = process.platform): Promise<ReVendor[]> {
  const rea = resolve(root, "vendor/rea");
  if (!existsSync(resolve(rea, ".gitmodules"))) return [];
  const paths = await requireGit(rea, ["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"]);
  const result: ReVendor[] = [];
  for (const line of paths.split(/\r?\n/).filter(Boolean)) {
    const boundary = line.indexOf(" ");
    const key = line.slice(0, boundary);
    const path = line.slice(boundary + 1).trim();
    validateVendorPath(path);
    const url = await requireGit(rea, ["config", "--file", ".gitmodules", "--get", key.replace(/\.path$/, ".url")]);
    const tree = await requireGit(rea, ["ls-tree", "HEAD", "--", path]);
    const revision = /^160000 commit ([0-9a-f]{40})\t/.exec(tree)?.[1];
    if (!revision) throw new Error(`Missing declared RE gitlink: ${path}`);
    const destination = resolve(rea, path);
    if (!destination.startsWith(`${rea}${sep}`)) throw new Error("RE vendor escaped its parent");
    const item: ReVendor = {
      path,
      url,
      revision,
      state: "missing",
      windowsSparse: platform === "win32" && path === "third_party/unblob",
    };
    if (existsSync(resolve(destination, ".git"))) {
      item.actualRevision = await requireGit(destination, ["rev-parse", "HEAD"]);
      const dirty = await requireGit(destination, ["status", "--porcelain", "--untracked-files=normal"]);
      item.state = dirty ? "dirty" : item.actualRevision === revision ? "ready" : "revision-mismatch";
    } else if (existsSync(destination) && (await readdir(destination)).length > 0) {
      item.state = "occupied";
    }
    result.push(item);
  }
  return result;
}

export async function setupReVendors(root: string, platform = process.platform): Promise<ReVendor[]> {
  const plan = await inspectReVendors(root, platform);
  if (!plan.length) throw new Error("REA source declarations are unavailable; initialize vendor/rea first");
  const retained = plan.filter(item => item.state !== "ready" && item.state !== "missing");
  if (retained.length)
    throw new Error(`RE vendor work preserved: ${retained.map(item => `${item.path}: ${item.state}`).join(", ")}`);
  const rea = resolve(root, "vendor/rea");
  for (const item of plan)
    for (const command of vendorInitializationCommands(item, platform)) await requireGit(rea, command, 300_000);
  const readback = await inspectReVendors(root, platform);
  if (readback.some(item => item.state !== "ready")) throw new Error("RE vendor revision readback failed");
  return readback;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--plan"))
    throw new Error("Usage: bun scripts/setup-re-vendors.ts [--plan]");
  const root = resolve(import.meta.dir, "..");
  const vendors = args[0] === "--plan" ? await inspectReVendors(root) : await setupReVendors(root);
  console.log(
    JSON.stringify({ vendors, ready: vendors.length > 0 && vendors.every(item => item.state === "ready") }, null, 2),
  );
}
