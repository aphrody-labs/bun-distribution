// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/ToolCall.tsx), MIT, rebuilt on Material Design 3.

import { useId, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@aphrody/m3-primitives";
import type { ToolCallPair, ToolCallStatus } from "./types";
import { CircularIndicator, StatusChip, expandMotion, focusRing } from "./internal";
import { McpAppCard } from "./McpAppCard";

// ---------------------------------------------------------------------------
// Tool-specific rendering
// ---------------------------------------------------------------------------

interface ToolRenderer {
  summary(pair: ToolCallPair): string | null;
  argsView?(pair: ToolCallPair): React.ReactNode | null;
  resultView?(pair: ToolCallPair): React.ReactNode | null;
}

/** The first present argument among `keys` (the tools name the same argument differently). */
function firstArg(pair: ToolCallPair, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = pair.args?.[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

const pathSummary =
  (pathKeys: readonly string[]): ToolRenderer["summary"] =>
  pair => {
    if (pair.title) return pair.title;
    const path = firstArg(pair, pathKeys);
    return path ? truncate(String(path), 60) : null;
  };

const fileResultView = (pair: ToolCallPair) =>
  pair.resultRaw ? <ResultLine text={truncate(pair.resultRaw, 100)} /> : null;

/** `file_read` and `read`: the path with its optional line window, output in a collapsible block. */
function fileRead(pathKeys: readonly string[]): ToolRenderer {
  return {
    summary: pathSummary(pathKeys),
    argsView(pair) {
      const path = firstArg(pair, pathKeys);
      if (!path) return null;
      const offset = pair.args?.offset;
      const limit = pair.args?.limit;
      return (
        <div className="rounded-small bg-surface-container-highest px-3 py-2">
          <p className="font-code text-body-small text-on-surface-variant">
            {String(path)}
            {offset ? ` (from line ${offset})` : ""}
            {limit ? ` (${limit} lines)` : ""}
          </p>
        </div>
      );
    },
    resultView(pair) {
      if (!pair.resultRaw) return null;
      return <CollapsiblePre text={pair.resultRaw} maxLines={30} />;
    },
  };
}

/** `file_write` and `write`: the path and a preview of the content. */
function fileWrite(pathKeys: readonly string[]): ToolRenderer {
  return {
    summary: pathSummary(pathKeys),
    argsView(pair) {
      const path = firstArg(pair, pathKeys);
      const content = pair.args?.content;
      if (!path && !content) return null;
      return (
        <div className="rounded-small bg-surface-container-highest px-3 py-2">
          {!!path && <p className="mb-1 font-code text-body-small text-on-surface-variant">{String(path)}</p>}
          {!!content && (
            <pre className="max-h-40 overflow-auto font-code text-body-small text-outline">
              {truncate(String(content), 2000)}
            </pre>
          )}
        </div>
      );
    },
    resultView: fileResultView,
  };
}

/** `file_edit` and `edit`: the path and the old / new text. */
function fileEdit(pathKeys: readonly string[], oldKeys: readonly string[], newKeys: readonly string[]): ToolRenderer {
  // Whole class names, so Tailwind's scanner finds them.
  const TONE = { error: "text-error", success: "text-success" } as const;
  const side = (label: string, tone: keyof typeof TONE, text: unknown) =>
    text ? (
      <div className="mt-1">
        <p className={`text-body-small font-medium ${TONE[tone]}`}>{label}</p>
        <pre className={`max-h-20 overflow-auto font-code text-body-small ${TONE[tone]}`}>
          {truncate(String(text), 500)}
        </pre>
      </div>
    ) : null;
  return {
    summary: pathSummary(pathKeys),
    argsView(pair) {
      const path = firstArg(pair, pathKeys);
      if (!path) return null;
      return (
        <div className="rounded-small bg-surface-container-highest px-3 py-2">
          <p className="mb-1 font-code text-body-small text-on-surface-variant">{String(path)}</p>
          {side("Old", "error", firstArg(pair, oldKeys))}
          {side("New", "success", firstArg(pair, newKeys))}
        </div>
      );
    },
    resultView: fileResultView,
  };
}

const toolRenderers: Record<string, ToolRenderer> = {
  file_read: fileRead(["path"]),
  file_write: fileWrite(["path"]),
  file_edit: fileEdit(["path"], ["old_string"], ["new_string"]),

  file_list: {
    summary: pathSummary(["path"]),
    resultView(pair) {
      if (!pair.resultRaw) return null;
      return <CollapsiblePre text={pair.resultRaw} maxLines={30} />;
    },
  },

  set_status: {
    summary(pair) {
      const kind = pair.args?.kind;
      const message = pair.args?.message;
      if (kind === "outcome") {
        return message ? `Outcome: ${truncate(String(message), 50)}` : "Outcome set";
      }
      return message ? truncate(String(message), 60) : null;
    },
    resultView() {
      return null;
    },
  },

  // OpenCode tools

  read: fileRead(["filePath", "file_path"]),
  write: fileWrite(["filePath", "file_path"]),
  edit: fileEdit(["filePath", "file_path"], ["oldString", "old_string"], ["newString", "new_string"]),

  glob: {
    summary(pair) {
      if (pair.title) return pair.title;
      const pattern = pair.args?.pattern;
      return pattern ? truncate(String(pattern), 60) : null;
    },
    resultView(pair) {
      if (!pair.resultRaw) return null;
      return <CollapsiblePre text={pair.resultRaw} maxLines={20} />;
    },
  },

  grep: {
    summary(pair) {
      if (pair.title) return pair.title;
      const pattern = pair.args?.pattern;
      const include = pair.args?.include;
      if (pattern && include) {
        return `/${pattern}/ in ${include}`;
      }
      return pattern ? `/${truncate(String(pattern), 40)}/` : null;
    },
    resultView(pair) {
      if (!pair.resultRaw) return null;
      return <CollapsiblePre text={pair.resultRaw} maxLines={20} />;
    },
  },

  webfetch: {
    summary(pair) {
      if (pair.title) return pair.title;
      const url = pair.args?.url;
      return url ? truncate(String(url), 60) : null;
    },
    resultView(pair) {
      if (!pair.resultRaw) return null;
      return <CollapsiblePre text={pair.resultRaw} maxLines={20} />;
    },
  },

  read_skill: {
    summary(pair) {
      if (pair.title) return pair.title;
      const name = pair.args?.name;
      return name ? String(name) : null;
    },
    resultView(pair) {
      if (!pair.resultRaw) return null;
      return <CollapsiblePre text={pair.resultRaw} maxLines={30} />;
    },
  },

  web_search: {
    summary(pair) {
      if (pair.title) return pair.title;
      const query = pair.args?.query;
      const resultCount =
        pair.result?.result_count ??
        (Array.isArray(pair.result?.results) ? (pair.result!.results as unknown[]).length : null);
      const queryStr = query ? truncate(String(query), 50) : null;
      if (queryStr && resultCount != null) {
        return `${queryStr} (${resultCount} result${resultCount !== 1 ? "s" : ""})`;
      }
      return queryStr;
    },
    argsView(pair) {
      const query = pair.args?.query;
      if (!query) return null;
      const count = pair.args?.count;
      const freshness = pair.args?.freshness;
      return (
        <div className="rounded-small bg-surface-container-highest px-3 py-2">
          <p className="text-body-small text-on-surface-variant">
            <span className="select-none text-outline">Search: </span>
            {String(query)}
          </p>
          {!!(count || freshness) && (
            <p className="mt-0.5 text-body-small text-outline">
              {count ? `${count} results` : ""}
              {count && freshness ? " · " : ""}
              {freshness ? `${freshness}` : ""}
            </p>
          )}
        </div>
      );
    },
    resultView(pair) {
      if (!pair.resultRaw) return null;
      return <CollapsiblePre text={pair.resultRaw} maxLines={20} />;
    },
  },

  spacebot_docs: {
    summary(pair) {
      if (pair.title) return pair.title;
      const action = pair.args?.action;
      const docId = pair.args?.doc_id;
      if (action === "read" && docId) {
        return truncate(String(docId), 50);
      }
      return action ? String(action) : "list";
    },
    argsView(pair) {
      const action = pair.args?.action;
      const docId = pair.args?.doc_id;
      const query = pair.args?.query;
      if (!action && !docId) return null;
      return (
        <div className="rounded-small bg-surface-container-highest px-3 py-2">
          {!!docId && <p className="font-code text-body-small text-on-surface-variant">{String(docId)}</p>}
          {!!query && <p className="mt-0.5 text-body-small text-outline">filter: {String(query)}</p>}
        </div>
      );
    },
    resultView(pair) {
      if (!pair.resultRaw) return null;
      return <CollapsiblePre text={pair.resultRaw} maxLines={30} />;
    },
  },

  todowrite: {
    summary(pair) {
      if (pair.title) return pair.title;
      return "Update tasks";
    },
    resultView() {
      return null;
    },
  },

  task: {
    summary(pair) {
      if (pair.title) return pair.title;
      const description = pair.args?.description;
      return description ? truncate(String(description), 60) : null;
    },
    resultView(pair) {
      if (!pair.resultRaw) return null;
      return <CollapsiblePre text={pair.resultRaw} maxLines={20} />;
    },
  },
};

const defaultRenderer: ToolRenderer = {
  summary(pair) {
    if (!pair.argsRaw || pair.argsRaw === "{}") return null;
    return truncate(pair.argsRaw, 60);
  },
};

function getRenderer(name: string): ToolRenderer {
  return toolRenderers[name] ?? defaultRenderer;
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function ResultLine({ text }: { text: string }) {
  return <p className="px-3 py-2 text-body-small text-on-surface-variant">{text}</p>;
}

function CollapsiblePre({ text, maxLines = 20 }: { text: string; maxLines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const needsCollapse = lines.length > maxLines;
  const displayText = needsCollapse && !expanded ? lines.slice(0, maxLines).join("\n") + "\n..." : text;

  return (
    <div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-3 py-2 font-code text-body-small text-on-surface-variant">
        {displayText}
      </pre>
      {needsCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={clsx(
            "flex h-8 w-full items-center justify-center gap-1 border-t border-outline-variant px-3 text-label-medium text-primary",
            "transition-colors duration-200 ease-standard hover:bg-primary/8 active:bg-primary/10",
            focusRing,
          )}
        >
          <Icon
            name="expand_more"
            size={18}
            className={clsx("transition-transform duration-200 ease-standard", expanded && "rotate-180")}
          />
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status display helpers
// ---------------------------------------------------------------------------

/** Material Symbols glyph per status (the running state shows a circular indicator). */
const STATUS_ICONS: Record<ToolCallStatus, string> = {
  running: "pending",
  completed: "check_circle",
  error: "error",
};

const STATUS_COLORS: Record<ToolCallStatus, string> = {
  running: "text-primary",
  completed: "text-success",
  error: "text-error",
};

const STATUS_LABELS: Record<ToolCallStatus, string> = {
  running: "Running",
  completed: "Completed",
  error: "Error",
};

/** Leading Material Symbol per tool family. */
function toolIcon(name: string): string {
  if (name.startsWith("file_") || name === "read" || name === "write" || name === "edit") {
    return "description";
  }
  if (name === "glob" || name === "grep" || name === "web_search") return "search";
  if (name === "webfetch") return "language";
  if (name === "set_status") return "schedule";
  return "build";
}

function formatToolName(name: string): string {
  const overrides: Record<string, string> = {
    webfetch: "Web Fetch",
    todowrite: "Todo",
    read_skill: "Read Skill",
    web_search: "Web Search",
    spacebot_docs: "Docs",
  };
  if (overrides[name]) return overrides[name];

  const stripped = name.replace(/^file_/, "");

  return stripped
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toolCategory(name: string): string | null {
  if (name.startsWith("file_")) return "File";
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface ToolCallProps {
  pair: ToolCallPair;
  /** Start expanded (uncontrolled). */
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * A tool invocation as an M3 outlined card: status + tool name header (`text-label-large`),
 * summary, and an expandable body with arguments and result blocks in `font-code`.
 */
export function ToolCall({ pair, defaultExpanded = false, className }: ToolCallProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyId = useId();
  const renderer = getRenderer(pair.name);
  const summary = renderer.summary(pair);
  const category = toolCategory(pair.name);
  const displayName = formatToolName(pair.name);
  const isError = pair.status === "error";

  const args = expanded ? renderArgs(pair, renderer) : null;
  const result = expanded ? renderResult(pair, renderer) : null;

  return (
    <div
      data-status={pair.status}
      className={clsx(
        "m3-tool-call min-w-0 overflow-hidden rounded-medium border bg-surface-container-low text-on-surface",
        isError ? "border-error" : "border-outline-variant",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className={clsx(
          "flex min-h-10 w-full items-center gap-2 rounded-medium px-3 py-2 text-left",
          "transition-colors duration-200 ease-standard hover:bg-on-surface/8 active:bg-on-surface/10",
          focusRing,
        )}
      >
        <span className={clsx("flex size-5 shrink-0 items-center justify-center", STATUS_COLORS[pair.status])}>
          {pair.status === "running" ? (
            <CircularIndicator size={16} label="Running" />
          ) : (
            <Icon name={STATUS_ICONS[pair.status]} size={18} filled label={STATUS_LABELS[pair.status]} />
          )}
        </span>
        <Icon name={toolIcon(pair.name)} size={18} className="shrink-0 text-on-surface-variant" />
        {category && <span className="text-label-medium text-outline">{category}</span>}
        <span className="shrink-0 text-label-large text-on-surface">{displayName}</span>
        {summary && !expanded ? (
          <span className="min-w-0 flex-1 truncate text-body-small text-on-surface-variant">{summary}</span>
        ) : (
          <span className="flex-1" />
        )}
        {isError && (
          <StatusChip tone="error" className="h-5 px-1.5 text-label-small">
            error
          </StatusChip>
        )}
        <Icon
          name="expand_more"
          size={20}
          className={clsx(
            "shrink-0 text-on-surface-variant transition-transform duration-300 ease-emphasized",
            expanded && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div id={bodyId} key="body" {...expandMotion} className="overflow-hidden">
            <div className="flex flex-col gap-2 border-t border-outline-variant px-3 py-3">
              {args}
              {result != null && result !== false ? (
                <div
                  className={clsx(
                    "m3-tool-result overflow-hidden rounded-small",
                    isError
                      ? "bg-error-container text-on-error-container [&_.text-on-surface-variant]:text-on-error-container [&_.text-outline]:text-on-error-container/80"
                      : "bg-surface-container-highest text-on-surface-variant",
                  )}
                >
                  {result}
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function renderArgs(pair: ToolCallPair, renderer: ToolRenderer): React.ReactNode {
  if (renderer.argsView) {
    const custom = renderer.argsView(pair);
    if (custom) return custom;
  }

  if (pair.args && Object.keys(pair.args).length > 0) {
    return (
      <div className="rounded-small bg-surface-container-highest px-3 py-2">
        <div className="flex flex-col gap-0.5">
          {Object.entries(pair.args).map(([key, value]) => (
            <p key={key} className="font-code text-body-small">
              <span className="text-outline">{key}: </span>
              <span className="text-on-surface-variant">{formatArgValue(key, value)}</span>
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (pair.argsRaw && pair.argsRaw !== "{}" && pair.argsRaw.trim().length > 0) {
    return (
      <div className="rounded-small bg-surface-container-highest px-3 py-2">
        <pre className="max-h-40 overflow-auto font-code text-body-small text-on-surface-variant">{pair.argsRaw}</pre>
      </div>
    );
  }

  return null;
}

function renderResult(pair: ToolCallPair, renderer: ToolRenderer): React.ReactNode {
  if (pair.status === "running") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-body-small text-on-surface-variant">
        <CircularIndicator size={14} label="Running" />
        Running...
      </div>
    );
  }

  if (renderer.resultView) {
    const custom = renderer.resultView(pair);
    if (custom !== undefined) return custom;
  }

  if (!pair.resultRaw) return null;

  // Check if result contains an interactive MCP-UI resource or app
  const mcpResourceUri = (pair.result?._meta as any)?.ui?.resourceUri || (pair.result?.ui as any)?.resourceUri;
  const mcpHtml = (pair.result as any)?.html || (pair.result as any)?.uiHtml;
  if (mcpResourceUri || mcpHtml) {
    return (
      <div className="p-1">
        <McpAppCard
          toolName={pair.name}
          title={pair.title || pair.name}
          html={typeof mcpHtml === "string" ? mcpHtml : undefined}
          toolResourceUri={typeof mcpResourceUri === "string" ? mcpResourceUri : undefined}
          toolInput={pair.args || undefined}
          toolResult={pair.result || undefined}
        />
      </div>
    );
  }

  if (pair.result && Object.keys(pair.result).length > 0) {
    return (
      <div className="px-3 py-2">
        <div className="flex flex-col gap-0.5">
          {Object.entries(pair.result).map(([key, value]) => (
            <p key={key} className="font-code text-body-small">
              <span className="text-outline">{key}: </span>
              <span className="text-on-surface-variant">
                {typeof value === "string" ? truncate(value, 200) : JSON.stringify(value)}
              </span>
            </p>
          ))}
        </div>
      </div>
    );
  }

  return <CollapsiblePre text={pair.resultRaw} maxLines={20} />;
}

function formatArgValue(key: string, value: unknown): string {
  if (key === "secret" && typeof value === "string") {
    return "***";
  }
  if (typeof value === "string") {
    return truncate(value, 100);
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
