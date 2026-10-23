<!-- SPDX-License-Identifier: Apache-2.0 AND MIT -->

# @aphrody/m3-ai

Material Design 3 React components for agent interfaces (tool-call cards, markdown, chat bubbles and composer, model selector, task board) and a streaming client for OpenAI-compatible chat servers, rebuilt from SpaceUI's `@spacedrive/ai`.

```sh
bun add @aphrody/m3-ai @aphrody/m3-primitives @aphrody/m3-motion react react-dom tailwindcss
```

```tsx
import { useState } from "react";
import { ChatComposer, MessageBubble } from "@aphrody/m3-ai";

export function Chat() {
  const [draft, setDraft] = useState("");
  return (
    <>
      <MessageBubble content="Hello" isUser />
      <ChatComposer
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => setDraft("")}
      />
    </>
  );
}
```

License: Apache-2.0 AND MIT (`LICENSE`, `LICENSE.spaceui`). Install guide: [docs/material/m3/INSTALL.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/INSTALL.md).

Built on `@aphrody/m3-primitives`, the M3 colour roles, typescale, shapes and motion, and Material Symbols icons. Peers:
`react` and `react-dom` 18 or 19, `tailwindcss` 4.1+. `@aphrody/m3-ai/ag-ui` holds the AG-UI protocol bindings.

## CSS setup

The components ship Tailwind class names that use the M3 utilities of `@aphrody/m3-theme`. Import
the tokens, a palette sheet and the M3 utilities, then let Tailwind scan the package output. The
full recipe is in [SPACEUI-M3-FUSION.md](https://github.com/aphrody-labs/bun-distribution/blob/os/docs/material/m3/architecture/design/SPACEUI-M3-FUSION.md),
section "Integration":

```css
@import "tailwindcss";
@import "@aphrody/m3-tokens/m3-tokens.css";
@import "@aphrody/m3-theme/spaceui.css";
@import "@aphrody/m3-theme/tailwind.css";

@source "../node_modules/@aphrody/m3-primitives/dist";
@source "../node_modules/@aphrody/m3-ai/dist";
```

Load the Material Symbols font once: import `@aphrody/m3-fonts/fonts-symbols.css`, or call `ensureMaterialSymbols()` from
`@aphrody/material-web/icon/material-symbols.js`.

## Usage

```tsx
import { ChatComposer, MessageBubble, ToolCall } from "@aphrody/m3-ai";
import type { ToolCallPair } from "@aphrody/m3-ai";

const pair: ToolCallPair = {
  id: "1",
  name: "file_read",
  argsRaw: '{"path":"README.md"}',
  args: { path: "README.md" },
  resultRaw: '{"text":"# Aphrody"}',
  result: { text: "# Aphrody" },
  status: "completed",
};

export function Conversation({ draft, setDraft, send }: Props) {
  return (
    <>
      <MessageBubble content="List the files" isUser />
      <ToolCall pair={pair} />
      <MessageBubble content="There is one file: `README.md`." isUser={false} />
      <ChatComposer draft={draft} onDraftChange={setDraft} onSend={send} />
    </>
  );
}
```

## Components

| Component          | M3 anatomy                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ToolCall`         | Outlined card (`surface-container-low`, medium shape): status icon or circular indicator, `text-label-large` tool name, expandable arguments and result blocks in `font-code` on `surface-container-highest`, error results on `error-container`.                  |
| `Markdown`         | Prose on the M3 typescale (headline / title / body), `font-code` code blocks, `primary` links, `outline-variant` quotes and tables. `size` picks the body scale; `allowHtml` enables raw HTML for trusted content.                                                 |
| `MessageBubble`    | User turn as a `secondary-container` bubble (large shape), assistant turn as markdown on the surface with a standard copy icon button.                                                                                                                             |
| `ChatComposer`     | Search-bar anatomy: `surface-container-high`, extra-large shape, `text-body-large` input, project pill, model chip, standard mic icon button, filled send / stop icon button.                                                                                      |
| `ModelSelector`    | Pill trigger opening an M3 menu (`surface-container`, extra-small shape, level 2): search field, provider section headers, 48 dp items, selection on `secondary-container`, capability chips. `ModelOptionList` and `groupModelsByProvider` expose the list alone. |
| `InlineWorkerCard` | Filled card (`surface-container`, medium shape), `text-title-small` header, status chip, circular indicator while running, expandable transcript of `ToolCall`s and markdown.                                                                                      |
| `InlineBranchCard` | Filled card for a thinking branch: indicator or branch icon, status chip, expandable conclusion.                                                                                                                                                                   |
| `TaskStatusIcon`   | Material Symbol per status: done `success`, in progress and ready `primary`, pending approval `warning`, backlog `outline`.                                                                                                                                        |
| `TaskPriorityIcon` | Material Symbol per priority: critical `error`, high `warning`, medium `primary`, low `outline`.                                                                                                                                                                   |
| `TaskRow`          | Dense M3 list item (48 dp): `text-body-large` headline, `text-body-small` supporting columns, 8 % hover state layer, `secondary-container` selection, overflow menu.                                                                                               |
| `TaskList`         | Tasks grouped by status: collapsible `text-title-small` section headers, `outline-variant` dividers.                                                                                                                                                               |
| `TaskDetail`       | Task on an M3 surface: `text-headline-small` title, property grid, subtasks as a checkbox list, markdown description, filled and text buttons.                                                                                                                     |
| `TaskCreateForm`   | Title and description text fields, priority select, filled `Create` and text `Cancel` buttons.                                                                                                                                                                     |

Helpers from `types.ts`: `pairTranscriptSteps`, `tryParseJson`, `isErrorResult`,
`TASK_STATUS_ORDER`, `TASK_STATUS_LABEL`, `TASK_PRIORITY_LABEL`, and the transcript, task and
model types.

## Local chat

Everything a chat over an OpenAI-compatible server (llama-server, vLLM, the Aphrody gateway)
needs, with no visible string hard-coded:

| Export                                                                                                  | Role                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatLabels`, `chatLabelsFr` / `chatLabelsEn` / `chatLabelsJa`, `resolveChatLabels`, `formatLabel`      | One dictionary for every visible string and aria-label. Every chat component takes `labels?: Partial<ChatLabels>`; missing keys fall back on English.                                                                                                     |
| `streamChatCompletion`, `createSseParser`, `parseChatCompletionChunk`, `chatReducer`, `ChatStreamError` | Pure streaming client of `POST <baseUrl>/chat/completions` (`stream: true`): SSE framing, content / `reasoning_content` / tool-call deltas, `finish_reason`, top-level `citations` and `refusal`. Network failures and 404/502/503/504 are `unavailable`. |
| `useOpenAIChat({ baseUrl, model, fetch?, headers?, initialMessages?, preamble?, body? })`               | React hook: `{ messages, send, stop, status, error, reset, setMessages }`, `status` is `idle`, `streaming`, `error` or `unavailable`.                                                                                                                     |
| `ConversationList`                                                                                      | Navigation-drawer list: new conversation, optional search, rename / delete callbacks, empty state, localized dates.                                                                                                                                       |
| `ModelUnavailable`                                                                                      | Downloading / loading / unavailable state with a determinate linear indicator and a retry button.                                                                                                                                                         |
| `CitedMarkdown`, `CitationChip`, `CitationList`, `RefusalNotice`                                        | Grounded answers: `[n]` markers as chips, the numbered sources, the "not established in the sources" notice. `MessageBubble` takes `citations` and `refusal` directly.                                                                                    |
| `MemoryPanel`                                                                                           | Saved memories with per-item deletion and a confirmed "clear all" (`confirmClear` injects your own dialog).                                                                                                                                               |
| `ChatIcon`                                                                                              | The chat icons as inline Material Symbols SVG: no icon font is needed by the chat components.                                                                                                                                                             |

`Markdown` (and `MessageBubble`, `CitedMarkdown`) open external links with
`target="_blank" rel="noopener noreferrer"` and take `onLinkClick(href, event)` (call
`event.preventDefault()` to open the system browser from a Tauri webview) or `renderLink`.
`ChatComposer` takes `disabled` (the model is unavailable: input, send, voice and selectors are
inert), distinct from `isSending`.

## Tests

```sh
bun test
```

`test/preload.ts` resolves `@aphrody/m3-primitives` to its sources, so the tests do not need a
built `dist`.

## Credits

Derived from SpaceUI [`@spacedrive/ai`](https://github.com/spacedriveapp/spaceui) (MIT, see
`LICENSE.spaceui`), rebuilt on Material Design 3. New code is Apache-2.0.
