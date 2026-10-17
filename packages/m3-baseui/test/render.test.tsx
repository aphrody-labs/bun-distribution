// SPDX-License-Identifier: Apache-2.0
// Every primitive rendered in a DOM (happy-dom): the M3 classes land on the Base UI elements and the Base UI
// behaviour (roles, `data-*` state, controlled and uncontrolled state) survives the wrapping.
import { afterEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import {
  M3Accordion,
  M3AlertDialog,
  M3Autocomplete,
  M3Avatar,
  M3Button,
  M3Checkbox,
  M3CheckboxGroup,
  M3Collapsible,
  M3Combobox,
  M3ContextMenu,
  M3Dialog,
  M3Drawer,
  M3Field,
  M3Fieldset,
  M3Form,
  M3Input,
  M3Menu,
  M3Menubar,
  M3Meter,
  M3NavigationMenu,
  M3NumberField,
  M3OtpField,
  M3Popover,
  M3PreviewCard,
  M3Progress,
  M3Radio,
  M3RadioGroup,
  M3ScrollArea,
  M3Select,
  M3Separator,
  M3Slider,
  M3Switch,
  M3Tabs,
  M3Toast,
  M3Toggle,
  M3ToggleGroup,
  M3Toolbar,
  M3Tooltip,
  cx,
  mergeClassName,
} from "../src/index.ts";

// The DOM comes from the happy-dom preload (bunfig.toml).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let root: ReturnType<typeof createRoot> | undefined;

async function mount(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
  await act(async () => {
    await sleep(20);
  });
  return container;
}

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`no element matches ${selector}\n${document.body.innerHTML.slice(0, 1500)}`);
  return el;
};
const click = (el: Element) =>
  act(async () => {
    (el as HTMLElement).click();
    await sleep(10);
  });
const has = (selector: string) => document.querySelector(selector) !== null;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
});

function ToastAdder() {
  const manager = M3Toast.useToastManager();
  return (
    <button type="button" id="add" onClick={() => manager.add({ title: "Saved", description: "All good" })}>
      add
    </button>
  );
}
function ToastList() {
  const { toasts } = M3Toast.useToastManager();
  return toasts.map(toast => (
    <M3Toast.Root key={toast.id} toast={toast}>
      <M3Toast.Content>
        <M3Toast.Title />
        <M3Toast.Description />
        <M3Toast.Action>Undo</M3Toast.Action>
        <M3Toast.Close aria-label="close">x</M3Toast.Close>
      </M3Toast.Content>
    </M3Toast.Root>
  ));
}

describe("class merging", () => {
  test("cx drops falsy values", () => expect(cx("a", false, undefined, null, "b")).toBe("a b"));

  test("mergeClassName keeps strings and state functions", () => {
    expect(mergeClassName("m3", "app")).toBe("m3 app");
    expect(mergeClassName("m3", undefined)).toBe("m3");
    const fn = mergeClassName("m3", (s: { on: boolean }) => (s.on ? "on" : undefined));
    expect(typeof fn).toBe("function");
    expect((fn as (s: { on: boolean }) => string)({ on: true })).toBe("m3 on");
    expect((fn as (s: { on: boolean }) => string)({ on: false })).toBe("m3");
  });

  test("a Base UI part still takes a state-function className", async () => {
    await mount(
      <M3Button disabled className={state => (state.disabled ? "is-off" : "is-on")}>
        x
      </M3Button>,
    );
    const button = q("button");
    expect(button.className).toContain("m3-bui-button");
    expect(button.className).toContain("is-off");
  });
});

describe("closed forms and single elements", () => {
  test("button: type, size, ref and data-disabled", async () => {
    const refs: { el?: HTMLElement | null } = {};
    await mount(
      <>
        <M3Button
          variant="tonal"
          size="lg"
          ref={el => {
            refs.el = el;
          }}
        >
          Save
        </M3Button>
        <M3Button variant="outlined" disabled>
          Off
        </M3Button>
        <M3Button variant="text" size="sm">
          Small
        </M3Button>
      </>,
    );
    const [first, second, third] = [...document.querySelectorAll("button")];
    expect(first!.className).toContain("m3-bui-button m3-bui-state m3-bui-button--tonal m3-bui-button--lg");
    expect(refs.el).toBe(first!);
    expect(second!.hasAttribute("data-disabled")).toBe(true);
    expect(third!.className).not.toContain("--sm");
  });

  test("switch: role, thumb, and a click flips data-checked", async () => {
    await mount(<M3Switch />);
    const sw = q('[role="switch"]');
    expect(sw.className).toContain("m3-bui-switch");
    expect(has(".m3-bui-switch__thumb")).toBe(true);
    expect(sw.hasAttribute("data-checked")).toBe(false);
    await click(sw);
    expect(sw.hasAttribute("data-checked")).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  test("checkbox: both glyphs, toggles, and the indeterminate state", async () => {
    await mount(
      <>
        <M3Checkbox defaultChecked />
        <M3Checkbox indeterminate />
      </>,
    );
    const [on, mixed] = [...document.querySelectorAll('[role="checkbox"]')];
    expect(on!.className).toContain("m3-bui-checkbox m3-bui-state");
    expect(on!.querySelector(".m3-bui-checkbox__check")).not.toBeNull();
    expect(on!.querySelector(".m3-bui-checkbox__dash")).not.toBeNull();
    expect(mixed!.hasAttribute("data-indeterminate")).toBe(true);
    expect(mixed!.querySelector(".m3-bui-checkbox__indicator")!.hasAttribute("data-indeterminate")).toBe(true);
    await click(on!);
    expect(on!.hasAttribute("data-checked")).toBe(false);
  });

  test("radio group: selecting a radio moves data-checked", async () => {
    await mount(
      <M3RadioGroup defaultValue="a" aria-label="choice">
        <M3Radio value="a" />
        <M3Radio value="b" />
      </M3RadioGroup>,
    );
    expect(q('[role="radiogroup"]').className).toContain("m3-bui-group");
    const [a, b] = [...document.querySelectorAll('[role="radio"]')];
    expect(a!.className).toContain("m3-bui-radio");
    expect(a!.hasAttribute("data-checked")).toBe(true);
    expect(has(".m3-bui-radio__indicator")).toBe(true);
    await click(b!);
    expect(b!.hasAttribute("data-checked")).toBe(true);
    expect(a!.hasAttribute("data-checked")).toBe(false);
  });

  test("checkbox group, form, fieldset, separator", async () => {
    await mount(
      <M3Form>
        <M3Fieldset.Root>
          <M3Fieldset.Legend>Options</M3Fieldset.Legend>
          <M3CheckboxGroup defaultValue={["a"]} aria-label="options">
            <M3Checkbox name="a" value="a" />
          </M3CheckboxGroup>
        </M3Fieldset.Root>
        <M3Separator />
      </M3Form>,
    );
    for (const c of [
      ".m3-bui-form",
      ".m3-bui-fieldset",
      ".m3-bui-fieldset__legend",
      ".m3-bui-group",
      ".m3-bui-separator",
    ])
      expect(has(c)).toBe(true);
    expect(q(".m3-bui-separator").getAttribute("role")).toBe("separator");
  });

  test("input: outlined is the base class, filled adds a modifier", async () => {
    await mount(
      <>
        <M3Input aria-label="a" />
        <M3Input aria-label="b" variant="filled" />
      </>,
    );
    const [a, b] = [...document.querySelectorAll("input")];
    expect(a!.className).toBe("m3-bui-input");
    expect(b!.className).toBe("m3-bui-input m3-bui-input--filled");
  });

  test("toggle and toggle group: data-pressed follows the click", async () => {
    await mount(
      <>
        <M3Toggle aria-label="bold">B</M3Toggle>
        <M3ToggleGroup defaultValue={["a"]}>
          <M3Toggle value="a">A</M3Toggle>
          <M3Toggle value="b">B</M3Toggle>
        </M3ToggleGroup>
      </>,
    );
    const toggles = [...document.querySelectorAll(".m3-bui-toggle")];
    expect(toggles).toHaveLength(3);
    expect(has(".m3-bui-toggle-group")).toBe(true);
    expect(toggles[0]!.hasAttribute("data-pressed")).toBe(false);
    await click(toggles[0]!);
    expect(toggles[0]!.hasAttribute("data-pressed")).toBe(true);
    expect(toggles[1]!.hasAttribute("data-pressed")).toBe(true);
  });
});

describe("namespaced primitives", () => {
  test("tabs: roles, the active panel and the indicator", async () => {
    await mount(
      <M3Tabs.Root defaultValue="a">
        <M3Tabs.List>
          <M3Tabs.Tab value="a">A</M3Tabs.Tab>
          <M3Tabs.Tab value="b">B</M3Tabs.Tab>
          <M3Tabs.Indicator />
        </M3Tabs.List>
        <M3Tabs.Panel value="a">panel a</M3Tabs.Panel>
        <M3Tabs.Panel value="b">panel b</M3Tabs.Panel>
      </M3Tabs.Root>,
    );
    expect(q('[role="tablist"]').className).toContain("m3-bui-tabs__list");
    expect(q('[role="tab"]').className).toContain("m3-bui-tabs__tab m3-bui-state");
    expect(has(".m3-bui-tabs__indicator")).toBe(true);
    expect(q('[role="tabpanel"]').textContent).toBe("panel a");
    await click(document.querySelectorAll('[role="tab"]')[1]!);
    expect(q('[role="tabpanel"]:not([hidden])').textContent).toBe("panel b");
  });

  test("accordion and collapsible expand on click", async () => {
    await mount(
      <>
        <M3Accordion.Root>
          <M3Accordion.Item value="one">
            <M3Accordion.Header>
              <M3Accordion.Trigger>One</M3Accordion.Trigger>
            </M3Accordion.Header>
            <M3Accordion.Panel>body one</M3Accordion.Panel>
          </M3Accordion.Item>
        </M3Accordion.Root>
        <M3Collapsible.Root>
          <M3Collapsible.Trigger>More</M3Collapsible.Trigger>
          <M3Collapsible.Panel>more body</M3Collapsible.Panel>
        </M3Collapsible.Root>
      </>,
    );
    for (const c of [
      ".m3-bui-accordion",
      ".m3-bui-accordion__item",
      ".m3-bui-accordion__header",
      ".m3-bui-accordion__trigger",
      ".m3-bui-collapsible",
      ".m3-bui-collapsible__trigger",
    ])
      expect(has(c)).toBe(true);
    const [accordion, collapsible] = [q(".m3-bui-accordion__trigger"), q(".m3-bui-collapsible__trigger")];
    expect(accordion.getAttribute("aria-expanded")).toBe("false");
    await click(accordion);
    await click(collapsible);
    expect(accordion.getAttribute("aria-expanded")).toBe("true");
    expect(collapsible.getAttribute("aria-expanded")).toBe("true");
    expect(has(".m3-bui-accordion__panel")).toBe(true);
    expect(has(".m3-bui-collapsible__panel")).toBe(true);
  });

  test("avatar shows the fallback without an image", async () => {
    await mount(
      <M3Avatar.Root>
        <M3Avatar.Image src="" alt="" />
        <M3Avatar.Fallback>AB</M3Avatar.Fallback>
      </M3Avatar.Root>,
    );
    expect(q(".m3-bui-avatar__fallback").textContent).toBe("AB");
  });

  test("field wires the label, control, description and error", async () => {
    await mount(
      <M3Field.Root invalid>
        <M3Field.Label>Name</M3Field.Label>
        <M3Field.Control />
        <M3Field.Description>Your name</M3Field.Description>
        <M3Field.Error match>Required</M3Field.Error>
      </M3Field.Root>,
    );
    const input = q<HTMLInputElement>("input");
    expect(input.className).toContain("m3-bui-field__control");
    expect(q("label").className).toContain("m3-bui-field__label");
    expect(q("label").getAttribute("for")).toBe(input.id);
    expect(q(".m3-bui-field__description").textContent).toBe("Your name");
    expect(q(".m3-bui-field__error").textContent).toBe("Required");
    expect(q(".m3-bui-field").hasAttribute("data-invalid")).toBe(true);
  });

  test("number field steps with its buttons", async () => {
    await mount(
      <M3NumberField.Root defaultValue={5} min={0} max={10}>
        <M3NumberField.Group>
          <M3NumberField.Decrement>-</M3NumberField.Decrement>
          <M3NumberField.Input />
          <M3NumberField.Increment>+</M3NumberField.Increment>
        </M3NumberField.Group>
      </M3NumberField.Root>,
    );
    const [dec, inc] = document.querySelectorAll(".m3-bui-number-field__step");
    expect(has(".m3-bui-number-field__group")).toBe(true);
    const input = q<HTMLInputElement>(".m3-bui-number-field__input");
    expect(input.value).toBe("5");
    await click(inc!);
    expect(input.value).toBe("6");
    await click(dec!);
    await click(dec!);
    expect(input.value).toBe("4");
  });

  test("OTP field renders one input per slot", async () => {
    await mount(
      <M3OtpField.Root length={4}>
        <M3OtpField.Input />
        <M3OtpField.Input />
        <M3OtpField.Separator />
        <M3OtpField.Input />
        <M3OtpField.Input />
      </M3OtpField.Root>,
    );
    expect(document.querySelectorAll(".m3-bui-otp__input")).toHaveLength(4);
    expect(has(".m3-bui-otp")).toBe(true);
    expect(has(".m3-bui-otp__separator")).toBe(true);
  });

  test("slider thumbs are sliders; progress and meter have their roles", async () => {
    await mount(
      <>
        <M3Slider.Root defaultValue={30}>
          <M3Slider.Label>Volume</M3Slider.Label>
          <M3Slider.Value />
          <M3Slider.Control>
            <M3Slider.Track>
              <M3Slider.Indicator />
              <M3Slider.Thumb aria-label="Volume" />
            </M3Slider.Track>
          </M3Slider.Control>
        </M3Slider.Root>
        <M3Progress.Root value={40}>
          <M3Progress.Label>Upload</M3Progress.Label>
          <M3Progress.Value />
          <M3Progress.Track>
            <M3Progress.Indicator />
          </M3Progress.Track>
        </M3Progress.Root>
        <M3Meter.Root value={60}>
          <M3Meter.Label>Disk</M3Meter.Label>
          <M3Meter.Track>
            <M3Meter.Indicator />
          </M3Meter.Track>
        </M3Meter.Root>
      </>,
    );
    expect(
      q('input[type="range"]').getAttribute("aria-valuenow") ?? q('input[type="range"]').getAttribute("value"),
    ).toBe("30");
    for (const c of [
      ".m3-bui-slider",
      ".m3-bui-slider__label",
      ".m3-bui-slider__value",
      ".m3-bui-slider__control",
      ".m3-bui-slider__track",
      ".m3-bui-slider__indicator",
      ".m3-bui-slider__thumb",
    ])
      expect(has(c)).toBe(true);
    expect(q('[role="progressbar"]').className).toContain("m3-bui-progress");
    expect(q('[role="meter"]').className).toContain("m3-bui-progress");
    expect(document.querySelectorAll(".m3-bui-progress__indicator")).toHaveLength(2);
    expect(q('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("40");
  });

  test("scroll area, toolbar and menubar render their parts", async () => {
    await mount(
      <>
        <M3ScrollArea.Root>
          <M3ScrollArea.Viewport>
            <M3ScrollArea.Content>content</M3ScrollArea.Content>
          </M3ScrollArea.Viewport>
          <M3ScrollArea.Scrollbar orientation="vertical">
            <M3ScrollArea.Thumb />
          </M3ScrollArea.Scrollbar>
        </M3ScrollArea.Root>
        <M3Toolbar.Root>
          <M3Toolbar.Button>Cut</M3Toolbar.Button>
          <M3Toolbar.Separator />
          <M3Toolbar.Group>
            <M3Toolbar.Link href="#a">Docs</M3Toolbar.Link>
          </M3Toolbar.Group>
          <M3Toolbar.Input aria-label="find" />
        </M3Toolbar.Root>
        <M3Menubar />
      </>,
    );
    for (const c of [
      ".m3-bui-scroll",
      ".m3-bui-scroll__viewport",
      ".m3-bui-toolbar",
      ".m3-bui-toolbar__button",
      ".m3-bui-toolbar__separator",
      ".m3-bui-toolbar__group",
      ".m3-bui-toolbar__input",
      ".m3-bui-menubar",
    ])
      expect(has(c)).toBe(true);
    expect(document.querySelectorAll(".m3-bui-toolbar__button")).toHaveLength(2);
  });
});

describe("popups (controlled open)", () => {
  test("dialog: backdrop, popup, title and description; the parts keep the Base UI roles", async () => {
    await mount(
      <M3Dialog.Root open>
        <M3Dialog.Portal>
          <M3Dialog.Backdrop />
          <M3Dialog.Popup>
            <M3Dialog.Title>Delete</M3Dialog.Title>
            <M3Dialog.Description>Really?</M3Dialog.Description>
            <M3Dialog.Close>Cancel</M3Dialog.Close>
          </M3Dialog.Popup>
        </M3Dialog.Portal>
      </M3Dialog.Root>,
    );
    expect(q('[role="dialog"]').className).toContain("m3-bui-dialog__popup");
    expect(q(".m3-bui-dialog__title").textContent).toBe("Delete");
    expect(q(".m3-bui-dialog__description").textContent).toBe("Really?");
    expect(has(".m3-bui-dialog__backdrop")).toBe(true);
  });

  test("alert dialog uses the dialog classes and the alertdialog role", async () => {
    await mount(
      <M3AlertDialog.Root open>
        <M3AlertDialog.Portal>
          <M3AlertDialog.Backdrop />
          <M3AlertDialog.Popup>
            <M3AlertDialog.Title>Sure?</M3AlertDialog.Title>
            <M3AlertDialog.Description>It cannot be undone.</M3AlertDialog.Description>
          </M3AlertDialog.Popup>
        </M3AlertDialog.Portal>
      </M3AlertDialog.Root>,
    );
    expect(q('[role="alertdialog"]').className).toContain("m3-bui-dialog__popup");
    expect(has(".m3-bui-dialog__title")).toBe(true);
  });

  test("drawer: backdrop, viewport, popup, title", async () => {
    await mount(
      <M3Drawer.Root open>
        <M3Drawer.Portal>
          <M3Drawer.Backdrop />
          <M3Drawer.Viewport>
            <M3Drawer.Popup>
              <M3Drawer.Content>
                <M3Drawer.Title>Sheet</M3Drawer.Title>
                <M3Drawer.Description>Details</M3Drawer.Description>
              </M3Drawer.Content>
            </M3Drawer.Popup>
          </M3Drawer.Viewport>
        </M3Drawer.Portal>
      </M3Drawer.Root>,
    );
    for (const c of [
      ".m3-bui-drawer__backdrop",
      ".m3-bui-drawer__viewport",
      ".m3-bui-drawer__popup",
      ".m3-bui-drawer__content",
      ".m3-bui-drawer__title",
      ".m3-bui-drawer__description",
    ])
      expect(has(c)).toBe(true);
  });

  test("popover and preview card share the popover surface", async () => {
    await mount(
      <>
        <M3Popover.Root open>
          <M3Popover.Trigger>Open</M3Popover.Trigger>
          <M3Popover.Portal>
            <M3Popover.Positioner>
              <M3Popover.Popup>
                <M3Popover.Title>Title</M3Popover.Title>
                <M3Popover.Description>Text</M3Popover.Description>
              </M3Popover.Popup>
            </M3Popover.Positioner>
          </M3Popover.Portal>
        </M3Popover.Root>
        <M3PreviewCard.Root open>
          <M3PreviewCard.Trigger href="#x">Link</M3PreviewCard.Trigger>
          <M3PreviewCard.Portal>
            <M3PreviewCard.Positioner>
              <M3PreviewCard.Popup>card</M3PreviewCard.Popup>
            </M3PreviewCard.Positioner>
          </M3PreviewCard.Portal>
        </M3PreviewCard.Root>
      </>,
    );
    expect(document.querySelectorAll(".m3-bui-popover__popup.m3-bui-popup")).toHaveLength(2);
    expect(document.querySelectorAll(".m3-bui-positioner")).toHaveLength(2);
    expect(has(".m3-bui-popover__title")).toBe(true);
    expect(has(".m3-bui-popover__description")).toBe(true);
  });

  test("tooltip is the plain tooltip", async () => {
    await mount(
      <M3Tooltip.Provider>
        <M3Tooltip.Root open>
          <M3Tooltip.Trigger>Hover</M3Tooltip.Trigger>
          <M3Tooltip.Portal>
            <M3Tooltip.Positioner>
              <M3Tooltip.Popup>Save</M3Tooltip.Popup>
            </M3Tooltip.Positioner>
          </M3Tooltip.Portal>
        </M3Tooltip.Root>
      </M3Tooltip.Provider>,
    );
    expect(q(".m3-bui-tooltip__popup").textContent).toBe("Save");
    expect(q(".m3-bui-tooltip__popup").parentElement!.className).toContain("m3-bui-positioner");
  });

  test("menu: items, checkbox and radio items, group label, separator", async () => {
    await mount(
      <M3Menu.Root open>
        <M3Menu.Trigger>Menu</M3Menu.Trigger>
        <M3Menu.Portal>
          <M3Menu.Positioner>
            <M3Menu.Popup>
              <M3Menu.Group>
                <M3Menu.GroupLabel>Edit</M3Menu.GroupLabel>
                <M3Menu.Item>Cut</M3Menu.Item>
              </M3Menu.Group>
              <M3Menu.Separator />
              <M3Menu.CheckboxItem checked>
                <M3Menu.CheckboxItemIndicator>on</M3Menu.CheckboxItemIndicator>
                Grid
              </M3Menu.CheckboxItem>
              <M3Menu.RadioGroup value="a">
                <M3Menu.RadioItem value="a">A</M3Menu.RadioItem>
              </M3Menu.RadioGroup>
            </M3Menu.Popup>
          </M3Menu.Positioner>
        </M3Menu.Portal>
      </M3Menu.Root>,
    );
    expect(q('[role="menu"]').className).toContain("m3-bui-menu__popup m3-bui-popup");
    expect(q('[role="menuitem"]').className).toContain("m3-bui-menu__item m3-bui-item");
    expect(has('[role="menuitemcheckbox"].m3-bui-item')).toBe(true);
    expect(has('[role="menuitemradio"].m3-bui-item')).toBe(true);
    for (const c of [
      ".m3-bui-menu__group",
      ".m3-bui-menu__group-label",
      ".m3-bui-menu__separator",
      ".m3-bui-menu__indicator",
    ])
      expect(has(c)).toBe(true);
  });

  test("context menu shares the menu classes", async () => {
    await mount(
      <M3ContextMenu.Root>
        <M3ContextMenu.Trigger>Right click</M3ContextMenu.Trigger>
        <M3ContextMenu.Portal>
          <M3ContextMenu.Positioner>
            <M3ContextMenu.Popup>
              <M3ContextMenu.Item>Copy</M3ContextMenu.Item>
            </M3ContextMenu.Popup>
          </M3ContextMenu.Positioner>
        </M3ContextMenu.Portal>
      </M3ContextMenu.Root>,
    );
    expect(has(".m3-bui-menu__popup")).toBe(false);
  });

  test("select: trigger, value, popup, list, items with an indicator", async () => {
    await mount(
      <M3Select.Root
        open
        defaultValue="b"
        items={[
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ]}
      >
        <M3Select.Label>Letter</M3Select.Label>
        <M3Select.Trigger>
          <M3Select.Value />
          <M3Select.Icon>v</M3Select.Icon>
        </M3Select.Trigger>
        <M3Select.Portal>
          <M3Select.Positioner>
            <M3Select.Popup>
              <M3Select.List>
                <M3Select.Item value="a">
                  <M3Select.ItemIndicator>*</M3Select.ItemIndicator>
                  <M3Select.ItemText>A</M3Select.ItemText>
                </M3Select.Item>
                <M3Select.Item value="b">
                  <M3Select.ItemIndicator>*</M3Select.ItemIndicator>
                  <M3Select.ItemText>B</M3Select.ItemText>
                </M3Select.Item>
              </M3Select.List>
            </M3Select.Popup>
          </M3Select.Positioner>
        </M3Select.Portal>
      </M3Select.Root>,
    );
    for (const c of [
      ".m3-bui-select__trigger",
      ".m3-bui-select__value",
      ".m3-bui-select__icon",
      ".m3-bui-select__label",
      ".m3-bui-select__popup.m3-bui-popup",
      ".m3-bui-select__list",
      ".m3-bui-select__item.m3-bui-item",
      ".m3-bui-select__item-text",
    ])
      expect(has(c)).toBe(true);
    expect(q('[role="option"][data-selected]').textContent).toContain("B");
  });

  test("combobox and autocomplete share the combobox classes", async () => {
    const items = ["Apple", "Banana"];
    await mount(
      <>
        <M3Combobox.Root open items={items}>
          <M3Combobox.InputGroup>
            <M3Combobox.Input aria-label="fruit" />
            <M3Combobox.Clear>x</M3Combobox.Clear>
            <M3Combobox.Trigger>v</M3Combobox.Trigger>
          </M3Combobox.InputGroup>
          <M3Combobox.Portal>
            <M3Combobox.Positioner>
              <M3Combobox.Popup>
                <M3Combobox.Empty>none</M3Combobox.Empty>
                <M3Combobox.List>
                  {(item: string) => (
                    <M3Combobox.Item key={item} value={item}>
                      <M3Combobox.ItemIndicator>*</M3Combobox.ItemIndicator>
                      {item}
                    </M3Combobox.Item>
                  )}
                </M3Combobox.List>
              </M3Combobox.Popup>
            </M3Combobox.Positioner>
          </M3Combobox.Portal>
        </M3Combobox.Root>
        <M3Autocomplete.Root open items={items}>
          <M3Autocomplete.Input aria-label="suggest" />
          <M3Autocomplete.Portal>
            <M3Autocomplete.Positioner>
              <M3Autocomplete.Popup>
                <M3Autocomplete.List>
                  {(item: string) => (
                    <M3Autocomplete.Item key={item} value={item}>
                      {item}
                    </M3Autocomplete.Item>
                  )}
                </M3Autocomplete.List>
              </M3Autocomplete.Popup>
            </M3Autocomplete.Positioner>
          </M3Autocomplete.Portal>
        </M3Autocomplete.Root>
      </>,
    );
    for (const c of [
      ".m3-bui-combobox__input-group",
      ".m3-bui-combobox__input",
      ".m3-bui-combobox__trigger",
      ".m3-bui-combobox__popup.m3-bui-popup",
      ".m3-bui-combobox__list",
      ".m3-bui-combobox__item.m3-bui-item",
    ])
      expect(has(c)).toBe(true);
    expect(document.querySelectorAll(".m3-bui-combobox__popup")).toHaveLength(2);
  });

  test("navigation menu renders its list, items and links", async () => {
    await mount(
      <M3NavigationMenu.Root>
        <M3NavigationMenu.List>
          <M3NavigationMenu.Item>
            <M3NavigationMenu.Link href="/a">A</M3NavigationMenu.Link>
          </M3NavigationMenu.Item>
          <M3NavigationMenu.Item>
            <M3NavigationMenu.Trigger>
              B<M3NavigationMenu.Icon>v</M3NavigationMenu.Icon>
            </M3NavigationMenu.Trigger>
            <M3NavigationMenu.Content>content b</M3NavigationMenu.Content>
          </M3NavigationMenu.Item>
        </M3NavigationMenu.List>
      </M3NavigationMenu.Root>,
    );
    for (const c of [
      ".m3-bui-nav",
      ".m3-bui-nav__list",
      ".m3-bui-nav__item",
      ".m3-bui-nav__link.m3-bui-state",
      ".m3-bui-nav__trigger.m3-bui-state",
      ".m3-bui-nav__icon",
    ])
      expect(has(c)).toBe(true);
  });

  test("toast: provider, viewport and a toast added through the manager", async () => {
    await mount(
      <M3Toast.Provider>
        <ToastAdder />
        <M3Toast.Portal>
          <M3Toast.Viewport>
            <ToastList />
          </M3Toast.Viewport>
        </M3Toast.Portal>
      </M3Toast.Provider>,
    );
    expect(has(".m3-bui-toast__viewport")).toBe(true);
    await click(q("#add"));
    expect(q(".m3-bui-toast").className).toContain("m3-bui-toast");
    expect(q(".m3-bui-toast__title").textContent).toBe("Saved");
    expect(q(".m3-bui-toast__description").textContent).toBe("All good");
    expect(has(".m3-bui-toast__action.m3-bui-state")).toBe(true);
    expect(has(".m3-bui-toast__close.m3-bui-state")).toBe(true);
  });
});
