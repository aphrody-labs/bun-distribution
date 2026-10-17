// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/primitives/src/TabBar.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { m3Durations, m3Easings, useM3ReducedMotion } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import { forwardRef } from "react";
import { LayoutGroup, motion } from "motion/react";

import { Icon } from "./Icon";
import { m3FocusRing, m3StateLayer } from "./utils";

// ─── TabBar Container ────────────────────────────────────────────────────────

export interface TabBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Unique layout group ID for the active-indicator animation (motion `LayoutGroup`) */
  layoutId?: string;
  /** Element rendered after the tab list (e.g. a "new tab" button) */
  trailing?: React.ReactNode;
}

function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.defaultPrevented) return;

  const target = event.target;
  if (!(target instanceof Element)) return;
  const current = target.closest<HTMLButtonElement>('button[role="tab"]');
  if (!current || !event.currentTarget.contains(current)) return;

  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)'));
  const index = tabs.indexOf(current);
  if (index < 0) return;

  let nextIndex: number;
  switch (event.key) {
    case "ArrowRight":
      nextIndex = (index + 1) % tabs.length;
      break;
    case "ArrowLeft":
      nextIndex = (index - 1 + tabs.length) % tabs.length;
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = tabs.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  const next = tabs[nextIndex];
  next.focus();
  if (next !== current) next.click();
}

/** M3 primary tabs on `surface`, with the `outline-variant` bottom divider. */
export const TabBar = forwardRef<HTMLDivElement, TabBarProps>(
  ({ layoutId = "tab-bar", trailing, className, children, ...props }, ref) => (
    <div
      ref={ref}
      data-m3-component="TabBar"
      className={clsx("flex h-10 shrink-0 items-stretch gap-1 border-b border-outline-variant bg-surface", className)}
      {...props}
    >
      <LayoutGroup id={layoutId}>
        <div
          role="tablist"
          aria-label="Open tabs"
          tabIndex={-1}
          onKeyDown={handleTabKeyDown}
          className="flex min-w-0 flex-1 items-stretch"
        >
          {children}
        </div>
      </LayoutGroup>
      {trailing && <div className="flex items-center">{trailing}</div>}
    </div>
  ),
);

TabBar.displayName = "TabBar";

// ─── TabBarItem ──────────────────────────────────────────────────────────────

export interface TabBarItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Whether this tab is currently active */
  active?: boolean;
  /** Tab label */
  label: string;
  /** Called when the close button is clicked */
  onClose?: () => void;
  /** Show close button (default: true when onClose is provided) */
  closable?: boolean;
  /** Close button element — override to provide your own icon */
  closeIcon?: React.ReactNode;
}

/**
 * M3 primary tab: `label-large`, `primary` when active and `on-surface-variant` otherwise, 3 dp
 * `primary` active indicator with rounded top corners that slides between tabs.
 */
export const TabBarItem = forwardRef<HTMLButtonElement, TabBarItemProps>(
  ({ active, label, onClose, closable, closeIcon, className, ...props }, ref) => {
    const reduced = useM3ReducedMotion();
    const showClose = closable ?? !!onClose;

    return (
      <div className={clsx("group relative flex min-w-0 flex-1 items-stretch justify-center", className)}>
        <button
          ref={ref}
          type="button"
          role="tab"
          aria-selected={!!active}
          tabIndex={active ? 0 : -1}
          className={clsx(
            "flex w-full min-w-0 items-center justify-center text-label-large",
            "transition-colors duration-200 ease-standard",
            m3StateLayer,
            m3FocusRing,
            active ? "text-primary" : "text-on-surface-variant hover:text-on-surface",
          )}
          {...props}
        >
          <span className="relative truncate px-6">{label}</span>
          {active && (
            <motion.div
              layoutId={reduced ? undefined : "activeTab"}
              className="absolute inset-x-4 bottom-0 h-[3px] rounded-t-full bg-primary"
              initial={false}
              transition={{
                duration: reduced ? 0 : m3Durations.medium2,
                ease: m3Easings.emphasized,
              }}
            />
          )}
        </button>
        {showClose && active && (
          <button
            type="button"
            aria-label="Close tab"
            onClick={e => {
              e.stopPropagation();
              onClose?.();
            }}
            className={clsx(
              "absolute left-1.5 top-1/2 z-10 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full",
              "text-on-surface-variant transition-colors duration-200 ease-standard",
              "hover:bg-on-surface/8 hover:text-on-surface active:bg-on-surface/10",
              m3FocusRing,
            )}
            title="Close tab"
          >
            {closeIcon ?? <Icon name="close" size={16} />}
          </button>
        )}
      </div>
    );
  },
);

TabBarItem.displayName = "TabBarItem";
