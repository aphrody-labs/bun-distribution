// SPDX-License-Identifier: Apache-2.0
// Benchmark: assets/ui/gemini-personal-context-edit.png
// Focused multiline context editor dialog for user preferences and saved agent memory

"use client";

import { Button, DialogClose, DialogContent, DialogRoot, Icon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useState } from "react";

export interface GeminiPersonalContextEditProps {
  /** Controls open state of the dialog */
  open: boolean;
  /** Open state change callback */
  onOpenChange: (open: boolean) => void;
  /** Current context text */
  initialContext?: string;
  /** Title of the dialog */
  title?: string;
  /** Subtitle/description of context rules */
  description?: string;
  /** Save callback */
  onSave: (context: string) => void | Promise<void>;
  /** Clear/delete context callback */
  onClear?: () => void;
  /** Additional container classes */
  className?: string;
}

/**
 * Gemini Personal Context & User Memory Editor Dialog.
 * Benchmark parity: `assets/ui/gemini-personal-context-edit.png` (manifest item 4).
 * Features:
 * - Centered dialog over translucent backdrop blur.
 * - Focused multiline context editor with visible focus outline.
 * - Save button is disabled when context is empty or unchanged.
 * - Contextual instructions for how agent uses personal context.
 */
export function GeminiPersonalContextEdit({
  open,
  onOpenChange,
  initialContext = "",
  title = "Your personal context",
  description = "Help Gemini understand your preferences, interests, and how you want it to respond. This information is saved and applied across your conversations.",
  onSave,
  onClear,
  className,
}: GeminiPersonalContextEditProps) {
  const [context, setContext] = useState(initialContext);
  const [isSaving, setIsSaving] = useState(false);

  const [previousInputs, setPreviousInputs] = useState({ initialContext, open });
  // Reset the draft before committing a changed source or open state, while preserving the editor node and focus.
  if (previousInputs.initialContext !== initialContext || previousInputs.open !== open) {
    setPreviousInputs({ initialContext, open });
    setContext(initialContext);
  }

  const hasChanged = context.trim() !== initialContext.trim();
  const canSave = context.trim().length > 0 && hasChanged && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await onSave(context.trim());
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={clsx(
          "gemini-context-edit-dialog w-full max-w-[620px] rounded-[var(--gemini-corner-card,16px)]",
          "border border-outline-variant/30 bg-surface p-6 text-on-surface shadow-md3-3",
          className,
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-headline-small font-normal text-on-surface flex items-center gap-2">
              <Icon name="psychology" size={24} className="text-primary" />
              {title}
            </h2>
            <p className="text-body-medium text-on-surface-variant leading-relaxed">
              {description}
            </p>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              className="rounded-full p-1.5 text-on-surface-variant hover:bg-on-surface/8 transition-colors"
              aria-label="Close"
            >
              <Icon name="close" size={20} />
            </button>
          </DialogClose>
        </div>

        {/* Text Area Input */}
        <div className="mt-5 space-y-2">
          <div className="relative rounded-medium border-2 border-primary/60 bg-surface-container-low transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. Always respond in concise bullet points, write modern TypeScript with Bun, favor pure functions..."
              rows={6}
              aria-label="Personal context content"
              className="block w-full resize-y border-0 bg-transparent p-3.5 text-body-medium text-on-surface caret-primary outline-none placeholder:text-on-surface-variant/60"
            />
          </div>
          <div className="flex justify-between px-1 text-label-small text-on-surface-variant">
            <span>{context.length} characters</span>
            {initialContext.length > 0 && onClear && (
              <button
                type="button"
                onClick={() => {
                  setContext("");
                  onClear();
                }}
                className="text-error hover:underline transition-all"
              >
                Clear saved context
              </button>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <DialogClose asChild>
            <Button variant="text" disabled={isSaving}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="filled" onClick={handleSave} disabled={!canSave} className="px-6">
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
