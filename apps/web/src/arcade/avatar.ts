// SPDX-License-Identifier: Apache-2.0

export interface AvatarConfig {
  name: string;
  race: 'saiyan' | 'earthling' | 'namekian' | 'majin' | 'frieza' | 'android';
  skin: string;
  hair: string;
  outfit: string;
  hairstyle: 'spiky' | 'short' | 'crest';
  build: 'slim' | 'athletic' | 'broad';
  height: number;
}

export const DEFAULT_AVATAR: AvatarConfig = {
  name: 'Patrouilleur',
  race: 'saiyan',
  skin: '#f0c19a',
  hair: '#242b46',
  outfit: '#63e6ff',
  hairstyle: 'spiky',
  build: 'athletic',
  height: 1,
};

const races = new Set(['saiyan', 'earthling', 'namekian', 'majin', 'frieza', 'android']);
const hairstyles = new Set(['spiky', 'short', 'crest']);
const builds = new Set(['slim', 'athletic', 'broad']);
const colorPattern = /^#[0-9a-f]{6}$/i;

export function normalizeAvatar(raw: Partial<AvatarConfig> | null | undefined): AvatarConfig {
  const source = raw || {};
  const race = races.has(String(source.race)) ? (source.race as AvatarConfig['race']) : DEFAULT_AVATAR.race;
  const hairstyle = hairstyles.has(String(source.hairstyle)) ? (source.hairstyle as AvatarConfig['hairstyle']) : DEFAULT_AVATAR.hairstyle;
  const build = builds.has(String(source.build)) ? (source.build as AvatarConfig['build']) : DEFAULT_AVATAR.build;
  const skin = colorPattern.test(String(source.skin)) ? String(source.skin) : DEFAULT_AVATAR.skin;
  const hair = colorPattern.test(String(source.hair)) ? String(source.hair) : DEFAULT_AVATAR.hair;
  const outfit = colorPattern.test(String(source.outfit)) ? String(source.outfit) : DEFAULT_AVATAR.outfit;
  const height = Math.min(1.25, Math.max(0.75, Number(source.height) || 1));
  const name = typeof source.name === 'string' && source.name.trim().length > 0
    ? source.name.trim().slice(0, 24)
    : DEFAULT_AVATAR.name;

  return { name, race, hairstyle, build, skin, hair, outfit, height };
}

export function loadAvatar(): AvatarConfig {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('aphrody_arcade_avatar');
      if (stored) {
        return normalizeAvatar(JSON.parse(stored));
      }
    }
  } catch {}
  return { ...DEFAULT_AVATAR };
}

export function saveAvatar(avatar: AvatarConfig): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('aphrody_arcade_avatar', JSON.stringify(avatar));
    }
  } catch {}
}
