// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/TaskDetail.tsx), MIT, rebuilt on Material Design 3.

import { Button, CircleButton, Icon, Select, SelectOption } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

import { focusRing } from "./internal";
import { Markdown } from "./Markdown";
import { TaskPriorityIcon } from "./TaskPriorityIcon";
import { TaskStatusIcon } from "./TaskStatusIcon";
import type { Task, TaskStatus } from "./types";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, TASK_STATUS_ORDER } from "./types";

export interface TaskDetailProps {
  task: Task;
  resolveAgentName?: (agentId: string) => string;
  onStatusChange?: (task: Task, status: TaskStatus) => void;
  onSubtaskToggle?: (task: Task, index: number, completed: boolean) => void;
  onDelete?: (task: Task) => void;
  onClose?: () => void;
  className?: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-label-medium text-on-surface-variant">{label}</span>
      <span className="flex min-h-8 items-center gap-1.5 text-body-medium text-on-surface">
        {children}
      </span>
    </div>
  );
}

/**
 * A task on an M3 surface: `text-headline-small` title, a property grid, subtasks as an M3 list
 * with checkboxes, markdown description, and actions as M3 buttons (filled for the primary
 * transition, text for the others).
 */
export function TaskDetail({
  task,
  resolveAgentName,
  onStatusChange,
  onSubtaskToggle,
  onDelete,
  onClose,
  className,
}: TaskDetailProps) {
  const ownerName = resolveAgentName?.(task.owner_agent_id) ?? task.owner_agent_id;
  const assigneeName = resolveAgentName?.(task.assigned_agent_id) ?? task.assigned_agent_id;
  const completedCount = task.subtasks.filter((s) => s.completed).length;

  return (
    <div className={clsx("flex flex-col gap-6 bg-surface p-6 text-on-surface", className)}>
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2">
            <TaskStatusIcon status={task.status} size={20} />
            <TaskPriorityIcon priority={task.priority} size={18} />
            <span className="font-code text-body-small text-on-surface-variant">
              SPC-{task.task_number}
            </span>
          </div>
          {onClose && (
            <CircleButton icon="close" variant="standard" onClick={onClose} aria-label="Close" />
          )}
        </div>
        <h2 className="text-headline-small text-on-surface">{task.title}</h2>
      </div>

      {/* Properties */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 medium:grid-cols-4">
        <Property label="Status">
          {onStatusChange ? (
            <Select
              value={task.status}
              size="md"
              onChange={(value) => onStatusChange(task, value as TaskStatus)}
            >
              {TASK_STATUS_ORDER.map((s) => (
                <SelectOption key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </SelectOption>
              ))}
            </Select>
          ) : (
            TASK_STATUS_LABEL[task.status]
          )}
        </Property>
        <Property label="Priority">
          <TaskPriorityIcon priority={task.priority} size={18} label="" />
          {TASK_PRIORITY_LABEL[task.priority]}
        </Property>
        <Property label="Owner">
          <span className="truncate">{ownerName}</span>
        </Property>
        <Property label="Assigned">
          <span className="truncate">{assigneeName}</span>
        </Property>
      </div>

      {/* Subtasks */}
      {task.subtasks.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-title-small text-on-surface">Subtasks</h3>
            <span className="text-body-small text-on-surface-variant">
              {completedCount}/{task.subtasks.length}
            </span>
          </div>
          <ul className="m-0 list-none overflow-hidden rounded-medium border border-outline-variant p-0">
            {task.subtasks.map((subtask, i) => (
              <li key={subtask.title}>
                <button
                  type="button"
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- M3 list item with a leading checkbox: the whole 48 dp row toggles and carries the state layer; a native checkbox input cannot host the row.
                  role="checkbox"
                  aria-checked={subtask.completed}
                  onClick={() => onSubtaskToggle?.(task, i, !subtask.completed)}
                  className={clsx(
                    "flex min-h-12 w-full items-center gap-4 px-4 py-2 text-left text-body-large",
                    "transition-colors duration-200 ease-standard hover:bg-on-surface/8 active:bg-on-surface/10",
                    focusRing,
                    "focus-visible:outline-offset-[-3px]",
                    i > 0 && "border-t border-outline-variant",
                  )}
                >
                  <span
                    className={clsx(
                      "flex size-[18px] shrink-0 items-center justify-center rounded-[2px] transition-colors duration-200 ease-standard",
                      subtask.completed
                        ? "bg-primary text-on-primary"
                        : "border-2 border-on-surface-variant",
                    )}
                  >
                    {subtask.completed && <Icon name="check" size={16} weight={700} />}
                  </span>
                  <span
                    className={clsx(
                      "min-w-0 flex-1",
                      subtask.completed
                        ? "text-on-surface-variant line-through"
                        : "text-on-surface",
                    )}
                  >
                    {subtask.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Description */}
      <section className="flex flex-col gap-2">
        <h3 className="text-title-small text-on-surface">Description</h3>
        {task.description ? (
          <Markdown content={task.description} size="medium" />
        ) : (
          <p className="text-body-medium text-on-surface-variant">No description</p>
        )}
      </section>

      {/* Timestamps */}
      <div className="flex flex-col gap-1 text-body-small text-on-surface-variant">
        <span>Created {formatDate(task.created_at)}</span>
        <span>Updated {formatDate(task.updated_at)}</span>
        {task.completed_at && <span>Completed {formatDate(task.completed_at)}</span>}
      </div>

      {/* Actions */}
      {(onStatusChange || onDelete) && (
        <div className="flex flex-wrap items-center gap-2">
          {onStatusChange && task.status === "pending_approval" && (
            <Button variant="filled" size="lg" onClick={() => onStatusChange(task, "ready")}>
              Approve
            </Button>
          )}
          {onStatusChange && task.status === "backlog" && (
            <Button variant="filled" size="lg" onClick={() => onStatusChange(task, "in_progress")}>
              Execute
            </Button>
          )}
          {onStatusChange && (task.status === "in_progress" || task.status === "ready") && (
            <Button variant="filled" size="lg" onClick={() => onStatusChange(task, "done")}>
              Mark Done
            </Button>
          )}
          {onStatusChange && task.status === "done" && (
            <Button variant="text" size="lg" onClick={() => onStatusChange(task, "ready")}>
              Reopen
            </Button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(task)}
              className={clsx(
                "inline-flex h-10 items-center justify-center gap-2 rounded-full px-3 text-label-large text-error",
                "transition-colors duration-200 ease-standard hover:bg-error/8 active:bg-error/10",
                focusRing,
              )}
            >
              <Icon name="delete" size={18} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
