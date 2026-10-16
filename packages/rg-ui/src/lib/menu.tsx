"use client";

import { Menu } from "@base-ui/react/menu";
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menubar } from "@base-ui/react/menubar";
import type { ComponentProps } from "react";
import { childRender, type PrimitiveProps } from "./render";

type Position = Pick<
  ComponentProps<typeof Menu.Positioner>,
  "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding" | "collisionBoundary"
>;
type ContentProps = PrimitiveProps<typeof Menu.Popup> & Position;

function Trigger({ asChild, children, render, nativeButton, ...props }: PrimitiveProps<typeof Menu.Trigger>) {
  const child = childRender(asChild, children);
  return (
    <Menu.Trigger
      {...props}
      nativeButton={nativeButton ?? (!child || child.type === "button")}
      render={child ?? render}
    >
      {asChild ? undefined : children}
    </Menu.Trigger>
  );
}

function ContextTrigger({ asChild, children, render, ...props }: PrimitiveProps<typeof ContextMenu.Trigger>) {
  return (
    <ContextMenu.Trigger {...props} render={childRender(asChild, children) ?? render}>
      {asChild ? undefined : children}
    </ContextMenu.Trigger>
  );
}

function Content({
  side,
  align = "start",
  sideOffset,
  alignOffset,
  collisionPadding,
  collisionBoundary,
  asChild,
  children,
  render,
  ...props
}: ContentProps) {
  return (
    <Menu.Positioner
      className="z-50"
      {...{ side, align, sideOffset, alignOffset, collisionPadding, collisionBoundary }}
    >
      <Menu.Popup {...props} render={childRender(asChild, children) ?? render}>
        {asChild ? undefined : children}
      </Menu.Popup>
    </Menu.Positioner>
  );
}

function ContextContent({
  side,
  align = "start",
  sideOffset,
  alignOffset,
  collisionPadding,
  collisionBoundary,
  asChild,
  children,
  render,
  ...props
}: ContentProps) {
  return (
    <ContextMenu.Positioner
      className="z-50"
      {...{ side, align, sideOffset, alignOffset, collisionPadding, collisionBoundary }}
    >
      <ContextMenu.Popup {...props} render={childRender(asChild, children) ?? render}>
        {asChild ? undefined : children}
      </ContextMenu.Popup>
    </ContextMenu.Positioner>
  );
}

function SubContent(props: ContentProps) {
  return (
    <Menu.Portal>
      <Content side="inline-end" align="start" {...props} />
    </Menu.Portal>
  );
}

type ItemProps = PrimitiveProps<typeof Menu.Item> & { onSelect?: (event: Event) => void };

function Item({ asChild, children, render, onSelect, onClick, ...props }: ItemProps) {
  const handleClick: ComponentProps<typeof Menu.Item>["onClick"] = event => {
    onClick?.(event);
    if (event.defaultPrevented) return event.preventBaseUIHandler();
    if (onSelect) {
      const selected = new Event("menu.itemSelect", { cancelable: true });
      onSelect(selected);
      if (selected.defaultPrevented) {
        event.preventDefault();
        event.preventBaseUIHandler();
      }
    }
  };
  return (
    <Menu.Item {...props} onClick={handleClick} render={childRender(asChild, children) ?? render}>
      {asChild ? undefined : children}
    </Menu.Item>
  );
}

function SubTrigger({ asChild, children, render, ...props }: PrimitiveProps<typeof Menu.SubmenuTrigger>) {
  return (
    <Menu.SubmenuTrigger {...props} render={childRender(asChild, children) ?? render}>
      {asChild ? undefined : children}
    </Menu.SubmenuTrigger>
  );
}

const parts = {
  Portal: Menu.Portal,
  Trigger,
  Content,
  Group: Menu.Group,
  Item,
  CheckboxItem: Menu.CheckboxItem,
  CheckboxItemIndicator: Menu.CheckboxItemIndicator,
  RadioGroup: Menu.RadioGroup,
  RadioItem: Menu.RadioItem,
  RadioItemIndicator: Menu.RadioItemIndicator,
  Separator: Menu.Separator,
  Sub: Menu.SubmenuRoot,
  SubTrigger,
  SubContent,
};

export const DropdownMenuParts = { ...parts, Root: Menu.Root };
export const ContextMenuParts = {
  ...parts,
  Root: ContextMenu.Root,
  Trigger: ContextTrigger,
  Content: ContextContent,
};
export const MenubarParts = { ...parts, Root: Menubar, Menu: Menu.Root };
