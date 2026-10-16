// SPDX-License-Identifier: Apache-2.0
/// <reference types="@aphrody/m3/client" />

declare module "*.css";
declare module "@mkkellogg/gaussian-splats-3d";

declare module "*.wasm" {
  const path: string;
  export default path;
}
