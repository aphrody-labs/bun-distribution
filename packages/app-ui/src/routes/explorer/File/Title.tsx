import { useState, useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { File } from "@aphrody/drive-client";

interface TitleProps {
  file: File;
  editable?: boolean;
  selected?: boolean;
  onRename?: (newName: string) => void;
  className?: string;
}

export function Title({
  file,
  editable: _editable = false,
  selected: _selected = false,
  onRename,
  className,
}: TitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(file.name);
  const ref = useRef<HTMLDivElement>(null);

  const handleBlur = () => {
    setIsEditing(false);
    if (editValue !== file.name && onRename) {
      onRename(editValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBlur();
    }
    if (e.key === "Escape") {
      setEditValue(file.name);
      setIsEditing(false);
    }
  };

  useEffect(() => {
    if (isEditing) {
      ref.current?.focus();
      if (ref.current) {
        const endRange = file.name.lastIndexOf(".");
        const range = document.createRange();
        const node = ref.current.childNodes[0];

        if (node) {
          range.setStart(node, 0);
          range.setEnd(node, endRange > 0 ? endRange : file.name.length);

          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      }
    }
  }, [isEditing, file.name]);

  return (
    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the title is a contentEditable rename field styled as text; it is focused programmatically when editing
    <div
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the title is a contentEditable rename field styled as text; an input would change its rendering and selection
      role="textbox"
      aria-readonly={!isEditing}
      contentEditable={isEditing}
      suppressContentEditableWarning
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={clsx(
        "cursor-default overflow-hidden rounded-small px-1.5 py-px text-body-small text-on-surface outline-none",
        isEditing && "bg-surface ring-2 ring-primary",
        !isEditing && "truncate",
        className,
      )}
    >
      {file.name}
      {file.extension && `.${file.extension}`}
    </div>
  );
}
