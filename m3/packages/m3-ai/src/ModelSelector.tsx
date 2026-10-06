// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/ModelSelector.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { Popover, usePopover, SelectPill, type SelectPillProps } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";

import { type ChatLabels, formatLabel, resolveChatLabels } from "./chatLabels";
import { ChatIcon } from "./chatIcons";
import { focusRing } from "./internal";
import type { ModelOption } from "./types";

export interface ModelSelectorProps {
  /** Available models */
  models: ModelOption[];
  /** Currently selected model ID */
  value: string;
  /** Called when a model is selected */
  onChange: (value: string) => void;
  /** Placeholder when nothing selected */
  placeholder?: string;
  /** Search placeholder */
  searchPlaceholder?: string;
  /** SelectPill variant */
  variant?: SelectPillProps["variant"];
  /** SelectPill size */
  size?: SelectPillProps["size"];
  /** Controlled popover (optional) */
  popover?: ReturnType<typeof usePopover>;
  /** Additional trigger className */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Visible strings; `placeholder` / `searchPlaceholder` win over them. English defaults. */
  labels?: Partial<ChatLabels>;
}

/** Group models by provider, keeping the order of first appearance. */
export function groupModelsByProvider(
  models: ModelOption[],
  search = "",
): Record<string, ModelOption[]> {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) => m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q))
    : models;

  return filtered.reduce(
    (acc, model) => {
      if (!acc[model.provider]) acc[model.provider] = [];
      acc[model.provider].push(model);
      return acc;
    },
    Object.create(null) as Record<string, ModelOption[]>,
  );
}

export interface ModelOptionListProps {
  /** Models grouped by provider (see {@link groupModelsByProvider}). */
  grouped: Record<string, ModelOption[]>;
  /** Currently selected model ID */
  value: string;
  /** Called when a model is picked */
  onSelect: (value: string) => void;
  className?: string;
  labels?: Partial<ChatLabels>;
}

/**
 * The M3 menu list of the model selector: provider section headers (`text-title-small`),
 * 48 dp two-line items (`text-label-large` + `text-body-small` supporting text), the selected
 * item on `secondary-container`, capabilities as small outlined chips.
 */
export function ModelOptionList({
  grouped,
  value,
  onSelect,
  className,
  labels,
}: ModelOptionListProps) {
  const l = resolveChatLabels(labels);
  const providers = Object.entries(grouped);
  const models = providers.flatMap(([, providerModels]) => providerModels);
  const [focusedId, setFocusedId] = useState(value);
  const focusId = models.some((model) => model.id === focusedId)
    ? focusedId
    : (models.find((model) => model.id === value)?.id ?? models[0]?.id);
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 menu whose options are rich rows (headers, supporting text, chips); a native <select>/<datalist> cannot render them.
      role="listbox"
      aria-label={l.models}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        const options = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
        );
        const index = options.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        let next: number;
        switch (event.key) {
          case "ArrowDown":
            next = (index + 1) % options.length;
            break;
          case "ArrowUp":
            next = (index - 1 + options.length) % options.length;
            break;
          case "Home":
            next = 0;
            break;
          case "End":
            next = options.length - 1;
            break;
          default:
            return;
        }
        event.preventDefault();
        options[next]!.focus();
      }}
      className={clsx("flex flex-col", className)}
    >
      {providers.map(([provider, providerModels], groupIndex) => (
        <div
          key={provider}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- provider section of the custom listbox with a visible M3 header row; <optgroup> only exists inside a native <select>.
          role="group"
          aria-label={provider}
          className={clsx(groupIndex > 0 && "mt-1 border-t border-outline-variant pt-1")}
        >
          <div className="px-3 pt-2 pb-1 text-title-small text-on-surface-variant">{provider}</div>
          {providerModels.map((model) => {
            const selected = model.id === value;
            return (
              <button
                key={model.id}
                type="button"
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 two-line menu item (label, supporting text, capability chips, check icon); a native <option> can only hold text.
                role="option"
                aria-selected={selected}
                tabIndex={model.id === focusId ? 0 : -1}
                onFocus={() => setFocusedId(model.id)}
                onClick={() => onSelect(model.id)}
                className={clsx(
                  "flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left",
                  "transition-colors duration-200 ease-standard",
                  selected
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface hover:bg-on-surface/8 active:bg-on-surface/10",
                  focusRing,
                  "focus-visible:outline-offset-[-3px]",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-label-large">{model.name}</div>
                  {model.context_window || model.capabilities?.length ? (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {model.context_window ? (
                        <span
                          className={clsx(
                            "text-body-small",
                            selected ? "text-on-secondary-container" : "text-on-surface-variant",
                          )}
                        >
                          {formatLabel(l.contextTokens, {
                            count: model.context_window.toLocaleString(),
                          })}
                        </span>
                      ) : null}
                      {model.capabilities?.map((capability) => (
                        <span
                          key={capability}
                          className={clsx(
                            "inline-flex h-5 items-center rounded-small border border-outline-variant px-1.5 text-label-small",
                            selected ? "text-on-secondary-container" : "text-on-surface-variant",
                          )}
                        >
                          {capability}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {selected && <ChatIcon name="check" size={20} />}
              </button>
            );
          })}
        </div>
      ))}
      {providers.length === 0 && (
        <div className="px-3 py-3 text-center text-body-small text-on-surface-variant">
          {l.noModels}
        </div>
      )}
    </div>
  );
}

/**
 * The menu's search field. It mounts with the popover content and takes focus then (replaces
 * `autoFocus`), so typing filters the list as soon as the menu opens.
 */
function ModelSearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="px-2 pb-2">
      <label className="flex h-10 items-center gap-2 rounded-full bg-surface-container-high px-3 text-on-surface-variant focus-within:bg-surface-container-highest">
        <ChatIcon name="search" size={20} />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-body-large text-on-surface outline-none placeholder:text-on-surface-variant"
        />
      </label>
    </div>
  );
}

export const ModelSelector = forwardRef<HTMLButtonElement, ModelSelectorProps>(
  (
    {
      models,
      value,
      onChange,
      placeholder,
      searchPlaceholder,
      variant,
      size,
      popover: externalPopover,
      className,
      disabled,
      labels,
    },
    ref,
  ) => {
    const l = resolveChatLabels(labels);
    const internalPopover = usePopover();
    const popover = externalPopover ?? internalPopover;
    const [search, setSearch] = useState("");

    const selectedModel = models.find((m) => m.id === value);

    const grouped = useMemo(() => groupModelsByProvider(models, search), [models, search]);

    return (
      <Popover.Root
        open={popover.open}
        onOpenChange={(open) => {
          popover.setOpen(open);
          if (!open) setSearch("");
        }}
      >
        <Popover.Trigger asChild>
          <SelectPill
            ref={ref}
            variant={variant}
            size={size}
            disabled={disabled}
            aria-haspopup="listbox"
            hideCaret
            className={clsx("w-full", className)}
          >
            <span className="min-w-0 flex-1 truncate">
              {selectedModel?.name ?? placeholder ?? l.selectModel}
            </span>
            <ChatIcon name="expand_more" size={18} />
          </SelectPill>
        </Popover.Trigger>
        <Popover.Content
          align="end"
          sideOffset={8}
          style={{ width: 280 }}
          className="overflow-hidden rounded-extra-small! py-2"
        >
          {/* Search */}
          <ModelSearchField
            value={search}
            onChange={setSearch}
            placeholder={searchPlaceholder ?? l.searchModels}
          />

          {/* Grouped results */}
          <div className="max-h-[320px] overflow-y-auto">
            <ModelOptionList
              grouped={grouped}
              value={value}
              labels={labels}
              onSelect={(id) => {
                onChange(id);
                popover.setOpen(false);
                setSearch("");
              }}
            />
          </div>
        </Popover.Content>
      </Popover.Root>
    );
  },
);

ModelSelector.displayName = "ModelSelector";
