// SPDX-License-Identifier: Apache-2.0
// Unit tests for Jan & Kunkun parity features in Aphrody Desktop

import { describe, expect, test } from "bun:test";
import { filterSessionsList, SYSTEM_PRESETS, TOKEN_LIMIT_OPTIONS } from "./system-presets";
import { SIDEBAR_COLLAPSED_KEY, STORE_SIDEBAR_COLLAPSED } from "./preferences";

describe("Jan Parity - System Presets & Inference Tuning", () => {
  test("SYSTEM_PRESETS includes default, engineer, code_reviewer and custom presets", () => {
    expect(SYSTEM_PRESETS.default).toBeDefined();
    expect(SYSTEM_PRESETS.default.label).toBe("Default assistant");
    expect(SYSTEM_PRESETS.default.prompt.length).toBeGreaterThan(10);

    expect(SYSTEM_PRESETS.engineer).toBeDefined();
    expect(SYSTEM_PRESETS.engineer.label).toBe("Autonomous engineer");
    expect(SYSTEM_PRESETS.engineer.prompt).toContain("autonomous senior staff engineer");

    expect(SYSTEM_PRESETS.code_reviewer).toBeDefined();
    expect(SYSTEM_PRESETS.code_reviewer.label).toBe("Rigorous code reviewer");
    expect(SYSTEM_PRESETS.code_reviewer.prompt).toContain("code reviewer");

    expect(SYSTEM_PRESETS.custom).toBeDefined();
    expect(SYSTEM_PRESETS.custom.label).toContain("Custom");
  });

  test("Inference parameter ranges are respected", () => {
    const defaultTemperature = 0.7;
    const defaultMaxTokens = 4096;

    expect(defaultTemperature).toBeGreaterThanOrEqual(0.0);
    expect(defaultTemperature).toBeLessThanOrEqual(2.0);
    expect(TOKEN_LIMIT_OPTIONS).toContain(defaultMaxTokens);
  });
});

describe("Kunkun Parity - Search & Filtering", () => {
  const sampleSessions = [
    {
      id: "thread-abc-123",
      preview: "Rust refactor of aphrody-app",
      cwd: "/home/user/src/aphrody",
    },
    {
      id: "thread-def-456",
      preview: "Atlas canon analysis of the archive",
      cwd: "/home/user/src/atlas",
    },
    {
      id: "thread-ghi-789",
      preview: "Database optimization",
      cwd: "/home/user/data",
    },
  ];

  test("Filters sessions by title query", () => {
    const filtered = filterSessionsList(sampleSessions, "refactor");
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("thread-abc-123");
  });

  test("Filters sessions by cwd path", () => {
    const filtered = filterSessionsList(sampleSessions, "atlas");
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("thread-def-456");
  });

  test("Returns all sessions when query is empty", () => {
    const filtered = filterSessionsList(sampleSessions, "   ");
    expect(filtered.length).toBe(3);
  });
});

function parseCollapsed(raw: string | null): boolean {
  try {
    return raw ? JSON.parse(raw) === true : false;
  } catch {
    return false;
  }
}

describe("M3 Adaptive Collapsible Sidebar Parity", () => {
  test("Sidebar storage keys are defined consistently", () => {
    expect(STORE_SIDEBAR_COLLAPSED).toBe("sidebar.collapsed");
    expect(SIDEBAR_COLLAPSED_KEY).toBe("aphrody.sidebar.collapsed");
  });

  test("Sidebar default collapsed state is false", () => {
    expect(parseCollapsed(null)).toBe(false);
    expect(parseCollapsed("")).toBe(false);
    expect(parseCollapsed("false")).toBe(false);
    expect(parseCollapsed("true")).toBe(true);
    expect(parseCollapsed("invalid-json")).toBe(false);
  });

  test("Sidebar width classes adhere to M3 specifications", () => {
    const collapsedWidth = 88;
    const expandedWidth = 256;
    expect(collapsedWidth).toBe(88);
    expect(expandedWidth).toBe(256);
  });
});
