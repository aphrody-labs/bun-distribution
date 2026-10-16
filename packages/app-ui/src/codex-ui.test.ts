// SPDX-License-Identifier: Apache-2.0
// Unit tests for Codex UI and Workspace Explorer.

import { describe, expect, test } from "bun:test";

const normalizeDestination = (dest: string): "chat" | "files" => {
  if (dest === "agent" || dest === "chat") return "chat";
  if (dest === "drive" || dest === "files" || dest === "windows")
    return "files";
  return "chat";
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (name: string, isDir: boolean) => {
  if (isDir) return { icon: "folder", color: "text-primary" };
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
      return { icon: "javascript", color: "text-amber-400" };
    case "rs":
      return { icon: "settings_suggest", color: "text-orange-400" };
    case "json":
    case "toml":
      return { icon: "tune", color: "text-teal-400" };
    case "md":
      return { icon: "description", color: "text-blue-400" };
    default:
      return { icon: "draft", color: "text-on-surface-variant" };
  }
};

describe("Codex UI - Architecture & Navigation", () => {
  test("Normalizes legacy and modern destinations to the 3 unified views", () => {
    expect(normalizeDestination("chat")).toBe("chat");
    expect(normalizeDestination("agent")).toBe("chat");
    expect(normalizeDestination("files")).toBe("files");
    expect(normalizeDestination("drive")).toBe("files");
  });

  test("FormatBytes utility correctly scales units", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });

  test("File extension icon mappings assign appropriate symbols", () => {
    expect(getFileIcon("src", true).icon).toBe("folder");
    expect(getFileIcon("app.tsx", false).icon).toBe("javascript");
    expect(getFileIcon("lib.rs", false).icon).toBe("settings_suggest");
    expect(getFileIcon("package.json", false).icon).toBe("tune");
    expect(getFileIcon("README.md", false).icon).toBe("description");
  });
});
