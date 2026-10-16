// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/TaskStatusIcon.tsx), MIT, rebuilt on Material Design 3.

import { Icon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

import type { TaskStatus } from "./types";
import { TASK_STATUS_LABEL } from "./types";

/** Material Symbols glyph and M3 color role per status. */
const config: Record<TaskStatus, { icon: string; filled: boolean; color: string }> = {
  done: { icon: "check_circle", filled: true, color: "text-success" },
  in_progress: { icon: "clock_loader_40", filled: true, color: "text-primary" },
  ready: { icon: "radio_button_checked", filled: false, color: "text-primary" },
  pending_approval: { icon: "schedule", filled: false, color: "text-warning" },
  backlog: { icon: "radio_button_unchecked", filled: false, color: "text-outline" },
};

export interface TaskStatusIconProps {
  status: TaskStatus;
  size?: number;
  className?: string;
  /** Accessible label; defaults to the status label. Pass `""` for a decorative icon. */
  label?: string;
}

export function TaskStatusIcon({ status, size = 16, className, label }: TaskStatusIconProps) {
  const { icon, filled, color } = config[status];
  return (
    <Icon
      name={icon}
      size={size}
      filled={filled}
      label={label ?? TASK_STATUS_LABEL[status]}
      data-status={status}
      className={clsx(color, className)}
    />
  );
}
