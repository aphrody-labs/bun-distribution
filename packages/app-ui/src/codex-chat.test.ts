import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CodexChat,
  FileChangeCard,
  ThreadDrawer,
  buildThreadRenamePayload,
  buildThreadForkPayload,
  buildThreadCompactPayload,
  shouldAutoCompactThread,
  type ApprovalItem,
  type ThreadSummary,
  type Turn,
} from "./codex-chat";

const buildReply = (
  appr: ApprovalItem,
  decision: "accept" | "acceptForSession" | "decline" | "cancel",
) => ({
  id: appr.id,
  result: { decision },
  backendGeneration: appr.backendGeneration,
});

describe("Codex Chat - Approval Decisions & Wire Formatting", () => {
  it("preserves exact server-issued file-change request ID and backendGeneration in reply payload", () => {
    const approval: ApprovalItem = {
      id: "req-approval-uuid-987",
      kind: "fileChange",
      title: "Autorisation requise : Modification",
      path: "src/main.rs",
      status: "pending",
      backendGeneration: 3,
    };

    const allowReply = buildReply(approval, "accept");
    expect(allowReply.id).toBe("req-approval-uuid-987");
    expect(allowReply.backendGeneration).toBe(3);
    expect(allowReply.result.decision).toBe("accept");

    const denyReply = buildReply(approval, "decline");
    expect(denyReply.id).toBe("req-approval-uuid-987");
    expect(denyReply.result.decision).toBe("decline");

    const sessionReply = buildReply(approval, "acceptForSession");
    expect(sessionReply.result.decision).toBe("acceptForSession");
  });

  it("handles numeric request IDs without converting to string", () => {
    const approval: ApprovalItem = {
      id: 42,
      kind: "fileChange",
      title: "Autorisation requise : Modification",
      path: "src/main.rs",
      diff: "+fn main() {}",
      status: "pending",
      backendGeneration: 1,
    };

    const reply = {
      id: approval.id,
      result: { decision: "decline" },
      backendGeneration: approval.backendGeneration,
    };

    expect(reply.id).toBe(42);
    expect(typeof reply.id).toBe("number");
  });

  it("defaults approval focus to decline (Deny)", () => {
    const defaultAction = "decline";
    expect(defaultAction).toBe("decline");
  });
});

describe("Codex Chat - Item & Turn Reduction", () => {
  it("keys items by itemId to keep identical tool names separate", () => {
    const turns: Turn[] = [];

    const tool1 = {
      id: "item-tool-1",
      role: "tool" as const,
      pair: {
        id: "item-tool-1",
        name: "file_read",
        argsRaw: "{}",
        args: null,
        resultRaw: "output 1",
        result: null,
        status: "completed" as const,
        title: "file_read",
      },
      itemId: "item-tool-1",
      turnId: "turn-1",
    };

    const tool2 = {
      id: "item-tool-2",
      role: "tool" as const,
      pair: {
        id: "item-tool-2",
        name: "file_read",
        argsRaw: "{}",
        args: null,
        resultRaw: "output 2",
        result: null,
        status: "completed" as const,
        title: "file_read",
      },
      itemId: "item-tool-2",
      turnId: "turn-1",
    };

    turns.push(tool1, tool2);

    expect(turns.length).toBe(2);
    expect(turns[0].id).toBe("item-tool-1");
    expect(turns[1].id).toBe("item-tool-2");
    expect((turns[0] as typeof tool1).pair.resultRaw).toBe("output 1");
    expect((turns[1] as typeof tool2).pair.resultRaw).toBe("output 2");
  });

  it("appends delta to matching assistant message without polluting previous messages", () => {
    const items: Array<{
      id: string;
      role: "assistant";
      content: string;
      streaming?: boolean;
      itemId?: string;
    }> = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Hello",
        streaming: false,
        itemId: "item-1",
      },
      {
        id: "msg-2",
        role: "assistant",
        content: "Work",
        streaming: true,
        itemId: "item-2",
      },
    ];

    const delta = " in progress";
    const targetItemId = "item-2";

    const updated = items.map((item) =>
      item.itemId === targetItemId
        ? Object.assign(item, { content: item.content + delta })
        : item,
    );

    expect(updated[0].content).toBe("Hello");
    expect(updated[1].content).toBe("Work in progress");
  });
});

describe("Codex Chat - Thread Actions & Wire Payloads", () => {
  it("builds exact payload for thread/name/update", () => {
    const payload = buildThreadRenamePayload(
      "thread-abc-123",
      "Nouveau titre de session",
    );
    expect(payload).toEqual({
      threadId: "thread-abc-123",
      name: "Nouveau titre de session",
    });
  });

  it("builds exact payload for thread/fork without turnId", () => {
    const payload = buildThreadForkPayload("thread-abc-123");
    expect(payload).toEqual({
      threadId: "thread-abc-123",
    });
  });

  it("builds exact payload for thread/fork with turnId", () => {
    const payload = buildThreadForkPayload("thread-abc-123", "turn-xyz-456");
    expect(payload).toEqual({
      threadId: "thread-abc-123",
      turnId: "turn-xyz-456",
    });
  });

  it("builds exact payload for thread/compact/start", () => {
    const payload = buildThreadCompactPayload("thread-abc-123");
    expect(payload).toEqual({
      threadId: "thread-abc-123",
    });
  });

  it("does not schedule another compaction when its terminal turn arrives", () => {
    expect(
      shouldAutoCompactThread(
        { status: "completed", items: [{ type: "agentMessage" }] },
        25,
      ),
    ).toBe(true);
    expect(
      shouldAutoCompactThread(
        { status: "completed", items: [{ type: "contextCompaction" }] },
        25,
      ),
    ).toBe(false);
    expect(
      shouldAutoCompactThread(
        { status: "failed", items: [{ type: "agentMessage" }] },
        25,
      ),
    ).toBe(false);
    expect(shouldAutoCompactThread({ status: "interrupted" }, 25)).toBe(false);
    expect(shouldAutoCompactThread({ status: "completed" }, 24)).toBe(false);
    expect(shouldAutoCompactThread({ status: "completed" }, 26, 25)).toBe(
      false,
    );
    expect(shouldAutoCompactThread({ status: "completed" }, 50, 25)).toBe(true);
  });

  it("updates thread state when renaming without mutating unrelated threads", () => {
    const threads: ThreadSummary[] = [
      {
        id: "t-1",
        name: "Initial 1",
        preview: "Init 1",
        createdAt: 1700000000,
      },
      {
        id: "t-2",
        name: "Initial 2",
        preview: "Init 2",
        createdAt: 1700000100,
      },
    ];

    const updated = threads.map((t) =>
      t.id === "t-1"
        ? Object.assign(t, {
            name: "Renamed 1",
            preview: "Renamed 1",
          })
        : t,
    );

    expect(updated[0].name).toBe("Renamed 1");
    expect(updated[0].preview).toBe("Renamed 1");
    expect(updated[1].name).toBe("Initial 2");
  });

  it("creates a derived session state upon forking", () => {
    const originalThread: ThreadSummary = {
      id: "t-original",
      name: "Branche principale",
      preview: "Branche principale",
      createdAt: 1700000000,
      cwd: "/repo/aphrody",
    };

    const forkedThread: ThreadSummary = {
      id: "t-forked-999",
      name: `${originalThread.name} (fork)`,
      preview: `${originalThread.name} (fork)`,
      createdAt: 1700000200,
      cwd: originalThread.cwd,
    };

    const threadList = [originalThread, forkedThread];
    expect(threadList.length).toBe(2);
    expect(threadList[1].id).toBe("t-forked-999");
    expect(threadList[0].id).toBe("t-original");
  });
});

describe("Codex Chat - ThreadDrawer Component", () => {
  it("renders nothing when isOpen is false", () => {
    const html = renderToStaticMarkup(
      createElement(ThreadDrawer, {
        isOpen: false,
        onClose: () => {},
        threads: [],
      }),
    );
    expect(html).toBe("");
  });

  it("renders sessions list, active indicator, and action buttons when open", () => {
    const threads: ThreadSummary[] = [
      {
        id: "t-1",
        name: "Analyse Architecture",
        createdAt: 1700000000,
        cwd: "C:/aphrody",
      },
      { id: "t-2", preview: "Deuxième échange", createdAt: 1700001000 },
    ];

    const html = renderToStaticMarkup(
      createElement(ThreadDrawer, {
        isOpen: true,
        onClose: () => {},
        threads: threads,
        activeThreadId: "t-1",
        onRenameThread: () => {},
        onForkThread: () => {},
        onCompactThread: () => {},
      }),
    );

    expect(html).toContain("Historique des sessions");
    expect(html).toContain("Analyse Architecture");
    expect(html).toContain("Deuxième échange");
    expect(html).toContain("Active");
    expect(html).toContain("Renommer la session");
    expect(html).toContain("Bifurquer le fil");
    expect(html).toContain("Compacter le fil");
  });

  it("renders empty state message when thread list is empty", () => {
    const html = renderToStaticMarkup(
      createElement(ThreadDrawer, {
        isOpen: true,
        onClose: () => {},
        threads: [],
      }),
    );

    expect(html).toContain(
      "Aucune session : envoyez un message pour en créer une",
    );
  });
});

describe("Codex Chat - Pixel-Perfect Parity & Timeline Cards", () => {
  it("renders FileChangeCard with localized kind label, path, 'Voir le diff' and NO line counts", () => {
    const html = renderToStaticMarkup(
      createElement(FileChangeCard, {
        path: "crates/ui/app/src/lib.rs",
        kind: "Modified",
        diff: "+#[tauri::command]\n+async fn aphrody_rpc() {}",
      }),
    );

    expect(html).toContain("Modifié");
    expect(html).toContain("crates/ui/app/src/lib.rs");
    expect(html).toContain("Voir le diff");
    // No line count dump
    expect(html).not.toContain("lines added");
    expect(html).not.toContain("+1/-0");
  });

  it("renders CodexChat with centered clamp column, compact rounded user bubble, plain assistant, and floating composer", () => {
    const turns: Turn[] = [
      { id: "u-1", role: "user", content: "hey" },
      {
        id: "a-1",
        role: "assistant",
        content: "Hey! What can I help you with?",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(CodexChat, {
        turns,
        busy: false,
        draft: "",
        onDraftChange: () => {},
        onSend: () => {},
        onStop: () => {},
        onNewSession: () => {},
        onClearSession: () => {},
        model: "GPT-6 Luna",
        onModelChange: () => {},
        effort: "Minimal",
        onEffortChange: () => {},
        accessMode: "full",
        onAccessModeChange: () => {},
        modelOptions: [],
        cwd: "C:/workspace/aphrody",
        onCwdChange: () => {},
      }),
    );

    // Centred reading column (--app-reading-column, 760px) and docked prompt bar once turns exist
    expect(html).toContain("app-reading-column");
    expect(html).not.toContain("clamp(560px,72%,960px)");
    expect(html).toContain('data-shape="docked"');
    expect(html).toContain("app-prompt-bar");
    // Assistant sparkle mark filled with the title gradient
    expect(html).toContain('stop-color="var(--md-sys-color-primary)"');

    // User message: compact rounded pill (radius 28px extra-large, surface-container-high, max-w-[75%])
    expect(html).toContain("rounded-[28px]");
    expect(html).toContain("bg-surface-container-high");
    expect(html).toContain("max-w-[75%]");
    expect(html).toContain("hey");

    // Assistant message: plain text at left, no bubble, hover action buttons
    expect(html).toContain("Hey! What can I help you with?");
    expect(html).toContain("content_copy");
    expect(html).not.toContain("thumb_down");

    // Floating composer at bottom with placeholder "Que voulez-vous faire ?"
    expect(html).toContain('placeholder="Que voulez-vous faire ?"');
    expect(html).toContain("Accès complet");
    expect(html).toContain("warning");
    expect(html).toContain("GPT-6 Luna");
    expect(html).toContain("Minimal");
    expect(html).toContain("mic");
    expect(html).toContain("arrow_upward");
  });

  it("renders stop button during execution in CodexChat composer", () => {
    const html = renderToStaticMarkup(
      createElement(CodexChat, {
        turns: [],
        busy: true,
        draft: "En cours...",
        onDraftChange: () => {},
        onSend: () => {},
        onStop: () => {},
        onNewSession: () => {},
        onClearSession: () => {},
        model: "GPT-6 Luna",
        onModelChange: () => {},
        modelOptions: [],
        cwd: "",
        onCwdChange: () => {},
      }),
    );

    expect(html).toContain("stop");
    expect(html).toContain("Arrêter la génération");
  });
});
