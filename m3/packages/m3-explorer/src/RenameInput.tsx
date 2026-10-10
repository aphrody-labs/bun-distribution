// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/explorer/src/RenameInput.tsx), MIT, rebuilt on Material Design 3.
import { clsx } from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

export interface RenameInputProps {
  /** Current name (without extension) */
  name: string;
  /** File extension (e.g. "txt"). If provided, shown as read-only suffix */
  extension?: string;
  /** Called with the full new name (including extension) on save */
  onSave: (newName: string) => Promise<void>;
  /** Called when rename is cancelled (Escape or blur) */
  onCancel: () => void;
  className?: string;
}

/**
 * Inline name editing component, drawn as a dense M3 filled text field.
 *
 * - Auto-focuses and selects text on mount (the stem only: the extension is a suffix)
 * - Only edits the name portion (extension shown as read-only)
 * - Enter saves, Escape cancels, blur cancels (macOS Finder behavior)
 */
export function RenameInput({ name, extension, onSave, onCancel, className }: RenameInputProps) {
  const hasExtension = extension && extension.length > 0;

  const [value, setValue] = useState(name);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    const trimmedValue = value.trim();

    if (!trimmedValue) {
      onCancel();
      return;
    }

    const fullNewName = hasExtension ? `${trimmedValue}.${extension}` : trimmedValue;
    const currentFullName = hasExtension ? `${name}.${extension}` : name;

    if (fullNewName === currentFullName) {
      onCancel();
      return;
    }

    setIsSaving(true);
    try {
      await onSave(fullNewName);
    } catch {
      setIsSaving(false);
    }
  }, [value, isSaving, hasExtension, extension, name, onSave, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    },
    [handleSave, onCancel],
  );

  const handleBlur = useCallback(() => {
    if (!isSaving) {
      onCancel();
    }
  }, [isSaving, onCancel]);

  return (
    <div
      data-m3-component="RenameInput"
      className={clsx(
        "inline-flex items-center rounded-extra-small bg-surface-container-highest px-1 text-body-medium text-on-surface",
        "outline-primary transition-[outline-color] duration-200 ease-standard focus-within:outline-2",
        isSaving && "opacity-38",
        className,
      )}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={isSaving}
        autoComplete="off"
        spellCheck={false}
        aria-label="Name"
        className={clsx(
          "min-w-[60px] border-none bg-transparent py-0.5 text-center text-body-medium text-on-surface caret-primary outline-none",
          "selection:bg-primary-container selection:text-on-primary-container",
          "disabled:cursor-not-allowed",
        )}
      />
      {hasExtension && (
        <span className="text-body-medium text-on-surface-variant">.{extension}</span>
      )}
    </div>
  );
}
