// SPDX-License-Identifier: Apache-2.0
// Lightweight, reactive i18n store supporting French and English.
import { create } from "zustand";

export type SupportedLanguage = "fr" | "en";

export interface I18nStoreState {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: (key: string, defaultText?: string) => string;
}

const STORAGE_KEY = "aphrody.ui.language";

const TRANSLATIONS: Record<SupportedLanguage, Record<string, string>> = {
  fr: {
    "nav.chat": "Chat & Assistant",
    "nav.explorer": "Fichiers & VDFS",
    "nav.models": "Modèles & IA",
    "nav.settings": "Paramètres",
    "common.loading": "Chargement…",
    "common.execute": "Exécuter",
    "common.cancel": "Annuler",
    "common.save": "Enregistrer",
    "common.delete": "Supprimer",
    "common.search": "Rechercher…",
    "common.status": "Statut",
    "common.active": "Actif",
    "common.paused": "En pause",
    "common.success": "Succès",
    "common.failure": "Échec",
    "groups.devices": "Appareils",
    "groups.locations": "Emplacements",
    "groups.volumes": "Volumes",
    "groups.tags": "Balises",
    "groups.sources": "Sources distantes",
    "inspector.ask_ai": "Poser une question sur ce fichier",
    "inspector.no_activity": "Aucun événement récent sur ce fichier.",
    "inspector.generating_answer": "Shenron analyse le fichier…",
    "inspector.smart_search": "Recherche sémantique",
    "inspector.find_duplicates": "Trouver des doublons",
    "inspector.organize_files": "Proposer un classement",
  },
  en: {
    "nav.chat": "Chat & Assistant",
    "nav.explorer": "Files & VDFS",
    "nav.models": "Models & AI",
    "nav.settings": "Settings",
    "common.loading": "Loading…",
    "common.execute": "Execute",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.delete": "Delete",
    "common.search": "Search…",
    "common.status": "Status",
    "common.active": "Active",
    "common.paused": "Paused",
    "common.success": "Success",
    "common.failure": "Failure",
    "groups.devices": "Devices",
    "groups.locations": "Locations",
    "groups.volumes": "Volumes",
    "groups.tags": "Tags",
    "groups.sources": "Remote sources",
    "inspector.ask_ai": "Ask a question about this file",
    "inspector.no_activity": "No recent events recorded for this file.",
    "inspector.generating_answer": "Shenron is analyzing the file…",
    "inspector.smart_search": "Smart search",
    "inspector.find_duplicates": "Find duplicates",
    "inspector.organize_files": "Suggest file organization",
  },
};

function getInitialLanguage(): SupportedLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") return saved;
    const browserLang = navigator.language.toLowerCase();
    return browserLang.startsWith("en") ? "en" : "fr";
  } catch {
    return "fr";
  }
}

export const useI18n = create<I18nStoreState>((set, get) => ({
  language: getInitialLanguage(),
  setLanguage: (lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
    set({ language: lang });
  },
  t: (key, defaultText) => {
    const lang = get().language;
    return TRANSLATIONS[lang]?.[key] || defaultText || key;
  },
}));
