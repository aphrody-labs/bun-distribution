import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { DropdownMenu, renderIcon, type IconSource } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

interface ContextMenuItem {
  type?: "separator" | "submenu";
  icon?: IconSource;
  label?: string;
  onClick?: () => void;
  keybind?: string;
  variant?: "default" | "dull" | "danger";
  disabled?: boolean;
  submenu?: ContextMenuItem[];
}

interface MenuState {
  items: ContextMenuItem[];
  x: number;
  y: number;
}

interface WebContextMenuController {
  show: (items: ContextMenuItem[], x: number, y: number) => void;
  close: () => void;
}

const ControllerContext = createContext<WebContextMenuController | null>(null);

export function useWebContextMenuController(): WebContextMenuController | null {
  return useContext(ControllerContext);
}

export function WebContextMenuProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<MenuState | null>(null);

  const show = useCallback((items: ContextMenuItem[], x: number, y: number) => {
    // If a menu is already open, close it first so the anchor updates
    // at the new cursor position on the next tick.
    setState(null);
    requestAnimationFrame(() => setState({ items, x, y }));
  }, []);

  const close = useCallback(() => setState(null), []);
  const controller = useMemo(() => ({ show, close }), [show, close]);

  return (
    <ControllerContext.Provider value={controller}>
      {children}
      <WebContextMenu state={state} onClose={close} />
    </ControllerContext.Provider>
  );
}

function WebContextMenu({ state, onClose }: { state: MenuState | null; onClose: () => void }) {
  return (
    <DropdownMenu.Root open={state !== null} onOpenChange={open => !open && onClose()}>
      <DropdownMenu.Trigger asChild>
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: state?.x ?? 0,
            top: state?.y ?? 0,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="bg-surface-container border-outline-variant z-[100] min-w-[200px] rounded-small border py-1 shadow-md3-5"
          sideOffset={2}
          align="start"
          collisionPadding={8}
        >
          {state && renderItems(state.items)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function renderItems(items: ContextMenuItem[]) {
  return items.map((item, index) => {
    const key = `${index}-${item.label ?? item.type ?? "item"}`;

    if (item.type === "separator") {
      return <DropdownMenu.Separator key={key} className="bg-outline-variant mx-1 my-1 h-px" />;
    }

    if (item.submenu && item.submenu.length > 0) {
      return (
        <DropdownMenu.Sub key={key}>
          <DropdownMenu.SubTrigger disabled={item.disabled} className={menuItemClasses(item)}>
            <MenuItemInner item={item} />
            <CaretRight className="text-on-surface-variant ml-auto size-3 shrink-0" weight="bold" />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent
              className="bg-surface-container border-outline-variant z-[100] min-w-[200px] rounded-small border py-1 shadow-md3-5"
              sideOffset={4}
              alignOffset={-4}
            >
              {renderItems(item.submenu)}
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      );
    }

    return (
      <DropdownMenu.Item
        key={key}
        disabled={item.disabled}
        onSelect={() => item.onClick?.()}
        className={menuItemClasses(item)}
      >
        <MenuItemInner item={item} />
      </DropdownMenu.Item>
    );
  });
}

function menuItemClasses(item: ContextMenuItem) {
  const variant = item.variant ?? "default";
  return clsx(
    "mx-1 flex items-center gap-2 rounded-small px-2 py-1 text-body-medium outline-none",
    variant === "danger" && "text-error",
    variant === "dull" && "text-on-surface-variant",
    variant === "default" && "text-on-surface",
    item.disabled ? "cursor-not-allowed opacity-50" : "data-[highlighted]:bg-on-surface/8 cursor-pointer",
  );
}

function MenuItemInner({ item }: { item: ContextMenuItem }) {
  return (
    <>
      {item.icon ? renderIcon(item.icon, { className: "size-4 shrink-0" }) : null}
      <span className="flex-1 truncate text-left">{item.label}</span>
      {item.keybind ? <span className="text-on-surface-variant ml-2 text-body-small">{item.keybind}</span> : null}
    </>
  );
}
