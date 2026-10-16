// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  evaluateArithmetic,
  formatNumber,
  getDefaultSuggestions,
  suggest,
  DEFAULT_RECENT_LOCATIONS,
  type NavigationSuggestion,
  type CommandSuggestion,
  type FileSuggestion,
  type CalculatorSuggestion,
  type ThreadSuggestion,
} from "./quickbar-suggest";
import type { ThreadSummary } from "./history";

describe("quickbar & command palette suggestions (Magpie unified spotlight)", () => {
  const sampleThreads: ThreadSummary[] = [
    { id: "thread-1", title: "Refactorisation du moteur M3", updatedAt: 1000 },
    {
      id: "thread-2",
      title: "Discussion sur les modèles locaux Ollama",
      updatedAt: 2000,
    },
    {
      id: "thread-3",
      title: "Calcul de métriques GPU et VRAM",
      updatedAt: 3000,
    },
  ];

  const allSources = {
    calculator: true,
    history: true,
    navigation: true,
    commands: true,
    files: true,
  };

  describe("calculator engine", () => {
    test("evaluates expressions and formats results cleanly", () => {
      expect(evaluateArithmetic("2 + 2")).toBe(4);
      expect(evaluateArithmetic("10 * (5 + 3)")).toBe(80);
      expect(evaluateArithmetic("2^3^2")).toBe(512);
      expect(evaluateArithmetic("1,5 * 4")).toBe(6);
      expect(evaluateArithmetic("10 / 4")).toBe(2.5);
      expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    });

    test("returns calculator suggestion when input is arithmetic", () => {
      const results = suggest("25 * 4", sampleThreads, allSources);
      expect(results.length).toBeGreaterThanOrEqual(1);
      const first = results[0] as CalculatorSuggestion;
      expect(first.kind).toBe("calculator");
      expect(first.expression).toBe("25 * 4");
      expect(first.value).toBe("100");
    });

    test("ignores non-arithmetic text and questions", () => {
      expect(evaluateArithmetic("comment faire un calcul ?")).toBeNull();
      expect(evaluateArithmetic("est-ce que 2+2 font 4 ?")).toBeNull();
    });

    test("honors calculator: false", () => {
      const results = suggest("2 + 2", sampleThreads, {
        ...allSources,
        calculator: false,
      });
      const hasCalc = results.some((r) => r.kind === "calculator");
      expect(hasCalc).toBe(false);
    });
  });

  describe("thread history source", () => {
    test("matches words in conversation threads", () => {
      const results = suggest("moteur M3", sampleThreads, allSources);
      const threadResult = results.find(
        (r): r is ThreadSuggestion => r.kind === "thread",
      );
      expect(threadResult).toBeDefined();
      expect(threadResult?.thread.id).toBe("thread-1");
    });

    test("honors history: false", () => {
      const results = suggest("moteur M3", sampleThreads, {
        ...allSources,
        history: false,
      });
      const hasThread = results.some((r) => r.kind === "thread");
      expect(hasThread).toBe(false);
    });
  });

  describe("navigation source (4 canonical zones & sub-surfaces)", () => {
    test("suggests 'Aller au chat' on 'chat' or 'codex'", () => {
      const resultsChat = suggest("chat", sampleThreads, allSources);
      const navChat = resultsChat.find(
        (r): r is NavigationSuggestion =>
          r.kind === "navigation" && r.label === "Aller au chat",
      );
      expect(navChat).toBeDefined();
      expect(navChat?.route).toBe("/chat");

      const resultsCodex = suggest("codex", sampleThreads, allSources);
      const navCodex = resultsCodex.find(
        (r): r is NavigationSuggestion =>
          r.kind === "navigation" && r.label === "Aller au chat",
      );
      expect(navCodex).toBeDefined();
    });

    test("suggests 'Aller aux fichiers' on 'fichiers' or 'explorer'", () => {
      const results = suggest("fichiers", sampleThreads, allSources);
      const navFiles = results.find(
        (r): r is NavigationSuggestion =>
          r.kind === "navigation" && r.label === "Aller aux fichiers",
      );
      expect(navFiles).toBeDefined();
      expect(navFiles?.route).toBe("/explorer");
    });

    test("suggests 'Aller aux Modèles' on 'modèles' or 'models'", () => {
      const resultsFr = suggest("modèles", sampleThreads, allSources);
      const navModelsFr = resultsFr.find(
        (r): r is NavigationSuggestion =>
          r.kind === "navigation" && r.label === "Aller aux Modèles",
      );
      expect(navModelsFr).toBeDefined();
      expect(navModelsFr?.route).toBe("/models");

      const resultsEn = suggest("models", sampleThreads, allSources);
      const navModelsEn = resultsEn.find(
        (r): r is NavigationSuggestion =>
          r.kind === "navigation" && r.label === "Aller aux Modèles",
      );
      expect(navModelsEn).toBeDefined();
    });

    test("does not expose jobs as a standalone navigation surface", () => {
      const results = suggest("cron", sampleThreads, allSources);
      const navTasks = results.find(
        (r): r is NavigationSuggestion =>
          r.kind === "navigation" && r.route === "/tasks",
      );
      expect(navTasks).toBeUndefined();
    });

    test("suggests 'Ouvrir les Paramètres' on 'paramètres' or 'settings'", () => {
      const results = suggest("paramètres", sampleThreads, allSources);
      const navSettings = results.find(
        (r): r is NavigationSuggestion =>
          r.kind === "navigation" && r.label === "Ouvrir les Paramètres",
      );
      expect(navSettings).toBeDefined();
      expect(navSettings?.route).toBe("/settings");
    });

    test("honors navigation: false", () => {
      const results = suggest("chat", sampleThreads, {
        ...allSources,
        navigation: false,
      });
      const hasNav = results.some((r) => r.kind === "navigation");
      expect(hasNav).toBe(false);
    });
  });

  describe("command source (> prefix & direct keywords)", () => {
    test("'>' lists all available system commands", () => {
      const results = suggest(">", sampleThreads, allSources, { limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.kind === "command")).toBe(true);
    });

    test("'> models' returns the models command", () => {
      const results = suggest("> models", sampleThreads, allSources);
      const cmd = results.find(
        (r): r is CommandSuggestion =>
          r.kind === "command" && r.command === "models",
      );
      expect(cmd).toBeDefined();
      expect(cmd?.label).toBe("> models");
    });

    test("'> clear' returns the clear command", () => {
      const results = suggest("> clear", sampleThreads, allSources);
      const cmd = results.find(
        (r): r is CommandSuggestion =>
          r.kind === "command" && r.command === "clear",
      );
      expect(cmd).toBeDefined();
      expect(cmd?.label).toBe("> clear");
    });

    test("matches commands without '>' by keyword", () => {
      const resultsClear = suggest("clear", sampleThreads, allSources);
      const cmdClear = resultsClear.find(
        (r): r is CommandSuggestion =>
          r.kind === "command" && r.command === "clear",
      );
      expect(cmdClear).toBeDefined();
    });

    test("honors commands: false", () => {
      const results = suggest("> models", sampleThreads, {
        ...allSources,
        commands: false,
      });
      expect(results.length).toBe(0);
    });
  });

  describe("recent files source", () => {
    test("does not seed machine-specific recent files", () => {
      expect(DEFAULT_RECENT_LOCATIONS).toEqual([]);
      expect(suggest("unknown-query", sampleThreads, allSources)).toEqual([]);
    });

    test("supports custom recent files in options", () => {
      const customFiles = [
        { name: "MonProjet.rs", path: "C:/src/MonProjet.rs", isDir: false },
      ];
      const results = suggest("MonProjet", sampleThreads, allSources, {
        files: customFiles,
      });
      const file = results.find(
        (r): r is FileSuggestion =>
          r.kind === "file" && r.name === "MonProjet.rs",
      );
      expect(file).toBeDefined();
      expect(file?.path).toBe("C:/src/MonProjet.rs");
    });

    test("honors files: false", () => {
      const results = suggest("unknown-query", sampleThreads, {
        ...allSources,
        files: false,
      });
      const hasFile = results.some((r) => r.kind === "file");
      expect(hasFile).toBe(false);
    });
  });

  describe("Magpie unified spotlight behavior & performance", () => {
    test("returns empty array for empty query string", () => {
      expect(suggest("", sampleThreads, allSources)).toEqual([]);
      expect(suggest("   ", sampleThreads, allSources)).toEqual([]);
    });

    test("getDefaultSuggestions returns quick launcher targets for empty draft in Command Palette", () => {
      const defaults = getDefaultSuggestions(allSources, 8);
      expect(defaults.length).toBe(8);
      expect(defaults[0].kind).toBe("navigation");
      expect(
        defaults.some(
          (d) => d.kind === "navigation" && d.label === "Aller au chat",
        ),
      ).toBe(true);
      expect(
        defaults.some(
          (d) => d.kind === "navigation" && d.label === "Aller aux fichiers",
        ),
      ).toBe(true);
    });

    test("respects limit parameter across all sources", () => {
      const results = suggest("a", sampleThreads, allSources, { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    test("executes synchronously and rapidly (non-saturating pure in-memory search)", () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        suggest("chat", sampleThreads, allSources);
        suggest("> models", sampleThreads, allSources);
        suggest("12 * 45", sampleThreads, allSources);
        suggest("aphrody", sampleThreads, allSources);
      }
      const elapsed = performance.now() - start;
      // 400 searches should easily complete in less than 50ms
      expect(elapsed).toBeLessThan(50);
    });
  });
});
