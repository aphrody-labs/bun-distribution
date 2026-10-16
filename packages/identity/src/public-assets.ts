// SPDX-License-Identifier: Apache-2.0
/** Explicit public asset base; no change to native/local resources when it is absent. */
export function publicAssetsBase(): string | undefined {
  return typeof document === "undefined"
    ? undefined
    : document
        .querySelector('meta[name="aphrody-assets-base"]')
        ?.getAttribute("content") || undefined;
}

export function publicAssetUrl(path: string, base: string): string {
  const origin = new URL(base);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error("Public assets require an HTTPS base without credentials");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || !/^[\w.-]+$/.test(part),
      )
  )
    throw new Error("Invalid public asset path");
  return new URL(path, origin.href.replace(/\/?$/, "/")).href;
}

export function publicPetAtlas(
  localUrl: string,
  base = publicAssetsBase(),
): string {
  return base ? publicAssetUrl("pet/spritesheet.webp", base) : localUrl;
}

export function publicPetSymbol(relative: string, base: string): string {
  return publicAssetUrl("pet/symbols/" + relative, base);
}

export function publicMaterialSymbolsIndex(base: string): string {
  return publicAssetUrl("m3/symbols/material-symbols-index.json", base);
}
