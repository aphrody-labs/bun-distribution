// SPDX-License-Identifier: Apache-2.0
// oxlint-disable-next-line import/no-unassigned-import -- installs browser globals before React DOM is loaded
import "@aphrody/m3-config/test/dom";
import { afterEach, describe, expect, mock, test } from "bun:test";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ModelOptionList, groupModelsByProvider } from "../src/ModelSelector.tsx";
import type { ModelOption } from "../src/types.ts";
import { GeminiPersonalContextEdit } from "../src/GeminiPersonalContextEdit.tsx";
import { GoogleSpotlightBar } from "../src/GoogleSpotlightBar.tsx";
import { A2ATaskTimeline, type TimelineStep } from "../src/A2ATaskTimeline.tsx";
import { InlineMath } from "../src/Markdown.tsx";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  if (root) flushSync(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});
const models: ModelOption[] = [
  { id: "a", name: "Alpha", provider: "First" },
  { id: "b", name: "Beta", provider: "Second" },
  { id: "c", name: "Gamma", provider: "Second" },
];

function key(value: string) {
  flushSync(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true }),
    ),
  );
}

describe("production model selector accessibility", () => {
  test("provider names cannot collide with Object prototype properties", () => {
    const grouped = groupModelsByProvider([
      { id: "x", name: "X", provider: "__proto__" },
      { id: "y", name: "Y", provider: "constructor" },
    ]);
    expect(grouped.__proto__).toHaveLength(1);
    expect(grouped.constructor).toHaveLength(1);
    expect(Object.keys(grouped)).toEqual(["__proto__", "constructor"]);
  });

  test("listbox has one tab stop and moves focus across providers with arrows, Home and End", () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const selected = mock(() => {});
    flushSync(() =>
      root!.render(
        <ModelOptionList grouped={groupModelsByProvider(models)} value="b" onSelect={selected} />,
      ),
    );
    const options = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options.map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
    flushSync(() => options[1]!.focus());
    key("ArrowDown");
    expect(document.activeElement === options[2]).toBe(true);
    expect(options.map((option) => option.tabIndex)).toEqual([-1, -1, 0]);
    key("ArrowDown");
    expect(document.activeElement === options[0]).toBe(true);
    key("End");
    expect(document.activeElement === options[2]).toBe(true);
    key("Home");
    expect(document.activeElement === options[0]).toBe(true);
    flushSync(() => options[0]!.click());
    expect(selected).toHaveBeenCalledWith("a");
  });
});

function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(element));
}

function editControl(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  flushSync(() => {
    setValue.call(control, value);
    const propKey = Object.keys(control).find((k) => k.startsWith("__reactProps$"));
    if (propKey) {
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      const props = (control as unknown as Record<string, any>)[propKey];
      props?.onChange?.({ target: control, currentTarget: control });
    } else {
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

describe("production controlled AI editors and actions", () => {
  test("personal context preserves a draft across rerenders and resets on source changes and reopening", async () => {
    const onOpenChange = mock(() => {});
    const onSave = mock(() => {});
    const render = (initialContext: string, open = true) => (
      <GeminiPersonalContextEdit
        open={open}
        initialContext={initialContext}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    );
    mount(render("Saved context"));
    await Bun.sleep(20);
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Personal context content"]',
    )!;
    expect(textarea.value).toBe("Saved context");
    textarea.focus();
    editControl(textarea, "Unsaved draft");
    expect(textarea.value).toBe("Unsaved draft");
    flushSync(() => root!.render(render("Saved context")));
    expect(textarea.value).toBe("Unsaved draft");
    flushSync(() => root!.render(render("New saved context")));
    expect(document.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("New saved context");
    expect(document.activeElement).toBe(textarea);
    editControl(textarea, "Another draft");
    flushSync(() => root!.render(render("New saved context", false)));
    flushSync(() => root!.render(render("New saved context", true)));
    await Bun.sleep(20);
    expect(document.querySelector("textarea")?.value).toBe("New saved context");
    expect(onSave).not.toHaveBeenCalled();
  });

  test("personal context saves the trimmed edited draft and requests controlled close", async () => {
    const saves: string[] = [];
    const closes: boolean[] = [];
    mount(
      <GeminiPersonalContextEdit
        open
        initialContext="Old context"
        onOpenChange={(open) => closes.push(open)}
        onSave={(value) => {
          saves.push(value);
        }}
      />,
    );
    await Bun.sleep(20);
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    editControl(textarea, "  New context  ");
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Save",
    )!;
    expect(save.disabled).toBe(false);
    flushSync(() => save.click());
    await Bun.sleep(10);
    expect(saves).toEqual(["New context"]);
    expect(closes).toEqual([false]);
  });

  test("Spotlight retains controlled query behavior inside a native search landmark", () => {
    const changes: string[] = [];
    const submissions: string[] = [];
    const render = (query: string) => (
      <GoogleSpotlightBar
        query={query}
        onQueryChange={(value) => changes.push(value)}
        onSubmit={(value) => submissions.push(value)}
      />
    );
    mount(render("Initial query"));
    const search = host!.querySelector("search")!;
    expect(search.getAttribute("aria-label")).toBe("Google Spotlight Assistant");
    const input = search.querySelector("input")!;
    editControl(input, "Proposed query");
    expect(changes).toEqual(["Proposed query"]);
    flushSync(() =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(submissions).toEqual(["Initial query"]);
    // Observe the controlled DOM at the owner's React commit. Synthetic happy-dom
    // edits do not reliably exercise the browser's immediate value restoration.
    flushSync(() => root!.render(render("Initial query")));
    expect(input.value).toBe("Initial query");
    flushSync(() => root!.render(render("Accepted query")));
    expect(input.value).toBe("Accepted query");
    flushSync(() =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(submissions).toEqual(["Initial query", "Accepted query"]);
  });

  test("timeline exposes a native disclosure button with a stable controlled region", () => {
    const step: TimelineStep = {
      id: "step one",
      from: "user",
      to: "worker",
      title: "Inspect source",
      status: "running",
      timestamp: "Live",
      envelope: { kind: "ask", topic: "inspection", body: "Local source summary" },
    };
    const selected = mock(() => {});
    mount(<A2ATaskTimeline steps={[step]} onSelectStep={selected} />);
    const button = host!.querySelector<HTMLButtonElement>("button")!;
    expect(button.type).toBe("button");
    expect(button.tabIndex).toBe(0);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const region = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(region.hidden).toBe(true);
    expect(button.textContent).toContain("Live");
    expect(button.textContent).not.toContain("Invalid Date");
    flushSync(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(region.hidden).toBe(false);
    expect(region.textContent).toContain("Local source summary");
    expect(selected).toHaveBeenCalledWith(step);
    flushSync(() => button.click());
    expect(region.hidden).toBe(true);
  });
});

test("math content retains existing superscript and subscript nodes when another term is prepended", () => {
  mount(<InlineMath math="x^2 + y_1 + z^2" />);
  const [firstExponent, repeatedExponent] = [...host!.querySelectorAll("sup")];
  const subscript = host!.querySelector("sub");
  flushSync(() => root!.render(<InlineMath math="w^3 + x^2 + y_1 + z^2" />));
  const exponents = [...host!.querySelectorAll("sup")];
  expect(exponents.map((node) => node.textContent)).toEqual(["3", "2", "2"]);
  expect(exponents[1]).toBe(firstExponent);
  expect(exponents[2]).toBe(repeatedExponent);
  expect(host!.querySelector("sub")).toBe(subscript);
});
