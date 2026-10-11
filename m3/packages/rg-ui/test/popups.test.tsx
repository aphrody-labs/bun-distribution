import { afterEach, describe, expect, test } from "bun:test";
import * as React from "react";

const { createRoot } = await import("react-dom/client");
const dialog = await import("../src/components/dialog");
const sheet = await import("../src/components/sheet");
const alert = await import("../src/components/alert-dialog");
const popover = await import("../src/components/popover");
const hover = await import("../src/components/hover-card");
const tooltip = await import("../src/components/tooltip");
let root: ReturnType<typeof createRoot> | undefined;

async function render(children: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await React.act(async () => root?.render(children));
}

async function click(element: Element | null) {
  if (!element) throw new Error("Missing interactive element");
  await React.act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function waitForElement(selector: string): Promise<Element> {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Missing ${selector}`));
    }, 1000);
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve(element);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}

afterEach(async () => {
  await React.act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("Base UI popup compatibility", () => {
  test("Dialog forceMount retains an inert closed popup", async () => {
    await render(
      <dialog.Dialog>
        <dialog.DialogTrigger>Open retained dialog</dialog.DialogTrigger>
        <dialog.DialogContent forceMount showCloseButton={false}>
          <dialog.DialogTitle>Retained dialog</dialog.DialogTitle>
          <dialog.DialogDescription>Retained description</dialog.DialogDescription>
        </dialog.DialogContent>
      </dialog.Dialog>,
    );
    const popup = document.querySelector('[data-slot="dialog-content"]');
    expect(popup).not.toBeNull();
    expect(popup?.hasAttribute("data-closed")).toBe(true);
    expect(popup?.hasAttribute("hidden")).toBe(true);
  });

  test("Dialog composes asChild handlers, labels the popup and restores trigger focus", async () => {
    let pressed = 0;
    await render(
      <dialog.Dialog>
        <dialog.DialogTrigger asChild>
          <button id="open-dialog" onClick={() => pressed++}>
            Open
          </button>
        </dialog.DialogTrigger>
        <dialog.DialogContent showCloseButton={false}>
          <dialog.DialogTitle>Dialog title</dialog.DialogTitle>
          <dialog.DialogDescription>Dialog description</dialog.DialogDescription>
          <dialog.DialogClose asChild>
            <button id="close-dialog">Close</button>
          </dialog.DialogClose>
        </dialog.DialogContent>
      </dialog.Dialog>,
    );
    const trigger = document.querySelector("#open-dialog");
    expect(trigger?.parentElement?.tagName).not.toBe("BUTTON");
    await click(trigger);
    expect(pressed).toBe(1);
    const popup = document.querySelector('[role="dialog"]');
    expect(popup?.hasAttribute("data-open")).toBe(true);
    expect(document.getElementById(popup?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
      "Dialog title",
    );
    await click(document.querySelector("#close-dialog"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("Sheet keeps its edge placement and Escape dismissal", async () => {
    await render(
      <sheet.Sheet>
        <sheet.SheetTrigger>Open sheet</sheet.SheetTrigger>
        <sheet.SheetContent side="left">
          <sheet.SheetTitle>Sheet title</sheet.SheetTitle>
          <sheet.SheetDescription>Sheet description</sheet.SheetDescription>
        </sheet.SheetContent>
      </sheet.Sheet>,
    );
    const trigger = document.querySelector('[data-slot="sheet-trigger"]');
    await click(trigger);
    const popup = document.querySelector('[data-slot="sheet-content"]');
    expect(popup?.classList.contains("left-0")).toBe(true);
    await React.act(async () => {
      popup?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("AlertDialog focuses Cancel before its destructive action and closes through either action", async () => {
    let actions = 0;
    await render(
      <alert.AlertDialog>
        <alert.AlertDialogTrigger>Delete</alert.AlertDialogTrigger>
        <alert.AlertDialogContent>
          <alert.AlertDialogTitle>Delete record?</alert.AlertDialogTitle>
          <alert.AlertDialogDescription>This removes the record.</alert.AlertDialogDescription>
          <alert.AlertDialogAction onClick={() => actions++}>Confirm</alert.AlertDialogAction>
          <alert.AlertDialogCancel>Cancel</alert.AlertDialogCancel>
        </alert.AlertDialogContent>
      </alert.AlertDialog>,
    );
    const trigger = document.querySelector('[data-slot="alert-dialog-trigger"]');
    await click(trigger);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector('[data-slot="alert-dialog-cancel"]'),
    );
    await click(document.querySelector('[data-slot="alert-dialog-cancel"]'));
    expect(actions).toBe(0);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await click(trigger);
    await click(document.querySelector('[data-slot="alert-dialog-action"]'));
    expect(actions).toBe(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test("Popover composes its anchor ref and routes placement through Positioner", async () => {
    const anchorRef = React.createRef<HTMLDivElement>();
    await render(
      <popover.Popover>
        <popover.PopoverAnchor ref={anchorRef}>
          <span>Anchor</span>
        </popover.PopoverAnchor>
        <popover.PopoverTrigger>Open popover</popover.PopoverTrigger>
        <popover.PopoverContent side="top" align="start" sideOffset={12}>
          <popover.PopoverTitle>Popover title</popover.PopoverTitle>
          <popover.PopoverDescription>Popover description</popover.PopoverDescription>
        </popover.PopoverContent>
      </popover.Popover>,
    );
    expect(anchorRef.current).toBe(document.querySelector('[data-slot="popover-anchor"]'));
    await click(document.querySelector('[data-slot="popover-trigger"]'));
    const popup = document.querySelector('[data-slot="popover-content"]');
    expect(popup).not.toBeNull();
    expect(popup?.hasAttribute("sideOffset")).toBe(false);
    expect(popup?.parentElement?.style.position).toBe("absolute");
    expect(document.getElementById(popup?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
      "Popover title",
    );
  });

  test("HoverCard preserves root delays and a custom anchor trigger", async () => {
    await render(
      <hover.HoverCard openDelay={1} closeDelay={1}>
        <hover.HoverCardTrigger asChild>
          <a href="/article">Article</a>
        </hover.HoverCardTrigger>
        <hover.HoverCardContent>Article preview</hover.HoverCardContent>
      </hover.HoverCard>,
    );
    const trigger = document.querySelector('[data-slot="hover-card-trigger"]');
    expect(trigger?.tagName).toBe("A");
    await React.act(async () => {
      trigger?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      await waitForElement('[data-slot="hover-card-content"]');
    });
    expect(document.querySelector('[data-slot="hover-card-content"]')?.textContent).toBe(
      "Article preview",
    );
  });

  test("Tooltip preserves provider timing and opens on keyboard focus", async () => {
    await render(
      <tooltip.TooltipProvider delayDuration={25} skipDelayDuration={100}>
        <tooltip.Tooltip delayDuration={0}>
          <tooltip.TooltipTrigger asChild>
            <button id="tooltip-button">Help</button>
          </tooltip.TooltipTrigger>
          <tooltip.TooltipContent side="right">Keyboard help</tooltip.TooltipContent>
        </tooltip.Tooltip>
      </tooltip.TooltipProvider>,
    );
    await React.act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      (document.querySelector("#tooltip-button") as HTMLElement).focus();
    });
    expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toBe(
      "Keyboard help",
    );
  });
});
