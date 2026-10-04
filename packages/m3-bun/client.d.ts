// SPDX-License-Identifier: Apache-2.0
// Ambient types of the `m3:*` modules the @aphrody/m3-bun plugin serves. Reference it from an app:
//   /// <reference types="@aphrody/m3-bun/client" />

/** Material Symbols SVG markup: `m3:icons/home`, `m3:icons/rounded/home?fill=1&wght=300`. */
declare module "m3:icons/*" {
  const svg: string;
  export default svg;
}

/** A module that may be absent: the namespace and `resolved: true`, or `null` and `resolved: false`. */
declare module "m3:optional/*" {
  const namespace: Record<string, unknown> | null;
  export default namespace;
  export const resolved: boolean;
}

declare module "m3:theme.css";
declare module "m3:tokens.css";
declare module "m3:scheme.css";
declare module "m3:fonts.css";
declare module "m3:fonts-jp.css";
declare module "m3:fonts-symbols.css";

/** Bun file-loader asset imports, including embedded font assets in compiled apps. */
declare module "*.woff2" {
  const path: string;
  export default path;
}
