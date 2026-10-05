import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { ToolArgumentError } from "./errors";

export function resolveContainedPath(rootDir: string, subPath?: string): string {
  const root = resolve(rootDir);
  const candidate = resolve(root, subPath ?? ".");
  const outside = (base: string, target: string) => {
    const rel = relative(base, target);
    return rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel);
  };
  if (outside(root, candidate) || outside(realpathSync(root), realpathSync(candidate))) {
    throw new ToolArgumentError("Path traversal denied: target is outside the repository root");
  }
  return candidate;
}
