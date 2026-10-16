// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { DEFAULT_LOCALE_REGISTRY, UI_MESSAGES, uiMessage } from "../src/index";

describe("semantic UI catalogue", () => {
  test("all supported locales provide the same seven meaningful messages", () => {
    const keys = Object.keys(UI_MESSAGES.fr).sort();
    expect(keys).toHaveLength(7);
    expect(Object.keys(UI_MESSAGES).sort()).toEqual(DEFAULT_LOCALE_REGISTRY.locales.map(locale => locale.tag).sort());
    for (const dictionary of Object.values(UI_MESSAGES)) {
      expect(Object.keys(dictionary).sort()).toEqual(keys);
      expect(Object.values(dictionary).every(value => value.trim().length > 0)).toBe(true);
    }
  });

  test("preserves existing French account and action labels", () => {
    expect(UI_MESSAGES.fr).toEqual({
      "account.patreon.title": "Compte Patreon",
      "account.patreon.status.linked": "Connecté",
      "account.patreon.status.unlinked": "Non lié",
      "account.patreon.action.disconnect": "Déconnecter",
      "account.patreon.action.link": "Lier mon Patreon",
      "account.patreon.confirmDisconnect.title": "Déconnecter Patreon ?",
      "common.action.cancel": "Annuler",
    });
  });

  test("resolves English and Japanese regional tags through the canonical registry", () => {
    expect(uiMessage("en-GB", "account.patreon.title")).toBe("Patreon account");
    expect(uiMessage("ja-JP", "account.patreon.action.disconnect")).toBe("連携を解除");
    expect(uiMessage("en", "common.action.cancel")).toBe("Cancel");
  });

  test("uses the host's French fallback for missing, unsupported and malformed locale tags", () => {
    for (const locale of [undefined, null, "zz", "not_a_locale", "fr-CA"]) {
      expect(uiMessage(locale, "account.patreon.title")).toBe("Compte Patreon");
    }
  });
});
