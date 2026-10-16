import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";

/** Explicit owner checkouts take precedence over the installed registry owner. */
export function operationsContext(
  repositoryRoot: string,
  environment: Record<string, string | undefined> = process.env,
) {
  const root = realpathSync(repositoryRoot);
  const manifest = JSON.parse(readFileSync(resolve(root, "workspace.manifest.json"), "utf8"));
  const source = manifest.operations?.source;
  const authority = manifest.operations?.authority;
  if (authority !== "@aphrody/workspace") throw new Error("Unexpected operations authority");
  const configured = [environment.APHRODY_ROOT, environment.APHRODY_INFRA_ROOT]
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      const path = resolve(root, value);
      if (!existsSync(path)) throw new Error(`Configured Aphrody checkout does not exist: ${path}`);
      return realpathSync(path);
    });
  if (new Set(configured).size > 1)
    throw new Error("APHRODY_ROOT and APHRODY_INFRA_ROOT select different checkouts");
  if (!configured.length) {
    let entry: string | undefined;
    try {
      entry = Bun.resolveSync(`${authority}/ops`, root);
    } catch (error) {
      if (existsSync(resolve(root, "node_modules", authority))) throw error;
    }
    if (entry) {
      let directory = dirname(entry);
      while (!existsSync(resolve(directory, "package.json"))) {
        const parent = dirname(directory);
        if (parent === directory) throw new Error("Missing installed operations owner identity");
        directory = parent;
      }
      const owner = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
      if (owner.name !== authority) throw new Error(`Unexpected operations owner: ${owner.name}`);
      return { repositoryRoot: root, operationsRoot: undefined, entry };
    }
  }
  if (!configured.length && typeof source !== "string")
    throw new Error("Install @aphrody/workspace or explicitly configure the operations checkout");
  const operationsRoot = configured[0] ?? realpathSync(resolve(root, source, "../../../.."));
  const packageRoot = resolve(operationsRoot, "packages/infra/workspace");
  const packageFile = resolve(packageRoot, "package.json");
  if (!existsSync(packageFile)) throw new Error(`Missing operations owner: ${packageFile}`);
  const owner = JSON.parse(readFileSync(packageFile, "utf8"));
  if (owner.name !== manifest.operations.authority)
    throw new Error(`Unexpected operations owner: ${owner.name}`);
  const entry = resolve(packageRoot, "src/ops.ts");
  if (!existsSync(entry)) throw new Error(`Missing operations entry: ${entry}`);
  return { repositoryRoot: root, operationsRoot, entry };
}

export const repositoryRoot = resolve(dirname(import.meta.path), "../../..");
