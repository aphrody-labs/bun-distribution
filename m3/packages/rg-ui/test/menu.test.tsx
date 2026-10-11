import { afterEach, describe, expect, test } from "bun:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import * as dropdown from "../src/components/dropdown-menu";
import * as context from "../src/components/context-menu";
import * as menubar from "../src/components/menubar";
import * as select from "../src/components/select";
import * as navigation from "../src/components/navigation-menu";

let root: ReturnType<typeof createRoot> | undefined;
async function render(children: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await React.act(async () => root?.render(children));
}
async function click(selector: string) {
  const element = document.querySelector(selector);
  if (!element) throw new Error("Missing interactive element: " + selector);
  await React.act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  return element;
}
async function key(element: Element | null, value: string) {
  if (!element) throw new Error("Missing keyboard target");
  await React.act(async () => {
    (element as HTMLElement).focus();
    element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }));
  });
}
async function waitForElement(selector: string): Promise<Element> {
  const existing = document.querySelector(selector);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearTimeout(deadline);
        observer.disconnect();
        resolve(element);
      }
    });
    const deadline = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Missing " + selector));
    }, 1000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}
afterEach(async () => {
  await React.act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("Bun Base UI shared menu contracts", () => {
  test("asChild preserves trigger events and cancelled onSelect keeps the dropdown open", async () => {
    let pressed = 0;
    let selected = 0;
    await render(
      <dropdown.DropdownMenu>
        <dropdown.DropdownMenuTrigger asChild>
          <button id="trigger" onClick={() => pressed++}>
            Open
          </button>
        </dropdown.DropdownMenuTrigger>
        <dropdown.DropdownMenuContent>
          <dropdown.DropdownMenuItem
            id="keep"
            onSelect={(event) => {
              selected++;
              event.preventDefault();
            }}
          >
            Keep open
          </dropdown.DropdownMenuItem>
          <dropdown.DropdownMenuItem id="finish">Finish</dropdown.DropdownMenuItem>
        </dropdown.DropdownMenuContent>
      </dropdown.DropdownMenu>,
    );
    const trigger = await click("#trigger");
    expect(trigger.tagName).toBe("BUTTON");
    expect(pressed).toBe(1);
    await click("#keep");
    expect(selected).toBe(1);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await click("#finish");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  test("checkbox and radio menu items report the existing scalar callbacks", async () => {
    let checked = false;
    let choice = "a";
    await render(
      <dropdown.DropdownMenu>
        <dropdown.DropdownMenuTrigger>Preferences</dropdown.DropdownMenuTrigger>
        <dropdown.DropdownMenuContent>
          <dropdown.DropdownMenuCheckboxItem
            id="check"
            checked={false}
            onCheckedChange={(value) => {
              checked = value === true;
            }}
          >
            Enabled
          </dropdown.DropdownMenuCheckboxItem>
          <dropdown.DropdownMenuRadioGroup
            value="a"
            onValueChange={(value) => {
              choice = value;
            }}
          >
            <dropdown.DropdownMenuRadioItem id="choice-b" value="b">
              B
            </dropdown.DropdownMenuRadioItem>
          </dropdown.DropdownMenuRadioGroup>
        </dropdown.DropdownMenuContent>
      </dropdown.DropdownMenu>,
    );
    await click('[data-slot="dropdown-menu-trigger"]');
    await click("#check");
    expect(checked).toBe(true);
    if (!document.querySelector("#choice-b")) await click('[data-slot="dropdown-menu-trigger"]');
    await click("#choice-b");
    expect(choice).toBe("b");
  });
  test("a context menu opens a nested submenu through keyboard focus", async () => {
    await render(
      <context.ContextMenu>
        <context.ContextMenuTrigger id="context-target">Right click</context.ContextMenuTrigger>
        <context.ContextMenuContent>
          <context.ContextMenuSub>
            <context.ContextMenuSubTrigger id="nested">Nested</context.ContextMenuSubTrigger>
            <context.ContextMenuSubContent>
              <context.ContextMenuItem id="nested-item">Child</context.ContextMenuItem>
            </context.ContextMenuSubContent>
          </context.ContextMenuSub>
        </context.ContextMenuContent>
      </context.ContextMenu>,
    );
    await React.act(async () =>
      document
        .querySelector("#context-target")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 25 })),
    );
    await key(document.querySelector("#nested"), "ArrowRight");
    await React.act(async () => {
      await waitForElement("#nested-item");
    });
    expect(document.querySelectorAll('[role="menu"]').length).toBe(2);
    await click("#nested-item");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
  test("menubar switches menus through the arrow key", async () => {
    await render(
      <menubar.Menubar>
        <menubar.MenubarMenu>
          <menubar.MenubarTrigger id="first">File</menubar.MenubarTrigger>
          <menubar.MenubarContent>
            <menubar.MenubarItem>New</menubar.MenubarItem>
          </menubar.MenubarContent>
        </menubar.MenubarMenu>
        <menubar.MenubarMenu>
          <menubar.MenubarTrigger id="second">Edit</menubar.MenubarTrigger>
          <menubar.MenubarContent>
            <menubar.MenubarItem id="edit-item">Copy</menubar.MenubarItem>
          </menubar.MenubarContent>
        </menubar.MenubarMenu>
      </menubar.Menubar>,
    );
    await click("#first");
    await key(document.querySelector("#first"), "ArrowRight");
    await React.act(async () => {
      await waitForElement("#edit-item");
    });
    expect(document.querySelector('[role="menu"]')?.textContent).toContain("Copy");
  });
  test("Select renders its selected label before opening and reports string values", async () => {
    let value = "a";
    await render(
      <select.Select
        defaultValue="a"
        onValueChange={(next) => {
          value = next;
        }}
      >
        <select.SelectTrigger>
          <select.SelectValue placeholder="Choose" />
        </select.SelectTrigger>
        <select.SelectContent>
          <select.SelectGroup>
            <select.SelectLabel>Options</select.SelectLabel>
            <select.SelectItem value="a">Alpha</select.SelectItem>
            <select.SelectItem data-item="beta" value="b">
              Beta
            </select.SelectItem>
          </select.SelectGroup>
        </select.SelectContent>
      </select.Select>,
    );
    expect(document.querySelector('[data-slot="select-value"]')?.textContent).toBe("Alpha");
    await click('[data-slot="select-trigger"]');
    await React.act(async () =>
      document.querySelector("[data-item=beta]")?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "mouse",
          button: 0,
          buttons: 1,
        }),
      ),
    );
    await click("[data-item=beta]");
    expect(value).toBe("b");
    expect(document.querySelector('[data-slot="select-value"]')?.textContent).toBe("Beta");
  });
  test("NavigationMenu keeps its portal viewport and link composition interactive", async () => {
    await render(
      <navigation.NavigationMenu>
        <navigation.NavigationMenuList>
          <navigation.NavigationMenuItem value="docs">
            <navigation.NavigationMenuTrigger id="nav-trigger">
              Docs
            </navigation.NavigationMenuTrigger>
            <navigation.NavigationMenuContent>
              <navigation.NavigationMenuLink asChild>
                <a id="nav-link" href="/docs">
                  Documentation
                </a>
              </navigation.NavigationMenuLink>
            </navigation.NavigationMenuContent>
          </navigation.NavigationMenuItem>
        </navigation.NavigationMenuList>
      </navigation.NavigationMenu>,
    );
    await click("#nav-trigger");
    await React.act(async () => {
      await waitForElement("#nav-link");
    });
    expect(document.querySelector("#nav-link")?.tagName).toBe("A");
    expect(document.querySelector('[data-slot="navigation-menu-viewport"]')).not.toBeNull();
    await key(document.querySelector("#nav-link"), "Escape");
    expect(document.querySelector("#nav-link")).toBeNull();
  });
});
