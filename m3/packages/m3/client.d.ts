// SPDX-License-Identifier: Apache-2.0
// Ambient module types for applications built with @aphrody/m3. Reference them once:
//   /// <reference types="@aphrody/m3/client" />
// or add "@aphrody/m3/client" to `compilerOptions.types`.

/** Sheets and fonts served by the m3 plugin (`m3:theme.css`, `m3:symbols.css`, `m3:fonts.css`, ...). */
declare module "m3:*" {}

/** `?url` imports: the URL of an emitted `.svg` asset, or any other asset inlined as a `data:` URL. */
declare module "*?url" {
  const url: string;
  export default url;
}

/** Side-effect and scoped CSS imports. */
declare module "*.css" {}

/**
 * `next/*` specifiers of App Router code: the m3 plugin aliases them to `@aphrody/m3/app/*`, so their types are
 * the types of those modules.
 */
declare module "next/link" {
  export { default } from "@aphrody/m3/app/link";
  export * from "@aphrody/m3/app/link";
}
declare module "next/navigation" {
  export * from "@aphrody/m3/app/navigation";
}
declare module "next/headers" {
  export * from "@aphrody/m3/app/headers";
}
declare module "next/server" {
  export * from "@aphrody/m3/app/server";
}
declare module "next/cache" {
  export * from "@aphrody/m3/app/cache";
}
declare module "next/image" {
  export { default } from "@aphrody/m3/app/image";
  export * from "@aphrody/m3/app/image";
}
