// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/InlineBranchCard.tsx), MIT, rebuilt on Material Design 3.

import { useId, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@aphrody/m3-primitives";
import { Markdown } from "./Markdown";
import { CircularIndicator, StatusChip, expandMotion, focusRing } from "./internal";

interface InlineBranchCardProps {
  description: string;
  completedAt: string | null;
  conclusion?: string | null;
  className?: string;
  /** Start expanded (uncontrolled). */
  defaultExpanded?: boolean;
}

/** A thinking branch as an M3 filled card: header, status chip, expandable conclusion. */
function InlineBranchCard({
  description,
  completedAt,
  conclusion,
  className,
  defaultExpanded = false,
}: InlineBranchCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isRunning = !completedAt;
  const contentId = useId();
  const canExpand = !!conclusion;

  return (
    <div className={clsx("group flex min-w-0 flex-col items-start", className)}>
      <div className="min-w-0 max-w-full overflow-hidden rounded-medium bg-surface-container text-on-surface">
        <button
          type="button"
          onClick={() => canExpand && setExpanded((v) => !v)}
          aria-expanded={canExpand ? expanded : undefined}
          aria-controls={canExpand ? contentId : undefined}
          className={clsx(
            "flex w-full items-start gap-3 rounded-medium px-4 py-3 text-left transition-colors duration-200 ease-standard",
            canExpand && "hover:bg-on-surface/8 active:bg-on-surface/10",
            focusRing,
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center">
            {isRunning ? (
              <CircularIndicator size={20} label="Thinking" />
            ) : (
              <div className="flex size-8 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
                <Icon name="alt_route" size={18} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 self-center">
            <div className="flex items-center gap-2">
              <div className="line-clamp-2 min-w-0 flex-1 text-title-small text-on-surface">
                {description}
              </div>
              <StatusChip tone={isRunning ? "primary" : "success"}>
                {isRunning ? "thinking" : "done"}
              </StatusChip>
            </div>
          </div>
          {canExpand && (
            <Icon
              name="expand_more"
              size={20}
              className={clsx(
                "mt-1.5 shrink-0 text-on-surface-variant transition-transform duration-300 ease-emphasized",
                expanded ? "rotate-180" : "",
              )}
            />
          )}
        </button>
        <AnimatePresence initial={false}>
          {expanded && conclusion ? (
            <motion.div
              id={contentId}
              key="conclusion"
              {...expandMotion}
              className="overflow-hidden"
            >
              <div className="border-t border-outline-variant px-4 py-3">
                <Markdown content={conclusion} size="small" className="text-on-surface-variant" />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

export { InlineBranchCard };
export type { InlineBranchCardProps };
