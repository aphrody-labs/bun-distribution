// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/ChatComposer.tsx), MIT, rebuilt on Material Design 3.

"use client";

import {
  CircleButton,
  Popover,
  SelectPill,
  usePopover,
} from "@aphrody/m3-primitives";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode } from "react";

import { type ChatLabels, resolveChatLabels } from "./chatLabels";
import { ChatIcon } from "./chatIcons";
import { focusRing } from "./internal";
import { ModelSelector } from "./ModelSelector";
import type { ModelOption } from "./types";

export interface ChatComposerProps {
  /** Current draft text */
  draft: string;
  /** Called when draft changes */
  onDraftChange: (value: string) => void;
  /** Called when user hits send (Enter or send button) */
  onSend: () => void;
  /** Placeholder for the textarea */
  placeholder?: string;
  /** Show an optional heading above the composer */
  heading?: ReactNode;
  /** Disable the composer — draft can still change, but send/voice are blocked */
  isSending?: boolean;
  /**
   * Disable the whole composer (e.g. the model is unavailable): the textarea, send, voice and
   * the selectors are all inert. Distinct from `isSending`, which keeps the draft editable.
   */
  disabled?: boolean;
  /** Project selector config — omit to hide */
  projectSelector?: {
    value: string;
    options: string[];
    onChange: (project: string) => void;
    popover: ReturnType<typeof usePopover>;
  };
  /** Model selector config — omit to hide */
  modelSelector?: {
    value: string;
    options: ModelOption[];
    onChange: (model: string) => void;
  };
  /** Voice button handler — omit to hide */
  onOpenVoice?: () => void;
  /** Optional content rendered at the far right of the toolbar (before send) */
  toolbarExtra?: ReactNode;
  /** Stop handler: while `isSending`, the send button becomes an M3 `stop` icon button. */
  onStop?: () => void;
  /** Additional className on the composer container */
  className?: string;
  /** Visible strings (placeholder, aria-labels); English defaults. `placeholder` wins over it. */
  labels?: Partial<ChatLabels>;
}

const iconButtonEnter = {
  initial: { scale: 0.6, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: {
      duration: m3Durations.short4,
      ease: m3Easings.emphasizedDecelerate,
    },
  },
  exit: {
    scale: 0.6,
    opacity: 0,
    transition: {
      duration: m3Durations.short3,
      ease: m3Easings.emphasizedAccelerate,
    },
  },
} as const;

/**
 * Generic chat composer on the M3 search-bar anatomy: a `surface-container-high` container with
 * the extra-large (28 dp) shape, a `text-body-large` expanding textarea, an optional project
 * pill, model selector chip, a standard mic icon button and a filled send / stop icon button.
 */
export function ChatComposer({
  draft,
  onDraftChange,
  onSend,
  placeholder,
  heading,
  isSending = false,
  disabled = false,
  projectSelector,
  modelSelector,
  onOpenVoice,
  toolbarExtra,
  onStop,
  className,
  labels,
}: ChatComposerProps) {
  const l = resolveChatLabels(labels);
  const hint = placeholder ?? l.composerPlaceholder;
  const canSend = !disabled && !isSending && draft.trim().length > 0;
  const showStop = !disabled && isSending && !!onStop;

  return (
    <>
      {heading && (
        <div className="mb-3 flex items-center gap-2 px-1 text-title-small text-on-surface-variant">
          <ChatIcon
            name="auto_awesome_filled"
            size={18}
            className="text-primary"
          />
          {heading}
        </div>
      )}

      <div
        className={clsx(
          "m3-chat-composer rounded-extra-large bg-surface-container-high px-4 pt-3 pb-2 text-on-surface",
          "transition-colors duration-200 ease-standard focus-within:bg-surface-container-highest",
          className,
        )}
      >
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={hint}
          aria-label={hint}
          rows={2}
          disabled={disabled}
          className="block w-full resize-none border-0 bg-transparent px-1 text-body-large text-on-surface caret-primary outline-none placeholder:text-on-surface-variant focus:outline-none focus:ring-0"
        />

        <div className="mt-2 flex items-center justify-between gap-2">
          {projectSelector ? (
            <div className="w-[210px]">
              <Popover.Root
                open={projectSelector.popover.open}
                onOpenChange={projectSelector.popover.setOpen}
              >
                <Popover.Trigger asChild>
                  <SelectPill
                    className="w-full"
                    aria-haspopup="listbox"
                    disabled={disabled}
                    hideCaret
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {projectSelector.value}
                    </span>
                    <ChatIcon name="expand_more" size={18} />
                  </SelectPill>
                </Popover.Trigger>
                <Popover.Content
                  align="start"
                  sideOffset={8}
                  className="min-w-[210px] overflow-hidden rounded-extra-small! py-2"
                >
                  <div
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 menu in a popover with icon rows; a native <select>/<datalist> cannot render it.
                    role="listbox"
                    aria-label={l.projects}
                  >
                    {projectSelector.options.map((option) => {
                      const selected = option === projectSelector.value;
                      return (
                        <button
                          key={option}
                          type="button"
                          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 menu item with a check icon and state layer; a native <option> can only hold text.
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            projectSelector.onChange(option);
                            projectSelector.popover.setOpen(false);
                          }}
                          className={clsx(
                            "flex h-12 w-full items-center gap-3 px-3 text-left text-label-large",
                            "transition-colors duration-200 ease-standard",
                            selected
                              ? "bg-secondary-container text-on-secondary-container"
                              : "text-on-surface hover:bg-on-surface/8",
                            focusRing,
                            "focus-visible:outline-offset-[-3px]",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {option}
                          </span>
                          {selected && <ChatIcon name="check" size={20} />}
                        </button>
                      );
                    })}
                  </div>
                </Popover.Content>
              </Popover.Root>
            </div>
          ) : (
            <div />
          )}

          <motion.div layout className="flex items-center gap-1">
            {modelSelector && (
              <div className="w-[180px]">
                <ModelSelector
                  models={modelSelector.options}
                  value={modelSelector.value}
                  onChange={modelSelector.onChange}
                  size="md"
                  disabled={disabled}
                  labels={labels}
                />
              </div>
            )}

            {toolbarExtra}

            {onOpenVoice && (
              <CircleButton
                icon={<ChatIcon name="mic" size={20} />}
                variant="standard"
                onClick={onOpenVoice}
                disabled={isSending || disabled}
                aria-label={l.openVoice}
              />
            )}

            <AnimatePresence initial={false} mode="popLayout">
              {showStop ? (
                <motion.button
                  key="stop"
                  type="button"
                  {...iconButtonEnter}
                  onClick={onStop}
                  aria-label={l.stop}
                  className={clsx(
                    "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary",
                    "transition-colors duration-200 ease-standard hover:bg-primary/92 active:bg-primary/90",
                    focusRing,
                  )}
                >
                  <ChatIcon name="stop_filled" size={24} />
                </motion.button>
              ) : canSend ? (
                <motion.button
                  key="send"
                  type="button"
                  {...iconButtonEnter}
                  onClick={onSend}
                  aria-label={l.send}
                  className={clsx(
                    "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary",
                    "transition-colors duration-200 ease-standard hover:bg-primary/92 active:bg-primary/90",
                    focusRing,
                  )}
                >
                  <ChatIcon name="arrow_upward" size={24} />
                </motion.button>
              ) : null}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </>
  );
}
