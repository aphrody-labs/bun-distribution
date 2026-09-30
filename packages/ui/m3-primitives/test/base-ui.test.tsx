// SPDX-License-Identifier: Apache-2.0
// Behavior the Base UI headless layer brings to the M3 primitives: state callbacks, keyboard
// interaction, Radix-compatible props (`asChild`, tri-state checkbox, array slider values) and
// labels resolved before a select popup mounts.
import { afterEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CheckboxIndicator, CheckboxRoot } = await import("../src/Checkbox");
const { Collapsible, CollapsibleContent, CollapsibleTrigger } = await import("../src/Collapsible");
const { DialogContent, DialogRoot, DialogTitle, DialogTrigger } = await import("../src/Dialog");
const { DropdownMenu } = await import("../src/DropdownMenu");
const { Popover } = await import("../src/Popover");
const { Item: RadioItem, Root: RadioRoot } = await import("../src/RadioGroup");
const { Select, SelectContent, SelectItem, SelectOption, SelectRoot, SelectTrigger, SelectValue } =
  await import("../src/Select");
const { Slider } = await import("../src/Slider");
const { Switch } = await import("../src/Switch");
const {
  Content: TabsContent,
  Indicator: TabsIndicator,
  List: TabsList,
  Root: TabsRoot,
  Trigger: TabsTrigger,
} = await import("../src/Tabs");
const { ToggleGroup } = await import("../src/ToggleGroup");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let root: ReturnType<typeof createRoot> | undefined;

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  await settle();
  return container;
}

async function settle(ms = 20) {
  await act(async () => {
    await sleep(ms);
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    (element as HTMLElement).click();
  });
  await settle();
}

async function key(element: Element, name: string) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

const $ = (selector: string) => document.querySelector(selector) as HTMLElement;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
});

describe("controls", () => {
  test("CheckboxRoot toggles, reports the new state and keeps the Radix tri-state value", async () => {
    const changes: boolean[] = [];
    await mount(
      <CheckboxRoot aria-label="agree" onCheckedChange={(checked) => changes.push(checked)}>
        <CheckboxIndicator />
      </CheckboxRoot>,
    );
    const box = $("[role=checkbox]");
    expect(box.tagName).toBe("BUTTON");
    expect(box.getAttribute("aria-checked")).toBe("false");
    await click(box);
    expect(changes).toEqual([true]);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.hasAttribute("data-checked")).toBe(true);
    expect(document.body.innerHTML).toContain(">check<");

    const mixed = renderToStaticMarkup(<CheckboxRoot checked="indeterminate" />);
    expect(mixed).toContain('aria-checked="mixed"');
    expect(mixed).toContain("data-indeterminate");
  });

  test("Switch toggles through the keyboard-accessible native button", async () => {
    const changes: boolean[] = [];
    await mount(<Switch aria-label="wifi" onCheckedChange={(checked) => changes.push(checked)} />);
    const control = $("[role=switch]");
    expect(control.tagName).toBe("BUTTON");
    await click(control);
    expect(changes).toEqual([true]);
    expect(control.getAttribute("aria-checked")).toBe("true");
  });

  test("RadioGroup selects on click and reports the value", async () => {
    const values: string[] = [];
    await mount(
      <RadioRoot defaultValue="a" onValueChange={(value) => values.push(value)}>
        <RadioItem value="a">A</RadioItem>
        <RadioItem value="b">B</RadioItem>
      </RadioRoot>,
    );
    const b = $("#radiob");
    await click(b);
    expect(values).toEqual(["b"]);
    expect(b.getAttribute("aria-checked")).toBe("true");
    expect($("#radioa").getAttribute("aria-checked")).toBe("false");
  });

  test("Slider reports array values (Radix shape) from the keyboard", async () => {
    const values: number[][] = [];
    await mount(
      <Slider
        defaultValue={[20, 80]}
        max={100}
        getAriaLabel={(i) => (i === 0 ? "min" : "max")}
        onValueChange={(value) => values.push(value)}
      />,
    );
    const inputs = document.querySelectorAll("input[type=range]");
    expect(inputs.length).toBe(2);
    expect(inputs[0]!.getAttribute("aria-label")).toBe("min");
    await act(async () => {
      (inputs[0] as HTMLInputElement).focus();
    });
    await key(inputs[0]!, "ArrowRight");
    expect(values.at(-1)).toEqual([21, 80]);
  });

  test("ToggleGroup is single-select and reports the pressed segment", async () => {
    const changes: string[] = [];
    await mount(
      <ToggleGroup
        value="grid"
        onChange={(value) => changes.push(value)}
        options={[
          { value: "grid", label: "Grid" },
          { value: "list", label: "List" },
        ]}
      />,
    );
    const buttons = [...document.querySelectorAll("button")];
    expect(buttons[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1]!.getAttribute("aria-pressed")).toBe("false");
    await click(buttons[1]!);
    expect(changes).toEqual(["list"]);
  });

  test("Tabs switch panels on click; the sliding M3 indicator renders in the list", async () => {
    const values: unknown[] = [];
    await mount(
      <TabsRoot defaultValue="one" onValueChange={(value) => values.push(value)}>
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
          <TabsIndicator />
        </TabsList>
        <TabsContent value="one">Body one</TabsContent>
        <TabsContent value="two">Body two</TabsContent>
      </TabsRoot>,
    );
    expect(document.body.innerHTML).toContain("Body one");
    const two = [...document.querySelectorAll("[role=tab]")][1] as HTMLElement;
    await click(two);
    expect(values).toEqual(["two"]);
    expect(two.getAttribute("aria-selected")).toBe("true");
    expect(document.body.innerHTML).toContain("Body two");
    expect(document.body.innerHTML).not.toContain("Body one");
    expect(document.body.innerHTML).toContain("w-(--active-tab-width)");
  });

  test("Collapsible toggles aria-expanded and mounts the panel", async () => {
    const changes: boolean[] = [];
    await mount(
      <Collapsible onOpenChange={(open) => changes.push(open)}>
        <CollapsibleTrigger>Header</CollapsibleTrigger>
        <CollapsibleContent>Inner</CollapsibleContent>
      </Collapsible>,
    );
    const trigger = $("button");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.innerHTML).not.toContain("Inner");
    await click(trigger);
    expect(changes).toEqual([true]);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.innerHTML).toContain("Inner");
  });
});

describe("select", () => {
  test("the trigger shows the option label, not the raw value, before the popup opens", () => {
    const html = renderToStaticMarkup(
      <Select value="a" onChange={() => {}}>
        <SelectOption value="a">Alpha</SelectOption>
        <SelectOption value="b">Beta</SelectOption>
      </Select>,
    );
    expect(html).toContain(">Alpha<");
    expect(html).not.toContain(">a<");
  });

  test("composable SelectRoot derives the labels from its SelectItem children", () => {
    const html = renderToStaticMarkup(
      <SelectRoot defaultValue="pro">
        <SelectTrigger>
          <SelectValue placeholder="Plan" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="free">Free</SelectItem>
          <SelectItem value="pro">Pro</SelectItem>
        </SelectContent>
      </SelectRoot>,
    );
    expect(html).toContain(">Pro<");
  });

  test("opens a listbox and selects an option", async () => {
    const changes: string[] = [];
    await mount(
      <Select value="a" onChange={(value) => changes.push(value)}>
        <SelectOption value="a">Alpha</SelectOption>
        <SelectOption value="b">Beta</SelectOption>
      </Select>,
    );
    await click($("button"));
    expect($("[role=listbox]")).toBeTruthy();
    const beta = [...document.querySelectorAll("[role=option]")].find((o) =>
      o.textContent?.includes("Beta"),
    ) as HTMLElement;
    expect(beta).toBeTruthy();
    expect(document.body.innerHTML).toContain("data-selected:bg-secondary-container");
    await click(beta);
    expect(changes).toEqual(["b"]);
  });
});

describe("overlays", () => {
  test("Popover.Trigger asChild renders the child as the trigger and opens on click", async () => {
    await mount(
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" data-testid="pill">
            Pick
          </button>
        </Popover.Trigger>
        <Popover.Content align="start">Popover body</Popover.Content>
      </Popover.Root>,
    );
    const pill = $("[data-testid=pill]");
    expect(pill.parentElement?.tagName).not.toBe("BUTTON");
    expect(pill.getAttribute("aria-expanded")).toBe("false");
    await click(pill);
    expect(pill.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.innerHTML).toContain("Popover body");
    expect(document.body.innerHTML).toContain("origin-(--transform-origin)");
  });

  test("DropdownMenu items fire Radix onSelect and close the menu", async () => {
    const selected: string[] = [];
    await mount(
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>menu</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelect={() => selected.push("open")}>Open</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    );
    const trigger = $("button");
    await click(trigger);
    expect($("[role=menu]")).toBeTruthy();
    await click($("[role=menuitem]"));
    expect(selected).toEqual(["open"]);
    await settle(50);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  test("DialogContent is a modal dialog labelled by its title and closes on Escape", async () => {
    const changes: boolean[] = [];
    await mount(
      <DialogRoot onOpenChange={(open) => changes.push(open)}>
        <DialogTrigger>open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Rename</DialogTitle>
        </DialogContent>
      </DialogRoot>,
    );
    await click($("button"));
    const dialog = $("[role=dialog]");
    expect(dialog).toBeTruthy();
    const title = document.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
    expect(title?.textContent).toBe("Rename");
    await key(dialog, "Escape");
    expect(changes).toEqual([true, false]);
  });
});
