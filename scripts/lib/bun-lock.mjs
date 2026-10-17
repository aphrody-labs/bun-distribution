import { join } from "node:path";

const identityOf = (record) => {
  const identity = record[0];
  const separator = identity.lastIndexOf("@");
  return {
    name: identity.slice(0, separator),
    version: identity.slice(separator + 1),
  };
};

/** Resolve a dependency name from a lock key by walking outward through nested keys. */
const resolveKey = (packages, from, name) => {
  let scope = from;
  for (;;) {
    const candidate = scope === "" ? name : `${scope}/${name}`;
    if (packages[candidate] !== undefined) return candidate;
    if (scope === "") return undefined;
    const slash = scope.lastIndexOf("/");
    // Scoped package keys contain one slash that belongs to the name.
    scope =
      slash <= 0 || (scope.startsWith("@") && scope.indexOf("/") === slash)
        ? ""
        : scope.slice(0, slash);
  }
};

/**
 * Read bun.lock and classify every locked package as runtime or development
 * by reachability from the root workspace's dependency groups.
 */
export async function readBunLock(root) {
  const text = await Bun.file(join(root, "bun.lock")).text();
  const lock = Bun.JSONC.parse(text);
  const rootWorkspace = lock.workspaces[""];
  const packages = lock.packages;
  const reach = (groups) => {
    const seen = new Set();
    const queue = [];
    for (const group of groups)
      for (const name of Object.keys(rootWorkspace[group] ?? {})) {
        const key = resolveKey(packages, "", name);
        if (key !== undefined) queue.push(key);
      }
    while (queue.length > 0) {
      const key = queue.pop();
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = packages[key][2] ?? {};
      for (const group of [
        "dependencies",
        "optionalDependencies",
        "peerDependencies",
      ])
        for (const name of Object.keys(meta[group] ?? {})) {
          const next = resolveKey(packages, key, name);
          if (next !== undefined) queue.push(next);
        }
    }
    return seen;
  };
  const runtime = reach(["dependencies", "optionalDependencies"]);
  const optionalOnly = new Set();
  for (const key of reach(["optionalDependencies"])) optionalOnly.add(key);
  const entries = Object.entries(packages)
    .filter(
      ([, record]) =>
        typeof record[0] === "string" && !record[0].includes("@workspace:"),
    )
    .map(([key, record]) => {
      const { name, version } = identityOf(record);
      const integrity = record[3];
      return {
        key,
        name,
        version,
        integrity,
        dev: !runtime.has(key),
        optional: optionalOnly.has(key),
        resolved: `https://registry.npmjs.org/${name}/-/${name.slice(name.lastIndexOf("/") + 1)}-${version}.tgz`,
      };
    })
    .sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    );
  return { lock, entries };
}

/** The locked version of a top-level package. */
export async function lockedVersion(root, name) {
  const { lock } = await readBunLock(root);
  const record = lock.packages[name];
  if (record === undefined) throw new Error(`Missing locked ${name} version`);
  return identityOf(record).version;
}
