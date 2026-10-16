// SPDX-License-Identifier: Apache-2.0
/** One MCP content block. */
export type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: string; [key: string]: unknown };

/** Raw MCP `CallToolResult` as returned by `winclean_call`. */
export interface RawToolResult {
  content?: Content[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** Thrown by {@link ToolResult.ok} / {@link ToolResult.json} when a tool reports `isError`. */
export class ToolError extends Error {
  constructor(
    readonly tool: string,
    readonly result: ToolResult,
  ) {
    super(`${tool}: ${result.text}`);
    this.name = "ToolError";
  }
}

/** Result of a WinClean tool invocation. */
export class ToolResult {
  readonly content: Content[];
  readonly structuredContent: unknown;
  readonly isError: boolean;

  constructor(
    readonly tool: string,
    raw: RawToolResult,
  ) {
    this.content = raw.content ?? [];
    this.structuredContent = raw.structuredContent;
    this.isError = raw.isError === true;
  }

  /** Concatenated text blocks. */
  get text(): string {
    return this.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }

  /** Decoded image blocks (PNG frames from `computer_observe`, `window_capture`, …). */
  get images(): { mimeType: string; bytes: Uint8Array }[] {
    return this.content
      .filter((c): c is { type: "image"; data: string; mimeType: string } => c.type === "image")
      .map((c) => ({
        mimeType: c.mimeType,
        bytes: Uint8Array.from(Buffer.from(c.data, "base64")),
      }));
  }

  /** Throws {@link ToolError} when the tool failed; returns `this` otherwise. */
  ok(): this {
    if (this.isError) throw new ToolError(this.tool, this);
    return this;
  }

  /** `structuredContent`, or the first text block parsed as JSON. Throws on tool error. */
  json<T = any>(): T {
    this.ok();
    if (this.structuredContent !== undefined) return this.structuredContent as T;
    const first = this.content.find((c): c is { type: "text"; text: string } => c.type === "text");
    return JSON.parse(first?.text ?? "null") as T;
  }
}
