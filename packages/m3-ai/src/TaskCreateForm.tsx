// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/TaskCreateForm.tsx), MIT, rebuilt on Material Design 3.

import { Button, Input, Select, SelectOption, TextArea } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import type { TaskPriority } from "./types";
import { TASK_PRIORITY_LABEL } from "./types";

export interface TaskCreateFormData {
  title: string;
  description: string;
  priority: TaskPriority;
}

export interface TaskCreateFormProps {
  onSubmit: (data: TaskCreateFormData) => void;
  onCancel?: () => void;
  defaultPriority?: TaskPriority;
  isSubmitting?: boolean;
  className?: string;
}

const PRIORITIES: TaskPriority[] = ["critical", "high", "medium", "low"];

/**
 * Inline task creation on an M3 surface: title and description text fields, a priority select,
 * and M3 actions (filled `Create`, text `Cancel`).
 */
export function TaskCreateForm({
  onSubmit,
  onCancel,
  defaultPriority = "medium",
  isSubmitting,
  className,
}: TaskCreateFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(defaultPriority);
  const titleInputId = useId();
  const descriptionInputId = useId();
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Focus the title when the form mounts (replaces `autoFocus`).
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const canSubmit = title.trim().length > 0 && !isSubmitting;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      priority,
    });
    setTitle("");
    setDescription("");
    setPriority(defaultPriority);
  }, [canSubmit, onSubmit, title, description, priority, defaultPriority]);

  return (
    <div className={clsx("flex flex-col gap-3 rounded-medium bg-surface-container-low p-4 text-on-surface", className)}>
      <div className="flex items-center gap-2">
        <label htmlFor={titleInputId} className="sr-only">
          Task Title
        </label>
        <Input
          ref={titleInputRef}
          id={titleInputId}
          type="text"
          size="lg"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onCancel?.();
          }}
          placeholder="Task title..."
          className="min-w-0 flex-1"
          disabled={isSubmitting}
        />
        <Select
          value={priority}
          size="lg"
          onChange={value => setPriority(value as TaskPriority)}
          disabled={isSubmitting}
        >
          {PRIORITIES.map(p => (
            <SelectOption key={p} value={p}>
              {TASK_PRIORITY_LABEL[p]}
            </SelectOption>
          ))}
        </Select>
      </div>
      <label htmlFor={descriptionInputId} className="sr-only">
        Description
      </label>
      <TextArea
        id={descriptionInputId}
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full resize-none"
        disabled={isSubmitting}
      />
      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button variant="text" size="lg" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button variant="filled" size="lg" disabled={!canSubmit} onClick={handleSubmit}>
          Create
        </Button>
      </div>
    </div>
  );
}
