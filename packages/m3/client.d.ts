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
