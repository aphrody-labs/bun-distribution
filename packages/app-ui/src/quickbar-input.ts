// SPDX-License-Identifier: Apache-2.0
// Pure helpers of the quick ask bar: attachment model, app-server input, capture decoding.

export type Attachment =
  | { kind: "file"; path: string }
  | { kind: "image"; label: string; url: string };

/** Extract the first MCP image content block of a `tools/call` result as a data URL. */
export function imageDataUrl(result: unknown): string | null {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return null;
  for (const block of content as Array<{
    type?: string;
    data?: string;
    mimeType?: string;
  }>) {
    if (
      block?.type === "image" &&
      typeof block.data === "string" &&
      block.data.length > 0
    ) {
      return `data:${block.mimeType ?? "image/png"};base64,${block.data}`;
    }
  }
  return null;
}

/** Build the app-server `UserInput[]` (`text` / `image`) for one question and its attachments. */
export function buildInput(question: string, attachments: Attachment[]) {
  const files = attachments.flatMap((item) =>
    item.kind === "file" ? [item.path] : [],
  );
  const text =
    files.length > 0
      ? `${question}\n\nAttached files:\n${files.map((path) => `- ${path}`).join("\n")}`
      : question;
  return [
    { type: "text", text },
    ...attachments.flatMap((item) =>
      item.kind === "image" ? [{ type: "image", url: item.url }] : [],
    ),
  ];
}
