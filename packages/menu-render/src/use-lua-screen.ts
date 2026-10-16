/** React hook for menu Lua executed by an explicitly supplied runtime adapter. */

import { useState, useEffect, useRef } from "react";
import type { LuaLayerState, MenuState } from "./lua-host";
import {
  runMenuScreen,
  runMenuScreenState,
  menuStateToOverrides,
  type RunMenuScreenOptions,
  type RunMenuStateOptions,
  type MenuObjectOverride,
} from "./lua-host";

/** Résultat du hook `useLuaScreen`. */
export interface UseLuaScreenResult {
  /**
   * État observable après exécution Lua (journal des appels, layers ouverts).
   * `null` si pas encore exécuté.
   */
  layerState: LuaLayerState | null;
  /** Vrai quand le script a été exécuté sans erreur. */
  isReady: boolean;
  /** Erreur d'exécution Lua, si applicable. */
  error: Error | null;
}

/**
 * Hook React : exécute le script Lua de menu IEVR côté navigateur.
 *
 * Re-exécute automatiquement si `source` ou `options.layerIds` changent.
 * L'exécution est synchrone (fengari = bloquant) mais encapsulée dans un
 * `useEffect` pour ne pas bloquer le rendu initial.
 *
 * @param source   Source Lua décompilé (string). Peut être `null` ou vide
 *                 pour désactiver l'exécution.
 * @param options  Options de couche + includes + hashes.
 */
export function useLuaScreen(
  source: string | null | undefined,
  options: RunMenuScreenOptions = {},
): UseLuaScreenResult {
  const [layerState, setLayerState] = useState<LuaLayerState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Sérialise les options pour éviter les re-renders inutiles
  const layerIdsKey = (options.layerIds ?? [0]).join(",");
  const layerArg = options.layerArg ?? 0;

  // Garde une référence stable aux options includes/hash
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!source) {
      setLayerState(null);
      setError(null);
      setIsReady(false);
      return;
    }

    setError(null);
    setIsReady(false);

    try {
      const state = runMenuScreen(source, optsRef.current);
      setLayerState(state);
      setIsReady(true);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setIsReady(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, layerIdsKey, layerArg, options.runtime]);

  return { layerState, isReady, error };
}

// ── useLuaMenu : état fidèle + overrides prêts pour <GameMenu> ────────────────

/** Résultat du hook `useLuaMenu`. */
export interface UseLuaMenuResult {
  /** Overrides par nom d'objet à passer à `<GameMenu overrides={...} />`. */
  overrides: Record<string, MenuObjectOverride>;
  /** État de menu complet reconstruit (layers/objets/groupes). */
  menuState: MenuState | null;
  /** Journal des appels + layers ouverts. */
  layerState: LuaLayerState | null;
  /** Vrai quand le script a été exécuté sans erreur. */
  isReady: boolean;
  /** Erreur d'exécution Lua, si applicable. */
  error: Error | null;
}

/**
 * Hook React : exécute le script de menu via le host FIDÈLE ({@link runMenuScreenState})
 * et renvoie des `overrides` directement consommables par `<GameMenu>` — le menu devient
 * INTERACTIF, piloté par la vraie logique Lua du jeu (visibilité, textes, nombres).
 *
 * @example
 * ```tsx
 * const { overrides, isReady } = useLuaMenu(luaSource, {
 *   layerIds: [292844459], funcluaJson,
 * });
 * return <GameMenu layout={layout} assetBase="/assets" overrides={overrides} />;
 * ```
 */
export function useLuaMenu(
  source: string | null | undefined,
  options: RunMenuStateOptions = {},
): UseLuaMenuResult {
  const [overrides, setOverrides] = useState<Record<string, MenuObjectOverride>>({});
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const [layerState, setLayerState] = useState<LuaLayerState | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isReady, setIsReady] = useState(false);

  const layerIdsKey = (options.layerIds ?? [0]).join(",");
  const layerArg = options.layerArg ?? 0;

  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!source) {
      setOverrides({});
      setMenuState(null);
      setLayerState(null);
      setError(null);
      setIsReady(false);
      return;
    }

    setError(null);
    setIsReady(false);

    try {
      const { layerState: ls, menuState: ms } = runMenuScreenState(source, optsRef.current);
      setLayerState(ls);
      setMenuState(ms);
      setOverrides(menuStateToOverrides(ms));
      setIsReady(true);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setIsReady(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, layerIdsKey, layerArg, options.runtime]);

  return { overrides, menuState, layerState, isReady, error };
}
