// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/TaskList.tsx), MIT, rebuilt on Material Design 3.

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Icon,
} from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useMemo } from "react";

import { focusRing } from "./internal";
import { TASK_ROW_GRID, TaskRow } from "./TaskRow";
import { TaskStatusIcon } from "./TaskStatusIcon";
import type { Task, TaskStatus } from "./types";
import { TASK_STATUS_LABEL, TASK_STATUS_ORDER } from "./types";

export interface TaskListProps {
  tasks: Task[];
  groups?: TaskStatus[];
  collapsedGroups?: Set<TaskStatus>;
  onToggleGroup?: (status: TaskStatus) => void;
  activeTaskId?: string;
  onTaskClick: (task: Task) => void;
  onStatusChange?: (task: Task, status: TaskStatus) => void;
  onDelete?: (task: Task) => void;
  resolveAgentName?: (agentId: string) => string;
  className?: string;
}

const GRID_STYLE = {
  gridTemplateColumns: TASK_ROW_GRID,
  paddingLeft: 16,
  paddingRight: 8,
  gap: 12,
} as const;

/**
 * Tasks grouped by status as an M3 list: a column header in `text-label-medium`, collapsible
 * section headers in `text-title-small`, `outline-variant` dividers.
 */
export function TaskList({
  tasks,
  groups = TASK_STATUS_ORDER,
  collapsedGroups,
  onToggleGroup,
  activeTaskId,
  onTaskClick,
  onStatusChange,
  onDelete,
  resolveAgentName,
  className,
}: TaskListProps) {
  const grouped = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const status of groups) map.set(status, []);
    for (const task of tasks) {
      const bucket = map.get(task.status);
      if (bucket) bucket.push(task);
    }
    return map;
  }, [tasks, groups]);

  return (
    <div
      className={clsx("flex flex-col bg-surface text-on-surface", className)}
    >
      {/* Column header */}
      <div
        className="grid items-center border-b border-outline-variant text-label-medium text-on-surface-variant"
        style={{ ...GRID_STYLE, height: 32 }}
      >
        <span />
        <span />
        <span>ID</span>
        <span>Title</span>
        <span className="text-right">Subs</span>
        <span className="text-right">Assignee</span>
        <span />
      </div>

      {/* Groups */}
      {groups.map((status) => {
        const items = grouped.get(status) ?? [];
        const isOpen = !collapsedGroups?.has(status);

        return (
          <Collapsible
            key={status}
            open={isOpen}
            onOpenChange={() => onToggleGroup?.(status)}
          >
            <CollapsibleTrigger
              className={clsx(
                "grid w-full items-center rounded-none border-b border-outline-variant bg-surface-container-low",
                "text-title-small text-on-surface transition-colors duration-200 ease-standard",
                "hover:bg-on-surface/8 active:bg-on-surface/10",
                focusRing,
                "focus-visible:outline-offset-[-3px]",
              )}
              style={{ ...GRID_STYLE, height: 40 }}
            >
              <span className="flex items-center justify-center text-on-surface-variant">
                <Icon
                  name="chevron_right"
                  size={20}
                  className={clsx(
                    "shrink-0 transition-transform duration-300 ease-emphasized",
                    isOpen && "rotate-90",
                  )}
                />
              </span>
              <span className="flex items-center justify-center">
                <TaskStatusIcon status={status} size={18} label="" />
              </span>
              <span className="col-span-5 flex items-center gap-1.5 text-left">
                {TASK_STATUS_LABEL[status]}
                <span className="text-body-small text-on-surface-variant">
                  ({items.length})
                </span>
              </span>
            </CollapsibleTrigger>

            <CollapsibleContent>
              {items.length > 0 ? (
                items.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    isActive={task.id === activeTaskId}
                    onClick={onTaskClick}
                    onStatusChange={onStatusChange}
                    onDelete={onDelete}
                    resolveAgentName={resolveAgentName}
                  />
                ))
              ) : (
                <div className="border-b border-outline-variant px-4 py-3 text-body-small text-on-surface-variant">
                  No tasks
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
