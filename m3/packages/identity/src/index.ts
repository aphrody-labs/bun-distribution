// SPDX-License-Identifier: Apache-2.0
// @aphrody/identity: the Aphrody product identity for React/M3 surfaces.
//   AphrodyAvatar  brand emblem in an M3 avatar container (needs the @aphrody/m3 `?url` loader)
//   AphrodyPet     animated pet sprite; pass `PET_ATLAS_URL` from "@aphrody/identity/atlas"
//   PET, frameAt, gazeFrame, spriteStyle  pure pet data ("@aphrody/identity/pet", no loader needed)
export { AphrodyAvatar, type AphrodyAvatarProps } from "./AphrodyAvatar";
export { AphrodyPet, type AphrodyPetProps } from "./AphrodyPet";
export { PET_COLORS } from "./pet";
export { BRAND_ICONS, brandIcon, brandSrcSet } from "./brand";
export * from "./pet";
export {
  publicAssetsBase,
  publicAssetUrl,
  publicPetAtlas,
  publicPetSymbol,
  publicMaterialSymbolsIndex,
} from "./public-assets";
