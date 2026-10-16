// SPDX-License-Identifier: Apache-2.0
// Benchmark: assets/ui/gemini-account-menu.png & gemini-composer-more-uploads.png
// Anchored account menu and composer actions menu matching Google Gemini Web UI

"use client";

import { Icon, Popover } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import type { ReactNode } from "react";

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  onClick?: () => void;
  destructive?: boolean;
  dividerAfter?: boolean;
}

export interface GeminiAccountMenuProps {
  /** User name */
  name: string;
  /** User email */
  email: string;
  /** Avatar image URL or fallback initials */
  avatar?: ReactNode;
  /** Menu open state */
  open: boolean;
  /** Menu open state change */
  onOpenChange: (open: boolean) => void;
  /** Menu items */
  items?: MenuItem[];
  /** Trigger element */
  children: ReactNode;
  /** Additional container class */
  className?: string;
}

const EMPTY_MENU_ITEMS: MenuItem[] = [];

/**
 * Gemini Sidebar Footer Account Menu.
 * Benchmark parity: `assets/ui/gemini-account-menu.png` (manifest item 2).
 * Anchored to the sidebar footer avatar/profile card, displaying Google account
 * details and navigation links with M3 typography, icons, and keyboard-reachable rows.
 */
export function GeminiAccountMenu({
  name,
  email,
  avatar,
  open,
  onOpenChange,
  items = EMPTY_MENU_ITEMS,
  children,
  className,
}: GeminiAccountMenuProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Content
        align="start"
        side="top"
        sideOffset={8}
        className={clsx(
          "gemini-account-menu w-[300px] overflow-hidden rounded-[var(--gemini-corner-card,16px)]",
          "border border-outline-variant/40 bg-surface-container p-2 text-on-surface shadow-md3-3",
          className,
        )}
      >
        {/* User Card Header */}
        <div className="flex items-center gap-3 rounded-small bg-surface-container-high p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-title-medium text-on-primary-container">
            {avatar ?? name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-body-medium font-medium text-on-surface">
              {name}
            </div>
            <div className="truncate text-body-small text-on-surface-variant">
              {email}
            </div>
          </div>
        </div>

        {/* Action Items List */}
        <div className="mt-2 space-y-0.5" role="menu">
          {items.map((item) => (
            <div key={item.id}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onClick?.();
                  onOpenChange(false);
                }}
                className={clsx(
                  "flex w-full items-center justify-between rounded-small px-3 py-2 text-body-medium transition-colors",
                  "hover:bg-on-surface/8 active:bg-on-surface/12",
                  item.destructive
                    ? "text-error hover:bg-error/8"
                    : "text-on-surface hover:text-on-surface",
                )}
              >
                <div className="flex items-center gap-3">
                  {item.icon && (
                    <Icon
                      name={item.icon}
                      size={20}
                      className={
                        item.destructive
                          ? "text-error"
                          : "text-on-surface-variant"
                      }
                    />
                  )}
                  <span>{item.label}</span>
                </div>
                {item.shortcut && (
                  <span className="text-label-small text-on-surface-variant">
                    {item.shortcut}
                  </span>
                )}
              </button>
              {item.dividerAfter && (
                <div className="my-1 border-t border-outline-variant/30" />
              )}
            </div>
          ))}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}

export interface ComposerMoreUploadsMenuProps {
  /** Menu open state */
  open: boolean;
  /** Menu open state change */
  onOpenChange: (open: boolean) => void;
  /** Items in upload/add menu */
  items: MenuItem[];
  /** Submenu items (e.g., More uploads / Google Drive / Workspace) */
  submenuItems?: MenuItem[];
  /** Trigger element */
  children: ReactNode;
}

/**
 * Composer Add & More Uploads Menu.
 * Benchmark parity: `assets/ui/gemini-composer-more-uploads.png` (manifest item 3).
 * Anchored to the '+' trigger of the composer, grouping related upload actions
 * with an optional adjacent secondary submenu.
 */
export function ComposerMoreUploadsMenu({
  open,
  onOpenChange,
  items,
  submenuItems,
  children,
}: ComposerMoreUploadsMenuProps) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Content
        align="start"
        side="top"
        sideOffset={10}
        className="gemini-composer-uploads-menu flex gap-2 rounded-[var(--gemini-corner-card,16px)] border border-outline-variant/30 bg-surface-container p-1.5 shadow-md3-3"
      >
        {/* Primary Menu */}
        <div className="w-[220px] space-y-0.5" role="menu">
          {items.map((item) => (
            <div key={item.id}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  item.onClick?.();
                  onOpenChange(false);
                }}
                className="flex w-full items-center gap-3 rounded-small px-3 py-2 text-body-medium text-on-surface transition-colors hover:bg-on-surface/8"
              >
                {item.icon && (
                  <Icon
                    name={item.icon}
                    size={20}
                    className="text-on-surface-variant"
                  />
                )}
                <span className="flex-1 text-left">{item.label}</span>
              </button>
              {item.dividerAfter && (
                <div className="my-1 border-t border-outline-variant/30" />
              )}
            </div>
          ))}
        </div>

        {/* Secondary Submenu if provided */}
        {submenuItems && submenuItems.length > 0 && (
          <div
            className="w-[200px] border-l border-outline-variant/20 pl-2 space-y-0.5"
            role="menu"
            aria-label="More uploads"
          >
            <div className="px-2 py-1 text-label-small font-medium text-on-surface-variant uppercase tracking-wider">
              Cloud & Storage
            </div>
            {submenuItems.map((sub) => (
              <button
                key={sub.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  sub.onClick?.();
                  onOpenChange(false);
                }}
                className="flex w-full items-center gap-3 rounded-small px-3 py-2 text-body-medium text-on-surface transition-colors hover:bg-on-surface/8"
              >
                {sub.icon && (
                  <Icon name={sub.icon} size={20} className="text-primary" />
                )}
                <span className="flex-1 text-left">{sub.label}</span>
              </button>
            ))}
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
