// SPDX-License-Identifier: Apache-2.0
// Optional integrations of the m3-bun server are imported on first use, never at start-up. A missing package fails
// with the feature that needed it and the package to install.

const loaded = new Map<string, Promise<unknown>>();

/** `import(specifier)` once; a failure names the feature and the package. */
export function loadOptional<T>(specifier: string, feature: string): Promise<T> {
  let pending = loaded.get(specifier);
  if (!pending) {
    pending = import(specifier).catch((error: unknown) => {
      loaded.delete(specifier);
      const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
      throw new Error(`m3-bun ${feature}: cannot load ${specifier}; add ${name} to the app's dependencies`, {
        cause: error,
      });
    });
    loaded.set(specifier, pending);
  }
  return pending as Promise<T>;
}

/** Directory of an installed package (through its exported `package.json`), or an explicit error. */
export function packageDir(name: string, feature: string, from: string = import.meta.dir): string {
  try {
    return Bun.resolveSync(`${name}/package.json`, from).replace(/[\\/]package\.json$/, "");
  } catch (error) {
    throw new Error(`m3-bun ${feature}: ${name} is not installed; add it to the app's dependencies`, {
      cause: error,
    });
  }
}
