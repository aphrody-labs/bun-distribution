// SPDX-License-Identifier: Apache-2.0
// The m3 tool packages behind `m3-bun lint|migrate|create|design|og|os-theme|lib` are imported on first use, so the
// other commands never load them. A package that is not installed is an error that names it.

/** Import a tool package through its own `import()` (kept literal for the bundler), naming the package when absent. */
export async function loadTool<T>(
  name: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
      String(error).includes(`'${name}'`)
    ) {
      throw new Error(
        `m3-bun: ${name} is not installed; add it next to @aphrody/m3-bun (bun add ${name})`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}
