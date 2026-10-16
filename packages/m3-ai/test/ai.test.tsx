// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatComposer } from "../src/ChatComposer";
import { InlineBranchCard } from "../src/InlineBranchCard";
import { InlineWorkerCard } from "../src/InlineWorkerCard";
import {
  BlockMath,
  CodeBlock,
  InlineMath,
  Markdown,
  detectLanguage,
} from "../src/Markdown";
import { MessageBubble } from "../src/MessageBubble";
import {
  ModelOptionList,
  ModelSelector,
  groupModelsByProvider,
} from "../src/ModelSelector";
import { TaskCreateForm } from "../src/TaskCreateForm";
import { TaskDetail } from "../src/TaskDetail";
import { TaskList } from "../src/TaskList";
import { TaskPriorityIcon } from "../src/TaskPriorityIcon";
import { TaskRow } from "../src/TaskRow";
import { TaskStatusIcon } from "../src/TaskStatusIcon";
import { ToolCall } from "../src/ToolCall";
import {
  type ModelOption,
  type Task,
  type ToolCallPair,
  type TranscriptStep,
  isErrorResult,
  pairTranscriptSteps,
  tryParseJson,
} from "../src/types";

const SPACEUI_VOCABULARY = /\b(bg|text|border)-(app|ink|sidebar|menu|accent)\b/;

function render(element: ReactElement): string {
  const html = renderToStaticMarkup(element);
  expect(html).not.toMatch(SPACEUI_VOCABULARY);
  expect(html).not.toContain("text-white");
  expect(html).not.toContain("brightness-");
  return html;
}

const noop = () => {};

const fileReadPair: ToolCallPair = {
  id: "call_1",
  name: "file_read",
  argsRaw: '{"path":"README.md"}',
  args: { path: "README.md" },
  resultRaw: '{"text":"# Aphrody"}',
  result: { text: "# Aphrody" },
  status: "completed",
};

const errorPair: ToolCallPair = {
  id: "call_2",
  name: "file_read",
  argsRaw: '{"path":"/missing.txt"}',
  args: { path: "/missing.txt" },
  resultRaw: "Error: file not found",
  result: null,
  status: "error",
};

const runningPair: ToolCallPair = {
  id: "call_3",
  name: "custom_operation",
  argsRaw: '{"query":"example"}',
  args: { query: "example" },
  resultRaw: null,
  result: null,
  status: "running",
};

const models: ModelOption[] = [
  {
    id: "claude-opus",
    name: "Claude Opus",
    provider: "Anthropic",
    context_window: 200000,
    capabilities: ["vision", "tools"],
  },
  {
    id: "gemini-pro",
    name: "Gemini Pro",
    provider: "Google",
    context_window: 1000000,
  },
  { id: "gemini-flash", name: "Gemini Flash", provider: "Google" },
];

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    task_number: 42,
    title: "Port the tool call card to M3",
    description: "Use **M3** roles.\n\n- one\n- two",
    status: "in_progress",
    priority: "high",
    owner_agent_id: "agent-owner",
    assigned_agent_id: "agent-worker",
    subtasks: [
      { title: "Header", completed: true },
      { title: "Body", completed: false },
    ],
    metadata: null,
    created_by: "user",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-02T10:00:00Z",
    ...overrides,
  };
}

describe("types helpers", () => {
  test("tryParseJson accepts objects only", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseJson("[1,2]")).toBeNull();
    expect(tryParseJson("42")).toBeNull();
    expect(tryParseJson("not json")).toBeNull();
    expect(tryParseJson("   ")).toBeNull();
  });

  test("isErrorResult detects structured and textual errors", () => {
    expect(isErrorResult("", { error: "boom" })).toBe(true);
    expect(isErrorResult("", { status: "error" })).toBe(true);
    expect(isErrorResult("", { success: false })).toBe(true);
    expect(isErrorResult("Error: nope", null)).toBe(true);
    expect(isErrorResult("Failed: nope", null)).toBe(true);
    expect(isErrorResult("Toolset error: nope", null)).toBe(true);
    expect(isErrorResult("all good", null)).toBe(false);
  });

  test("pairTranscriptSteps pairs calls with results by id", () => {
    const steps: TranscriptStep[] = [
      { type: "user_text", text: "ignored" },
      {
        type: "action",
        content: [
          { type: "text", text: "Listing files" },
          {
            type: "tool_call",
            id: "a",
            name: "file_read",
            args: '{"path":"README.md"}',
          },
          {
            type: "tool_call",
            id: "b",
            name: "file_read",
            args: '{"path":"x"}',
          },
          { type: "tool_call", id: "c", name: "grep", args: "{}" },
        ],
      },
      {
        type: "tool_result",
        call_id: "a",
        name: "file_read",
        text: '{"text":"x"}',
      },
      {
        type: "tool_result",
        call_id: "b",
        name: "file_read",
        text: "Error: missing",
      },
    ];
    const items = pairTranscriptSteps(steps);
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({ kind: "text", text: "Listing files" });
    const [, a, b, c] = items;
    if (a.kind !== "tool" || b.kind !== "tool" || c.kind !== "tool")
      throw new Error("expected tools");
    expect(a.pair.status).toBe("completed");
    expect(a.pair.args).toEqual({ path: "README.md" });
    expect(a.pair.result).toEqual({ text: "x" });
    expect(b.pair.status).toBe("error");
    expect(b.pair.resultRaw).toBe("Error: missing");
    expect(c.pair.status).toBe("running");
    expect(c.pair.resultRaw).toBeNull();
  });
});

describe("ToolCall", () => {
  test("collapsed card uses the M3 outlined card anatomy", () => {
    const html = render(<ToolCall pair={fileReadPair} />);
    expect(html).toContain("rounded-medium");
    expect(html).toContain("bg-surface-container-low");
    expect(html).toContain("border-outline-variant");
    expect(html).toContain("text-label-large");
    expect(html).toContain(">File</span>");
    expect(html).toContain(">Read</span>");
    expect(html).toContain("text-success");
    expect(html).toContain("check_circle");
    expect(html).toContain("expand_more");
    expect(html).toContain('aria-expanded="false"');
  });

  test("expanded card shows args and result in font-code blocks", () => {
    const html = render(<ToolCall pair={fileReadPair} defaultExpanded />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("font-code");
    expect(html).toContain("bg-surface-container-highest");
    expect(html).toContain("rounded-small");
    expect(html).toContain("README.md");
    expect(html).toContain("# Aphrody");
  });

  test("error status uses the error roles", () => {
    const html = render(<ToolCall pair={errorPair} defaultExpanded />);
    expect(html).toContain("border-error");
    expect(html).toContain("bg-error-container");
    expect(html).toContain("text-on-error-container");
    expect(html).toContain("Error: file not found");
  });

  test("running status shows a primary circular indicator", () => {
    const html = render(<ToolCall pair={runningPair} defaultExpanded />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("text-primary");
    expect(html).toContain("Running...");
  });
});

describe("Markdown", () => {
  const md = [
    "# Title",
    "## Section",
    "### Sub",
    "Some `inline` code and a [link](https://example.com).",
    "",
    "> quoted",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
  ].join("\n");

  test("maps elements onto the M3 typescale and roles", () => {
    const html = render(<Markdown content={md} />);
    expect(html).toMatch(/<h1 class="[^"]*text-headline-small/);
    expect(html).toMatch(/<h2 class="[^"]*text-title-large/);
    expect(html).toMatch(/<h3 class="[^"]*text-title-medium/);
    expect(html).toMatch(/<p class="[^"]*text-body-medium/);
    expect(html).toMatch(/<a class="[^"]*text-primary underline/);
    expect(html).toMatch(
      /<blockquote class="[^"]*border-l-4 border-outline-variant/,
    );
    expect(html).toMatch(
      /<pre class="[^"]*font-code[^"]*bg-surface-container-highest|<pre class="[^"]*bg-surface-container-highest[^"]*font-code/,
    );
    expect(html).toContain("<table");
    expect(html).toMatch(/<th class="[^"]*border-outline-variant/);
    expect(html).toContain("const x = 1;");
  });

  test("size prop switches the body typescale", () => {
    const html = render(<Markdown content="hello" size="large" />);
    expect(html).toMatch(/<p class="[^"]*text-body-large/);
  });

  test("raw HTML is escaped unless allowHtml", () => {
    expect(
      render(<Markdown content={'<span class="x">raw</span>'} />),
    ).not.toContain('<span class="x">');
    expect(
      render(<Markdown content={'<span class="x">raw</span>'} allowHtml />),
    ).toContain('<span class="x">');
  });
});

describe("CodeBlock", () => {
  test("detects languages and shows language badge", () => {
    expect(detectLanguage("language-typescript").label).toBe("TypeScript");
    expect(detectLanguage("python").label).toBe("Python");
    expect(detectLanguage("rust").label).toBe("Rust");
    expect(detectLanguage("bash").label).toBe("Bash");
    expect(detectLanguage("json").label).toBe("JSON");
    expect(detectLanguage("sql").label).toBe("SQL");
    expect(detectLanguage("").label).toBe("Code");

    const html = render(
      <CodeBlock code="const x = 1;" language="typescript" />,
    );
    expect(html).toContain("TypeScript");
    expect(html).toContain("content_copy");
    expect(html).toContain("Copy");
    expect(html).toContain("const x = 1;");
  });

  test("renders in markdown with language header and copy button", () => {
    const md = "```python\ndef greet():\n    return 'hello'\n```";
    const html = render(<Markdown content={md} />);
    expect(html).toContain("Python");
    expect(html).toContain("content_copy");
    expect(html).toContain("Copy");
    expect(html).toContain("def greet():");
    expect(html).toContain("border-outline-variant");
    expect(html).toContain("bg-surface-container");
    expect(html).toContain("bg-surface-container-highest");
  });

  test("interactive copy switches to Copied! with check icon", async () => {
    let copiedText = "";
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          copiedText = text;
        },
      },
      configurable: true,
      writable: true,
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    flushSync(() => {
      root.render(
        <CodeBlock code={"npm install @aphrody/m3-ai\n"} language="bash" />,
      );
    });

    expect(host.textContent).toContain("Bash");
    expect(host.textContent).toContain("Copy");
    expect(host.querySelector('[aria-label="Copy code"]')).not.toBeNull();

    const copyBtn = host.querySelector("button")!;
    flushSync(() => {
      copyBtn.click();
    });
    await new Promise((r) => setTimeout(r, 10));
    flushSync(() => {});

    expect(copiedText).toBe("npm install @aphrody/m3-ai");
    expect(host.textContent).toContain("Copied!");
    expect(host.innerHTML).toContain("check");
    expect(host.innerHTML).toContain("text-success");

    // Wait for timeout to reset back
    await new Promise((r) => setTimeout(r, 2100));
    flushSync(() => {});
    expect(host.textContent).toContain("Copy");
    expect(host.innerHTML).toContain("content_copy");

    flushSync(() => root.unmount());
    host.remove();
  });
});

describe("Math formula styling", () => {
  test("renders inline $...$ formulas with semantic typography", () => {
    const html = render(<Markdown content="Energy: $E = mc^2$." />);
    expect(html).toContain("font-serif italic font-medium text-primary");
    expect(html).toContain("<sup");
    expect(html).toContain(">2</sup>");
    expect(html).toContain("E = mc");
  });

  test("formats Greek letters into Unicode glyphs", () => {
    const md =
      "Greek: $\\alpha, \\beta, \\gamma, \\pi, \\sigma, \\theta, \\lambda, \\Delta$";
    const html = render(<Markdown content={md} />);
    expect(html).toContain("font-serif italic font-medium text-primary");
    expect(html).toContain("α, β, γ, π, σ, θ, λ, Δ");
  });

  test("formats common mathematical operators", () => {
    const md =
      "Operators: $a \\times b \\div c \\pm d \\le e \\ge f \\approx g \\neq h \\le \\infty$";
    const html = render(<Markdown content={md} />);
    expect(html).toContain("×");
    expect(html).toContain("÷");
    expect(html).toContain("±");
    expect(html).toContain("≤");
    expect(html).toContain("≥");
    expect(html).toContain("≈");
    expect(html).toContain("≠");
    expect(html).toContain("∞");
  });

  test("formats superscripts and subscripts semantically", () => {
    const md = "Powers & indices: $x_1^2 + x_2^2 \\le z^2$ and $x_{i+1}$";
    const html = render(<Markdown content={md} />);
    expect(html).toContain("<sub");
    expect(html).toContain(">1</sub>");
    expect(html).toContain("<sup");
    expect(html).toContain(">2</sup>");
    expect(html).toContain(">i+1</sub>");
  });

  test("renders block $$...$$ formulas with centered block styling", () => {
    const md = [
      "Here is the quadratic discriminant:",
      "$$",
      "\\Delta = b^2 - 4 \\times a \\times c",
      "$$",
      "Following text.",
    ].join("\n");
    const html = render(<Markdown content={md} />);
    expect(html).toContain("font-serif italic font-medium text-primary");
    expect(html).toContain("justify-center");
    expect(html).toContain("Δ = b");
    expect(html).toContain("<sup");
    expect(html).toContain(">2</sup>");
    expect(html).toContain("4 × a × c");
    expect(html).toContain("Here is the quadratic discriminant:");
    expect(html).toContain("Following text.");
  });

  test("does not convert regular currency into math", () => {
    const html = render(<Markdown content="It costs $10 and $20 for two." />);
    expect(html).not.toContain("font-serif italic font-medium text-primary");
    expect(html).toContain("$10 and $20");
  });

  test("standalone InlineMath and BlockMath components", () => {
    const inlineHtml = render(<InlineMath math="\\alpha + \\beta" />);
    expect(inlineHtml).toContain("font-serif italic font-medium text-primary");
    expect(inlineHtml).toContain("α + β");

    const blockHtml = render(<BlockMath math="\\Delta = 0" />);
    expect(blockHtml).toContain("font-serif italic font-medium text-primary");
    expect(blockHtml).toContain("justify-center");
    expect(blockHtml).toContain("Δ = 0");
  });
});

describe("MessageBubble", () => {
  test("user bubble is a secondary-container bubble", () => {
    const html = render(<MessageBubble content="Hi there" isUser />);
    expect(html).toContain("bg-secondary-container");
    expect(html).toContain("text-on-secondary-container");
    expect(html).toContain("rounded-large");
    expect(html).toContain("Hi there");
  });

  test("assistant turn is markdown on the surface with a copy action", () => {
    const html = render(
      <MessageBubble content="**Bold** reply" isUser={false} onCopy={noop} />,
    );
    expect(html).toContain("text-on-surface");
    expect(html).toContain("<strong");
    expect(html).toContain("content_copy");
    expect(html).toContain('aria-label="Copy Message"');
  });
});

describe("ChatComposer", () => {
  test("renders the M3 search-bar composer with send button", () => {
    const html = render(
      <ChatComposer
        draft="Hello"
        onDraftChange={noop}
        onSend={noop}
        heading="Ask Aphrody"
        onOpenVoice={noop}
        modelSelector={{
          value: "claude-opus",
          options: models,
          onChange: noop,
        }}
      />,
    );
    expect(html).toContain("bg-surface-container-high");
    expect(html).toContain("rounded-extra-large");
    expect(html).toContain("text-body-large");
    expect(html).toContain("auto_awesome");
    expect(html).toContain("mic");
    expect(html).toContain('aria-label="Send"');
    expect(html).toContain("arrow_upward");
    expect(html).toContain("bg-primary");
    expect(html).toContain("text-on-primary");
    expect(html).toContain("Claude Opus");
  });

  test("shows stop while sending when onStop is given", () => {
    const html = render(
      <ChatComposer
        draft="Hello"
        onDraftChange={noop}
        onSend={noop}
        isSending
        onStop={noop}
      />,
    );
    expect(html).toContain('aria-label="Stop"');
    expect(html).not.toContain('aria-label="Send"');
  });

  test("hides send on an empty draft", () => {
    const html = render(
      <ChatComposer draft="  " onDraftChange={noop} onSend={noop} />,
    );
    expect(html).not.toContain('aria-label="Send"');
  });
});

describe("ModelSelector", () => {
  test("trigger shows the selected model", () => {
    const html = render(
      <ModelSelector models={models} value="gemini-pro" onChange={noop} />,
    );
    expect(html).toContain("Gemini Pro");
    expect(html).toContain("expand_more");
  });

  test("groupModelsByProvider groups and filters", () => {
    const grouped = groupModelsByProvider(models);
    expect(Object.keys(grouped)).toEqual(["Anthropic", "Google"]);
    expect(grouped.Google).toHaveLength(2);
    expect(Object.keys(groupModelsByProvider(models, "flash"))).toEqual([
      "Google",
    ]);
    expect(groupModelsByProvider(models, "anthropic").Anthropic).toHaveLength(
      1,
    );
  });

  test("option list is an M3 menu list", () => {
    const html = render(
      <ModelOptionList
        grouped={groupModelsByProvider(models)}
        value="claude-opus"
        onSelect={noop}
      />,
    );
    expect(html).toContain("text-title-small");
    expect(html).toContain("text-label-large");
    expect(html).toContain("bg-secondary-container");
    expect(html).toContain('aria-selected="true"');
    expect(html).toMatch(/200\D000 tokens/);
    expect(html).toMatch(
      /rounded-small border border-outline-variant[^"]*text-label-small/,
    );
    expect(html).toContain("vision");
  });

  test("empty option list says so", () => {
    expect(
      render(<ModelOptionList grouped={{}} value="" onSelect={noop} />),
    ).toContain("No models found");
  });
});

describe("Inline cards", () => {
  const transcript: TranscriptStep[] = [
    {
      type: "action",
      content: [
        { type: "text", text: "Reading   the file" },
        {
          type: "tool_call",
          id: "x",
          name: "file_read",
          args: '{"path":"/home/README.md"}',
        },
      ],
    },
    {
      type: "tool_result",
      call_id: "x",
      name: "file_read",
      text: '{"text":"Welcome"}',
    },
  ];

  test("running worker card is an M3 filled card with an indicator", () => {
    const html = render(
      <InlineWorkerCard
        title="Index the repo"
        status="running"
        toolCallCount={3}
        liveStatus="reading files"
        transcript={transcript}
        onCancel={noop}
        onCopyLogs={noop}
      />,
    );
    expect(html).toContain("bg-surface-container");
    expect(html).toContain("rounded-medium");
    expect(html).toContain("text-title-small");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("3 tool calls");
    expect(html).toContain("Cancel");
  });

  test("expanded worker card renders the transcript", () => {
    const html = render(
      <InlineWorkerCard
        title="Done"
        status="completed"
        toolCallCount={1}
        transcript={transcript}
        defaultExpanded
      />,
    );
    expect(html).toContain("bg-success-container");
    expect(html).toContain("text-body-small");
    expect(html).toContain("Reading  the file");
    expect(html).toContain(">File</span>");
    expect(html).toContain(">Read</span>");
  });

  test("branch card: thinking then done with conclusion", () => {
    const running = render(
      <InlineBranchCard description="Compare options" completedAt={null} />,
    );
    expect(running).toContain('role="progressbar"');
    expect(running).toContain("thinking");
    expect(running).toContain("bg-primary-container");

    const done = render(
      <InlineBranchCard
        description="Compare options"
        completedAt="2026-09-01T00:00:00Z"
        conclusion="Pick **A**."
        defaultExpanded
      />,
    );
    expect(done).toContain("bg-success-container");
    expect(done).toContain("alt_route");
    expect(done).toContain("<strong");
  });
});

describe("Task components", () => {
  test("status and priority icons use Material Symbols and M3 roles", () => {
    const done = render(<TaskStatusIcon status="done" />);
    expect(done).toContain("check_circle");
    expect(done).toContain("text-success");
    expect(render(<TaskStatusIcon status="in_progress" />)).toContain(
      "text-primary",
    );
    expect(render(<TaskStatusIcon status="backlog" />)).toContain(
      "text-outline",
    );
    expect(render(<TaskStatusIcon status="pending_approval" />)).toContain(
      "text-warning",
    );

    expect(render(<TaskPriorityIcon priority="critical" />)).toContain(
      "text-error",
    );
    expect(render(<TaskPriorityIcon priority="high" />)).toContain(
      "text-warning",
    );
    expect(render(<TaskPriorityIcon priority="medium" />)).toContain(
      "text-primary",
    );
    expect(render(<TaskPriorityIcon priority="low" />)).toContain(
      "text-outline",
    );
  });

  test("task row is an M3 list item", () => {
    const html = render(
      <TaskRow
        task={makeTask()}
        onClick={noop}
        onDelete={noop}
        resolveAgentName={(id) => id.toUpperCase()}
      />,
    );
    expect(html).toContain("text-body-large");
    expect(html).toContain("text-body-small");
    expect(html).toContain("text-on-surface-variant");
    expect(html).toContain("hover:bg-on-surface/8");
    expect(html).toContain("border-outline-variant");
    expect(html).toContain("SPC-42");
    expect(html).toContain("AGENT-WORKER");
    expect(html).toContain("1/2");
    expect(html).toContain("more_vert");
  });

  test("active task row uses the secondary container", () => {
    const html = render(<TaskRow task={makeTask()} isActive />);
    expect(html).toContain("bg-secondary-container");
    expect(html).toContain('aria-current="true"');
  });

  test("task list groups by status with title-small section headers", () => {
    const tasks = [
      makeTask(),
      makeTask({
        id: "t2",
        task_number: 43,
        title: "Ship it",
        status: "done",
        priority: "low",
      }),
    ];
    const html = render(
      <TaskList
        tasks={tasks}
        onTaskClick={noop}
        collapsedGroups={new Set(["backlog"])}
        activeTaskId="t2"
      />,
    );
    expect(html).toContain("text-title-small");
    expect(html).toContain("In Progress");
    expect(html).toContain("Done");
    expect(html).toContain("Ship it");
    expect(html).toContain("chevron_right");
    expect(html).toContain("No tasks");
    expect(html).toContain("bg-secondary-container");
  });

  test("task detail uses M3 headline, lists and buttons", () => {
    const html = render(
      <TaskDetail
        task={makeTask()}
        onStatusChange={noop}
        onDelete={noop}
        onClose={noop}
        onSubtaskToggle={noop}
      />,
    );
    expect(html).toMatch(/<h2 class="[^"]*text-headline-small/);
    expect(html).toContain("Subtasks");
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("bg-primary");
    expect(html).toContain("Mark Done");
    expect(html).toContain("text-error");
    expect(html).toContain("close");
    expect(html).toContain("<strong");
  });

  test("task detail without handlers shows static properties", () => {
    const html = render(
      <TaskDetail task={makeTask({ description: null, status: "backlog" })} />,
    );
    expect(html).toContain("Backlog");
    expect(html).toContain("No description");
    expect(html).not.toContain("Mark Done");
  });

  test("task create form uses M3 fields and buttons", () => {
    const html = render(<TaskCreateForm onSubmit={noop} onCancel={noop} />);
    expect(html).toContain("Task title...");
    expect(html).toContain("Description (optional)");
    expect(html).toContain("Create");
    expect(html).toContain("Cancel");
    expect(html).toContain("bg-surface-container-low");
    expect(html).toContain("rounded-medium");
  });
});
