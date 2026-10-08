// SPDX-License-Identifier: Apache-2.0
// Contract of the Rose Griffon host packages this design system imports. They are optional peer dependencies:
// the host monorepo provides the implementations, this package only types what it consumes.
declare module "@rosegriffon/preferences" {
  export type ThemeId = "roy" | "gaelle" | "azalee-light" | "azalee-dark" | "achillea";
}
declare module "@rosegriffon/types/profil" {
  export const BADGES_PROFIL: readonly string[];
  export const MAX_BADGES_PROFIL: number;
}
declare module "@rosegriffon/types/roles" {
  export function libelleRole(role: string): string;
}
declare module "@rosegriffon/db/storage" {
  export function getAssetUrl(path: string): string;
}
