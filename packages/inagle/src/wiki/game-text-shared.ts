/** Types client-safe pour la projection de texte de jeu. */
import type { GameTextLocale } from "../game-text/shared";

export type { GameTextLocale, GameTextLocalized } from "../game-text/shared";
export { normalizeHashId, pickLocale } from "../game-text/shared";

export const LOCALE_LABELS: Record<GameTextLocale, string> = {
  en: "English",
  fr: "Français",
  ja: "日本語",
};
