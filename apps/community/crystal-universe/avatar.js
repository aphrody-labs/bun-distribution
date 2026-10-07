// SPDX-License-Identifier: Apache-2.0
export const DEFAULT_AVATAR = {
  name: "Patrouilleur",
  race: "saiyan",
  skin: "#f0c19a",
  hair: "#242b46",
  outfit: "#63e6ff",
  hairstyle: "spiky",
  build: "athletic",
  height: 1,
};

const races = new Set(["saiyan", "earthling", "namekian", "majin", "frieza", "android"]);
const hairstyles = new Set(["spiky", "short", "crest"]);
const builds = new Set(["slim", "athletic", "broad"]);
const colorPattern = /^#[0-9a-f]{6}$/i;

export function normalizeAvatar(value) {
  const avatar = value && typeof value === "object" ? value : {};
  return {
    name:
      typeof avatar.name === "string"
        ? avatar.name.trim().slice(0, 20) || DEFAULT_AVATAR.name
        : DEFAULT_AVATAR.name,
    race: races.has(avatar.race) ? avatar.race : DEFAULT_AVATAR.race,
    skin: colorPattern.test(avatar.skin) ? avatar.skin : DEFAULT_AVATAR.skin,
    hair: colorPattern.test(avatar.hair) ? avatar.hair : DEFAULT_AVATAR.hair,
    outfit: colorPattern.test(avatar.outfit) ? avatar.outfit : DEFAULT_AVATAR.outfit,
    hairstyle: hairstyles.has(avatar.hairstyle) ? avatar.hairstyle : DEFAULT_AVATAR.hairstyle,
    build: builds.has(avatar.build) ? avatar.build : DEFAULT_AVATAR.build,
    height: Number.isFinite(Number(avatar.height))
      ? Math.max(0.85, Math.min(1.15, Number(avatar.height)))
      : DEFAULT_AVATAR.height,
  };
}

export function loadAvatar(storage) {
  try {
    return normalizeAvatar(JSON.parse(storage.getItem("dragon-pixel-avatar") || "null"));
  } catch {
    return { ...DEFAULT_AVATAR };
  }
}

export function saveAvatar(storage, value) {
  const avatar = normalizeAvatar(value);
  storage.setItem("dragon-pixel-avatar", JSON.stringify(avatar));
  return avatar;
}
