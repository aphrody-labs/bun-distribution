// SPDX-License-Identifier: Apache-2.0
// A minimal Bun/M3 project scaffold: the `web` template of @aphrody/scaffold. No install or network access is performed.
import { basename, join, resolve } from "node:path";
import { assertPrivateOwnerWorkspace, npmName, scaffold } from "@aphrody/scaffold";

/** Create a new, previously absent M3 project directory. */
export async function createM3Project(directory: string): Promise<string> {
  const target = resolve(directory);
  assertPrivateOwnerWorkspace(target);
  const name = npmName(basename(target));
  if (!name) throw new Error(`m3 new: cannot derive a package name from ${directory}`);
  const { version } = JSON.parse(await Bun.file(join(import.meta.dir, "..", "package.json")).text()) as {
    version: string;
  };
  await scaffold(target, { template: "web", name, m3Version: version }, "new");
  return target;
}
