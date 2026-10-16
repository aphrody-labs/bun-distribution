// SPDX-License-Identifier: Apache-2.0
import { buildFallbackChain } from "./registry";

const french = {
  "account.patreon.title": "Compte Patreon",
  "account.patreon.status.linked": "Connecté",
  "account.patreon.status.unlinked": "Non lié",
  "account.patreon.action.disconnect": "Déconnecter",
  "account.patreon.action.link": "Lier mon Patreon",
  "account.patreon.confirmDisconnect.title": "Déconnecter Patreon ?",
  "common.action.cancel": "Annuler",
};

export type UiMessageKey = keyof typeof french;
type Messages = Readonly<Record<UiMessageKey, string>>;

/** UI messages, separate from the host's game-data dictionaries and their hash keys. */
export const UI_MESSAGES: Readonly<Record<"fr" | "en" | "ja", Messages>> = {
  fr: french,
  en: {
    "account.patreon.title": "Patreon account",
    "account.patreon.status.linked": "Connected",
    "account.patreon.status.unlinked": "Not linked",
    "account.patreon.action.disconnect": "Disconnect",
    "account.patreon.action.link": "Link my Patreon",
    "account.patreon.confirmDisconnect.title": "Disconnect Patreon?",
    "common.action.cancel": "Cancel",
  },
  ja: {
    "account.patreon.title": "Patreonアカウント",
    "account.patreon.status.linked": "連携済み",
    "account.patreon.status.unlinked": "未連携",
    "account.patreon.action.disconnect": "連携を解除",
    "account.patreon.action.link": "Patreonと連携",
    "account.patreon.confirmDisconnect.title": "Patreonとの連携を解除しますか？",
    "common.action.cancel": "キャンセル",
  },
};

const catalogues: ReadonlyMap<string, Messages> = new Map(Object.entries(UI_MESSAGES));

/** Resolve semantic UI messages with the same BCP-47 negotiation and French fallback as the host. */
export function uiMessage(locale: string | null | undefined, key: UiMessageKey): string {
  for (const tag of buildFallbackChain(locale)) {
    const message = catalogues.get(tag)?.[key];
    if (message !== undefined) return message;
  }
  throw new RangeError(`Unknown UI message: ${key}`);
}
