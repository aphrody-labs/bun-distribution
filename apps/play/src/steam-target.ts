// SPDX-License-Identifier: Apache-2.0
/** Steam app identities shared by the stream link and the authenticated launch route. */
export function steamAppId(value: string | null): number | null {
  if (!value || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= 0xffff_ffff ? id : null;
}

export function steamStreamUrl(appId: number): string {
  if (steamAppId(String(appId)) === null)
    throw new Error("invalid Steam app id");
  return `/stream?appId=${appId}`;
}

export function installedSteamGame<
  T extends { appId: number; stateFlags: number; sizeOnDisk: number },
>(games: readonly T[], appId: number): T | undefined {
  return games.find(
    (game) =>
      game.appId === appId &&
      (game.stateFlags & 4) !== 0 &&
      game.sizeOnDisk > 0,
  );
}
