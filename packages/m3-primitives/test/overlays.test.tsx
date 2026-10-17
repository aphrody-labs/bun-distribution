// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The DOM comes from test/setup.ts (bunfig.toml preload).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Motion runs its enter/exit keyframes instantly (happy-dom's WAAPI rejects cancelled animations).
const { MotionGlobalConfig } = await import("motion/react");
MotionGlobalConfig.skipAnimations = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useForm } = await import("react-hook-form");
const DialogModule = await import("../src/Dialog");
const PopoverModule = await import("../src/Popover");
const TooltipModule = await import("../src/Tooltip");
const DropdownMenuModule = await import("../src/DropdownMenu");
const ContextMenuModule = await import("../src/ContextMenu");
const DropdownModule = await import("../src/Dropdown");
const ToastModule = await import("../src/Toast");

const FILES = ["Dialog", "Popover", "Tooltip", "DropdownMenu", "ContextMenu", "Dropdown", "Toast"];
const SPACEUI_VOCABULARY = /\b(bg|text|border)-(app|ink|sidebar|menu|accent)\b/;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Upstream callers passed Phosphor components with `weight`: a component still renders. */
const Legacy = (props: { className?: string }) => <svg className={props.className} data-legacy="" />;

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await sleep(20);
  });
  return document.body.innerHTML;
}

function expectM3(html: string) {
  expect(html).not.toMatch(SPACEUI_VOCABULARY);
  expect(html).not.toContain("text-white");
  expect(html).not.toContain("brightness-");
}

beforeAll(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  document.body.innerHTML = "";
});

describe("sources", () => {
  for (const file of FILES) {
    test(`${file}.tsx carries the fusion header and no SpaceUI leftovers`, async () => {
      const source = await Bun.file(join(import.meta.dir, "..", "src", `${file}.tsx`)).text();
      expect(source.startsWith("// SPDX-License-Identifier: Apache-2.0 AND MIT\n")).toBe(true);
      expect(source).toContain(`packages/aphrody-spaceui/packages/primitives/src/${file}`);
      expect(source).not.toMatch(SPACEUI_VOCABULARY);
      expect(source).not.toMatch(/phosphor-icons|framer-motion|react-spring|text-white|brightness-/);
    });
  }
});

describe("Dialog", () => {
  test("keeps the imperative API", () => {
    const { dialogManager, useDialog, Dialogs, Dialog } = DialogModule;
    for (const method of [
      "create",
      "getState",
      "setState",
      "subscribe",
      "subscribeGlobal",
      "remove",
      "isAnyDialogOpen",
    ] as const) {
      expect(typeof dialogManager[method]).toBe("function");
    }
    expect(typeof useDialog).toBe("function");
    expect(typeof Dialogs).toBe("function");
    expect(typeof Dialog).toBe("function");
    for (const part of [
      "DialogRoot",
      "DialogTrigger",
      "DialogPortal",
      "DialogClose",
      "DialogOverlay",
      "DialogContent",
      "DialogHeader",
      "DialogFooter",
      "DialogTitle",
      "DialogDescription",
    ] as const) {
      expect(DialogModule[part]).toBeDefined();
    }
  });

  test("renders an M3 basic dialog through dialogManager and removes it after the exit motion", async () => {
    const { dialogManager, useDialog, Dialogs, Dialog } = DialogModule;

    function DeleteDialog(props: { id: number }) {
      const form = useForm();
      const dialog = useDialog(props);
      return (
        <Dialog
          form={form}
          dialog={dialog}
          title="Delete file?"
          icon="delete"
          description="This cannot be undone."
          ctaLabel="Delete"
          ctaDanger
          cancelBtn
        />
      );
    }

    let closed = false;
    let id = 0;
    const html = await render(<Dialogs />);
    expect(html).toBe("<div></div>");
    await act(async () => {
      void (async () => {
        await dialogManager.create(props => {
          id = props.id;
          return <DeleteDialog id={props.id} />;
        });
        closed = true;
      })();
    });
    await act(async () => {
      await sleep(20);
    });
    const open = document.body.innerHTML;
    expectM3(open);
    expect(open).toContain("bg-scrim/32");
    expect(open).toContain("bg-surface-container-high");
    expect(open).toContain("rounded-extra-large");
    expect(open).toContain("shadow-md3-3");
    expect(open).toContain("text-headline-small");
    expect(open).toContain("text-body-medium text-on-surface-variant");
    expect(open).toContain("text-secondary");
    expect(open).toContain(">delete</span>");
    expect(open).toContain("Delete file?");
    // Actions are M3 text buttons, the destructive one in `error`.
    expect(open).toContain("text-primary");
    expect(open).toContain("text-error");
    expect(open).toContain("rounded-full");
    expect(dialogManager.isAnyDialogOpen()).toBe(true);

    await act(async () => {
      dialogManager.setState(id, { open: false });
    });
    await act(async () => {
      await sleep(600);
    });
    expect(dialogManager.getState(id)).toBeUndefined();
    await act(async () => {
      await sleep(150);
    });
    expect(closed).toBe(true);
  });

  test("composable parts use M3 anatomy", async () => {
    const { DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = DialogModule;
    const html = await render(
      <DialogRoot open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Body</DialogDescription>
          </DialogHeader>
          <DialogFooter>actions</DialogFooter>
        </DialogContent>
      </DialogRoot>,
    );
    expectM3(html);
    expect(html).toContain("rounded-extra-large");
    expect(html).toContain("bg-surface-container-high");
    expect(html).toContain("text-headline-small");
    expect(html).toContain(">close</span>");
    expect(html).toContain("justify-end");
  });
});

describe("Popover", () => {
  test("renders an M3 surface", async () => {
    const { Popover, PopoverContent, usePopover } = PopoverModule;
    expect(typeof usePopover).toBe("function");
    expect(Popover.Content).toBe(PopoverContent);
    const html = await render(
      <Popover.Root open>
        <Popover.Trigger>open</Popover.Trigger>
        <Popover.Content>Popover body</Popover.Content>
      </Popover.Root>,
    );
    expectM3(html);
    expect(html).toContain("Popover body");
    expect(html).toContain("bg-surface-container");
    expect(html).toContain("rounded-medium");
    expect(html).toContain("shadow-md3-2");
    expect(html).toContain("text-on-surface");
  });
});

describe("Tooltip", () => {
  test("renders a plain tooltip with keybind chips", async () => {
    const { Tooltip, TooltipProvider, Kbd } = TooltipModule;
    const html = await render(
      <TooltipProvider>
        <Tooltip label="Copy" keybinds={["⌘", "C"]} open>
          <button type="button">copy</button>
        </Tooltip>
      </TooltipProvider>,
    );
    expectM3(html);
    expect(html).toContain("bg-inverse-surface");
    expect(html).toContain("text-inverse-on-surface");
    expect(html).toContain("text-body-small");
    expect(html).toContain("rounded-extra-small");
    expect(html).toContain("min-h-6");
    expect(html).toContain("text-label-small");
    expect(renderToStaticMarkup(<Kbd>K</Kbd>)).toContain("text-inverse-on-surface");
  });
});

describe("DropdownMenu", () => {
  test("renders an M3 menu", async () => {
    const { DropdownMenu } = DropdownMenuModule;
    for (const key of [
      "Root",
      "Trigger",
      "Content",
      "Item",
      "CheckboxItem",
      "RadioItem",
      "Label",
      "Separator",
      "Group",
      "Portal",
      "Sub",
      "SubTrigger",
      "SubContent",
      "RadioGroup",
    ] as const) {
      expect(DropdownMenu[key]).toBeDefined();
    }
    const html = await render(
      <DropdownMenu.Root open>
        <DropdownMenu.Trigger>menu</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Label>Label</DropdownMenu.Label>
          <DropdownMenu.Item>Open</DropdownMenu.Item>
          <DropdownMenu.CheckboxItem checked>Pinned</DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator />
          <DropdownMenu.RadioGroup value="a">
            <DropdownMenu.RadioItem value="a">A</DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>More</DropdownMenu.SubTrigger>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    );
    expectM3(html);
    expect(html).toContain("bg-surface-container");
    expect(html).toContain("rounded-extra-small");
    expect(html).toContain("shadow-md3-2");
    expect(html).toContain("min-w-[112px]");
    expect(html).toContain("max-w-[280px]");
    expect(html).toContain("text-label-large");
    expect(html).toContain("data-[highlighted]:bg-on-surface/8");
    expect(html).toContain("h-px bg-outline-variant");
    expect(html).toContain(">check</span>");
    expect(html).toContain(">radio_button_checked</span>");
    expect(html).toContain(">chevron_right</span>");
  });
});

describe("ContextMenu", () => {
  test("keeps the object API and class helpers", () => {
    const {
      ContextMenu,
      ContextMenuDivItem,
      useContextMenuContext,
      contextMenuClassNames,
      contextMenuItemClassNames,
      contextMenuSeparatorClassNames,
    } = ContextMenuModule;
    expect(Object.keys(ContextMenu).toSorted()).toEqual(["CheckboxItem", "Item", "Root", "Separator", "SubMenu"]);
    expect(typeof useContextMenuContext).toBe("function");
    expect(contextMenuClassNames).toContain("bg-surface-container");
    expect(contextMenuClassNames).toContain("rounded-extra-small");
    expect(contextMenuClassNames).toContain("shadow-md3-2");
    expect(contextMenuClassNames).toContain("py-2");
    expect(contextMenuItemClassNames).toContain("group");
    expect(contextMenuSeparatorClassNames).toBe("my-2 h-px bg-outline-variant");
    const danger = renderToStaticMarkup(
      <ContextMenuDivItem variant="danger" label="Delete" icon="delete" keybind="⌘⌫" />,
    );
    expect(danger).toContain("text-error");
    expect(danger).toContain(">delete</span>");
    expect(danger).toContain("text-label-large text-on-surface-variant");
    const dull = renderToStaticMarkup(<ContextMenuDivItem variant="dull" label="Dull" rightArrow />);
    expect(dull).toContain("text-on-surface-variant");
    expect(dull).toContain(">chevron_right</span>");
    const legacy = renderToStaticMarkup(
      <ContextMenuDivItem label="Legacy" icon={Legacy} iconProps={{ weight: "bold" }} />,
    );
    expect(legacy).toContain("data-legacy");
    expectM3(danger + dull + legacy);
  });

  test("opens on contextmenu as an M3 menu", async () => {
    const { ContextMenu } = ContextMenuModule;
    await render(
      <ContextMenu.Root trigger={<div data-testid="target">target</div>}>
        <ContextMenu.Item label="Rename" icon="edit" keybind="F2" />
        <ContextMenu.Separator />
        <ContextMenu.CheckboxItem checked label="Show hidden" />
        <ContextMenu.Item label="Delete" variant="danger" />
      </ContextMenu.Root>,
    );
    const target = document.querySelector("[data-testid=target]") as HTMLElement;
    await act(async () => {
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    await act(async () => {
      await sleep(20);
    });
    const html = document.body.innerHTML;
    expectM3(html);
    expect(html).toContain("Rename");
    expect(html).toContain(">edit</span>");
    expect(html).toContain(">check</span>");
    expect(html).toContain("text-error");
    expect(html).toContain("shadow-md3-2");
  });
});

describe("Dropdown (Base UI Menu)", () => {
  test("keeps the upstream exports and renders an M3 menu", async () => {
    const { Root, Button, Item, Section, Separator } = DropdownModule;
    expect(Root).toBeDefined();
    expect(Button).toBeDefined();
    expect(Item).toBeDefined();
    expect(Section).toBeDefined();
    expect(Separator).toBeDefined();
    await render(
      <Root button={<span data-testid="button">Sort</span>}>
        <Section>
          <Item icon="sort" selected>
            Name
          </Item>
          <Item icon="schedule">Date</Item>
        </Section>
        <Separator />
      </Root>,
    );
    const trigger = document.querySelector("[data-testid=button]")?.parentElement as HTMLElement;
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      await sleep(50);
    });
    const html = document.body.innerHTML;
    expectM3(html);
    expect(html).toContain("bg-surface-container");
    expect(html).toContain("rounded-extra-small");
    expect(html).toContain("shadow-md3-2");
    expect(html).toContain("bg-secondary-container text-on-secondary-container");
    expect(html).toContain(">sort</span>");
  });
});

describe("Toast", () => {
  test("keeps the upstream API", () => {
    const { toast, Toaster, TOAST_TIMEOUT } = ToastModule;
    expect(TOAST_TIMEOUT).toBe(4000);
    expect(Toaster).toBeDefined();
    for (const key of ["info", "success", "error", "warning", "custom", "promise", "dismiss"] as const) {
      expect(typeof toast[key]).toBe("function");
    }
  });

  test("renders M3 snackbars, including the promise flow", async () => {
    const { toast, Toaster } = ToastModule;
    await render(<Toaster />);
    let resolve!: (value: string) => void;
    await act(async () => {
      toast.success({ title: "Saved", body: "All changes stored" }, { action: { label: "Undo", onClick: () => {} } });
      toast.promise(new Promise<string>(r => (resolve = r)), {
        loading: "Uploading",
        success: name => `Uploaded ${name}`,
        error: "Failed",
      });
    });
    await act(async () => {
      await sleep(50);
    });
    let html = document.body.innerHTML;
    expectM3(html);
    expect(html).toContain("bg-inverse-surface");
    expect(html).toContain("text-inverse-on-surface");
    expect(html).toContain("rounded-extra-small");
    expect(html).toContain("min-h-12");
    expect(html).toContain("shadow-md3-3");
    expect(html).toContain("text-inverse-primary");
    expect(html).toContain(">check_circle</span>");
    expect(html).toContain(">close</span>");
    expect(html).toContain("Undo");
    expect(html).toContain("Uploading");
    expect(html).toContain('role="progressbar"');

    await act(async () => {
      resolve("a.txt");
      await sleep(50);
    });
    html = document.body.innerHTML;
    expect(html).toContain("Uploaded a.txt");
    await act(async () => {
      toast.dismiss();
      await sleep(20);
    });
  });
});
