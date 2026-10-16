// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  loadModelInventories,
  stopModelDownload,
  isChatModel,
} from "./models-hub-actions";
import { listAllThreads } from "./history-panel";
import { useChatStore, getProjectGroups } from "./stores/chat-store";

describe("Jan UI absorption: owner contract behavior", () => {
  const installed = {
    root: "/synthetic/models",
    count: 0,
    total_bytes: 0,
    models: [],
  };
  test("catalog failure preserves a successful installed inventory and reports failure", async () => {
    const result = await loadModelInventories(
      async () => {
        throw new Error("offline");
      },
      async () => installed,
    );
    expect(result.installed).toBe(installed);
    expect(result.catalog).toBeUndefined();
    expect(result.error).toContain("Catalogue : offline");
  });
  test("store failure cannot appear as an empty successful store", async () => {
    const result = await loadModelInventories(
      async () => ({ entries: [] }),
      async () => {
        throw new Error("denied");
      },
    );
    expect(result.installed).toBeUndefined();
    expect(result.error).toContain("Stockage : denied");
  });
  test("cancellation requires a real acknowledgement", async () => {
    await expect(stopModelDownload("model", async () => false)).rejects.toThrow(
      "Aucun téléchargement actif",
    );
    await expect(
      stopModelDownload("model", async () => {
        throw new Error("denied");
      }),
    ).rejects.toThrow("denied");
    let received = "";
    await stopModelDownload("model", async (id) => {
      received = id;
      return true;
    });
    expect(received).toBe("model");
  });
  test("OCR, embedding and unknown models cannot become a chat default", () => {
    expect(isChatModel({ task: "text-generation" })).toBe(true);
    for (const task of [
      "visual-transcription",
      "text-embedding",
      "speech-to-text",
    ])
      expect(isChatModel({ task })).toBe(false);
    expect(isChatModel(undefined)).toBe(false);
  });
  test("archived inventory carries its filter through every cursor page", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const result = await listAllThreads(
      async (method, params) => {
        expect(method).toBe("thread/list");
        calls.push(params!);
        return calls.length === 1
          ? {
              threads: [{ id: "old", name: "Old", updatedAt: 1 }],
              nextCursor: "page2",
            }
          : { threads: [{ id: "new", name: "New", updatedAt: 2 }] };
      },
      10,
      true,
    );
    expect(calls).toEqual([
      { limit: 100, archived: true },
      { cursor: "page2", limit: 100, archived: true },
    ]);
    expect(result.map((thread) => thread.id)).toEqual(["new", "old"]);
  });
  test("the UI starts without fabricated or cross-domain conversation groups", () => {
    expect(useChatStore.getState().threads).toEqual([]);
    expect(useChatStore.getState().activeThreadId).toBeNull();
    expect(getProjectGroups([], {})).toEqual([]);
  });
});
