// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/TaskPriorityIcon.tsx), MIT, rebuilt on Material Design 3.

import { Icon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";

import type { TaskPriority } from "./types";
import { TASK_PRIORITY_LABEL } from "./types";

/** Material Symbols glyph and M3 color role per priority. */
const config: Record<TaskPriority, { icon: string; filled: boolean; color: string }> = {
  critical: { icon: "priority_high", filled: true, color: "text-error" },
  high: { icon: "keyboard_double_arrow_up", filled: false, color: "text-warning" },
  medium: { icon: "drag_handle", filled: false, color: "text-primary" },
  low: { icon: "keyboard_arrow_down", filled: false, color: "text-outline" },
};

export interface TaskPriorityIconProps {
  priority: TaskPriority;
  size?: number;
  className?: string;
  /** Accessible label; defaults to the priority label. Pass `""` for a decorative icon. */
  label?: string;
}

export function TaskPriorityIcon({ priority, size = 14, className, label }: TaskPriorityIconProps) {
  const { icon, filled, color } = config[priority];
  return (
    <Icon
      name={icon}
      size={size}
      filled={filled}
      weight={600}
      label={label ?? `${TASK_PRIORITY_LABEL[priority]} priority`}
      data-priority={priority}
      className={clsx(color, className)}
    />
  );
}
