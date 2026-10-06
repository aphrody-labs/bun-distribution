// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/TaskRow.tsx), MIT, rebuilt on Material Design 3.

import { DropdownMenu, Icon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

import { focusRing } from "./internal";
import { TaskPriorityIcon } from "./TaskPriorityIcon";
import { TaskStatusIcon } from "./TaskStatusIcon";
import type { Task, TaskStatus } from "./types";
import { TASK_STATUS_LABEL, TASK_STATUS_ORDER } from "./types";

export interface TaskRowProps {
  task: Task;
  onClick?: (task: Task) => void;
  isActive?: boolean;
  resolveAgentName?: (agentId: string) => string;
  onStatusChange?: (task: Task, status: TaskStatus) => void;
  onDelete?: (task: Task) => void;
  className?: string;
}

/** Column template shared with the {@link TaskList} header. */
export const TASK_ROW_GRID = "20px 18px 72px 1fr 56px 96px 40px";

/** M3 list item height at desktop density (56 dp baseline, two density steps). */
export const TASK_ROW_HEIGHT = 48;

/**
 * A task as a dense M3 list item: leading status and priority icons, `text-body-large` headline,
 * `text-body-small` supporting columns, `on-surface` 8 % hover, `secondary-container` selection
 * and a trailing overflow-menu icon button.
 */
export function TaskRow({
  task,
  onClick,
  isActive,
  resolveAgentName,
  onStatusChange,
  onDelete,
  className,
}: TaskRowProps) {
  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;
  const assigneeName = resolveAgentName?.(task.assigned_agent_id) ?? task.assigned_agent_id;
  const hasActions = onStatusChange || onDelete;
  const isRowInteractive = typeof onClick === "function";

  const rowClassName = clsx(
    "task-row group grid w-full items-center border-b border-outline-variant text-left",
    "transition-colors duration-200 ease-standard",
    isActive
      ? "bg-secondary-container text-on-secondary-container"
      : "bg-transparent text-on-surface hover:bg-on-surface/8",
    isRowInteractive && !isActive && "active:bg-on-surface/10",
    className,
  );
  const rowStyle: React.CSSProperties = {
    gridTemplateColumns: TASK_ROW_GRID,
    minHeight: TASK_ROW_HEIGHT,
    paddingLeft: 16,
    paddingRight: 8,
    gap: 12,
  };

  const mainContent = (
    <>
      <TaskStatusIcon status={task.status} size={20} />
      <TaskPriorityIcon priority={task.priority} size={18} />

      <span
        className={clsx(
          "truncate font-code text-body-small",
          isActive ? "text-on-secondary-container" : "text-on-surface-variant",
        )}
      >
        SPC-{task.task_number}
      </span>

      <span className="min-w-0 truncate text-body-large">{task.title}</span>

      <span
        className={clsx(
          "text-right text-body-small",
          isActive ? "text-on-secondary-container" : "text-on-surface-variant",
        )}
      >
        {task.subtasks.length > 0 ? `${completedSubtasks}/${task.subtasks.length}` : ""}
      </span>

      <span
        className={clsx(
          "truncate text-right text-body-small",
          isActive ? "text-on-secondary-container" : "text-on-surface-variant",
        )}
      >
        {assigneeName}
      </span>
    </>
  );

  const actions = (
    <span className="flex items-center justify-center">
      {hasActions ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Task Actions"
              className={clsx(
                "flex size-8 items-center justify-center rounded-full text-on-surface-variant",
                "opacity-0 transition-[opacity,background-color] duration-200 ease-standard",
                "hover:bg-on-surface/8 active:bg-on-surface/10",
                "group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100",
                focusRing,
              )}
            >
              <Icon name="more_vert" size={20} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" sideOffset={4}>
            {onStatusChange &&
              TASK_STATUS_ORDER.filter((s) => s !== task.status).map((s) => (
                <DropdownMenu.Item
                  key={s}
                  onClick={() => {
                    onStatusChange(task, s);
                  }}
                >
                  <TaskStatusIcon status={s} size={20} label="" />
                  <span>{TASK_STATUS_LABEL[s]}</span>
                </DropdownMenu.Item>
              ))}
            {onStatusChange && onDelete && <DropdownMenu.Separator />}
            {onDelete && (
              <DropdownMenu.Item
                onClick={() => {
                  onDelete(task);
                }}
                className="text-error"
              >
                <Icon name="delete" size={20} />
                <span>Delete</span>
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      ) : null}
    </span>
  );

  if (!isRowInteractive) {
    return (
      <div aria-current={isActive ? "true" : undefined} className={rowClassName} style={rowStyle}>
        {mainContent}
        {actions}
      </div>
    );
  }

  return (
    <div className={rowClassName} style={rowStyle}>
      <button
        type="button"
        aria-current={isActive ? "true" : undefined}
        onClick={() => onClick(task)}
        className={clsx(
          "col-span-6 grid grid-cols-subgrid items-center border-0 bg-transparent p-0 text-left font-inherit",
          focusRing,
          "focus-visible:outline-offset-[-3px]",
        )}
      >
        {mainContent}
      </button>
      {actions}
    </div>
  );
}
