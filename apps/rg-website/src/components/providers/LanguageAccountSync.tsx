"use client";

import { isLocaleId } from "@rosegriffon/preferences";
import { useEffect, useRef } from "react";

import { useLanguage } from "@/components/providers/language-provider";
import { useAuth } from "@/contexts/auth-context";
import { authClient } from "@/lib/auth-client";

/**
 * Fait suivre la langue au compte Better Auth (`user.locale`).
 *
 * À l'ouverture de session, la langue enregistrée sur le compte s'applique à
 * l'appareil ; ensuite, chaque changement fait depuis le sélecteur est écrit
 * sur le compte. Sans session, seul le cookie `rg-locale` fait foi.
 */
export function LanguageAccountSync() {
  const { user } = useAuth();
  const { language, setLanguage } = useLanguage();
  const accountLocale = (user as { locale?: string | null } | null)?.locale ?? null;
  const appliedFor = useRef<string | null>(null);
  const lastSaved = useRef<string | null>(null);

  // Session ouverte : la langue du compte s'impose une fois à cet appareil.
  useEffect(() => {
    if (!user || appliedFor.current === user.id) return;
    appliedFor.current = user.id;
    lastSaved.current = accountLocale;
    if (isLocaleId(accountLocale) && accountLocale !== language) setLanguage(accountLocale);
  }, [user, accountLocale, language, setLanguage]);

  // Puis le choix de l'appareil est enregistré sur le compte.
  useEffect(() => {
    if (!user || appliedFor.current !== user.id || lastSaved.current === language) return;
    lastSaved.current = language;
    void authClient.updateUser({ locale: language } as Parameters<typeof authClient.updateUser>[0]);
  }, [user, language]);

  return null;
}
