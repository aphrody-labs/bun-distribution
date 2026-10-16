"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  EMOTES,
  getEmotesByCategory,
  getEmotesByCharacter,
  getRandomEmote,
  getRandomEmoteByCharacter,
} from "@/lib/emotes";
import type { Emote } from "@/lib/emotes";

/**
 * Hook pour utiliser les emotes Rose Griffon
 * Fournit des utilitaires pour manipuler et afficher les emotes
 */
export function useEmotes() {
  const [selectedEmote, setSelectedEmote] = useState<Emote | null>(null);

  const allEmotes = useMemo(() => Object.values(EMOTES), []);

  const selectEmote = useCallback((emoteName: keyof typeof EMOTES) => {
    const emote = EMOTES[emoteName];
    if (emote) {
      setSelectedEmote(emote);
    }
  }, []);

  const selectRandomEmote = useCallback(() => {
    const emote = getRandomEmote();
    setSelectedEmote(emote);
    return emote;
  }, []);

  const selectRandomByCharacter = useCallback((character: "gaelle" | "roy" | "rg") => {
    const emote = getRandomEmoteByCharacter(character);
    setSelectedEmote(emote);
    return emote;
  }, []);

  const getByCharacter = useCallback(
    (character: "gaelle" | "roy" | "rg") => getEmotesByCharacter(character),
    [],
  );

  const getByCategory = useCallback(
    (category: "reaction" | "greeting" | "emotion") => getEmotesByCategory(category),
    [],
  );

  return {
    /** Toutes les emotes disponibles */
    allEmotes,
    /** Réinitialiser la sélection */
    clearSelection: () => setSelectedEmote(null),
    /** Obtenir les emotes d'une catégorie */
    getByCategory,
    /** Obtenir les emotes d'un personnage */
    getByCharacter,
    /** Sélectionner une emote par son nom */
    selectEmote,
    /** Sélectionner une emote aléatoire d'un personnage */
    selectRandomByCharacter,
    /** Sélectionner une emote aléatoire */
    selectRandomEmote,
    /** Emote actuellement sélectionnée */
    selectedEmote,
  };
}

/**
 * Hook pour gérer l'historique de sélection d'emotes
 */
export function useEmoteHistory(maxHistory: number = 10) {
  const [history, setHistory] = useState<Emote[]>([]);

  const addToHistory = useCallback(
    (emote: Emote) => {
      setHistory((prev) => {
        // Supprimer les doublons et ajouter en tête
        const filtered = prev.filter((e) => e.name !== emote.name);
        const newHistory = [emote, ...filtered];
        // Limiter l'historique
        return newHistory.slice(0, maxHistory);
      });
    },
    [maxHistory],
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return {
    /** Ajouter une emote à l'historique */
    addToHistory,
    /** Effacer l'historique */
    clearHistory,
    /** Historique des emotes utilisées (les plus récentes en premier) */
    history,
  };
}

/**
 * Hook pour les animations aléatoires d'emotes
 * Utile pour afficher des emotes qui changent périodiquement
 */
export function useEmoteRotation(interval: number = 3000, character?: "gaelle" | "roy" | "rg") {
  const [currentEmote, setCurrentEmote] = useState<Emote>(() =>
    character ? getRandomEmoteByCharacter(character) : getRandomEmote(),
  );

  const rotate = useCallback(() => {
    const newEmote = character ? getRandomEmoteByCharacter(character) : getRandomEmote();
    setCurrentEmote(newEmote);
  }, [character]);

  // Auto-rotation
  useEffect(() => {
    if (interval > 0) {
      const timer = setInterval(rotate, interval);
      return () => clearInterval(timer);
    }
  }, [interval, rotate]);

  return {
    /** Emote actuellement affichée */
    currentEmote,
    /** Changer manuellement d'emote */
    rotate,
  };
}

/**
 * Hook pour valider si un texte contient des emotes valides
 */
export function useEmoteValidation(text: string) {
  const validation = useMemo(() => {
    const emotePattern = /:([a-z]+-?[a-z]+):/g;
    const matches = [...text.matchAll(emotePattern)];

    const valid: string[] = [];
    const invalid: string[] = [];

    matches.forEach((match) => {
      const emoteName = match[1];
      if (emoteName && Object.hasOwn(EMOTES, emoteName)) {
        valid.push(emoteName);
      } else if (emoteName) {
        invalid.push(emoteName);
      }
    });

    return {
      /** Le texte contient-il des emotes invalides ? */
      hasInvalidEmotes: invalid.length > 0,
      /** Le texte contient-il des emotes valides ? */
      hasValidEmotes: valid.length > 0,
      /** Emotes invalides (non trouvées dans EMOTES) */
      invalid,
      /** Toutes les emotes sont-elles valides ? */
      isFullyValid: invalid.length === 0 && valid.length > 0,
      /** Emotes valides trouvées */
      valid,
    };
  }, [text]);

  return validation;
}
