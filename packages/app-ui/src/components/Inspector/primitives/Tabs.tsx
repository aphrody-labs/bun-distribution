import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { type IconSource, m3FocusRing, renderIcon } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { useState } from "react";

interface Tab {
  id: string;
  label: string;
  icon: IconSource;
  badge?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

/**
 * Icon-only M3 segmented tabs for the Inspector supporting pane: a `rounded-full` track on
 * `surface-container`, the active tab carries the `secondary-container` indicator (filled glyph),
 * inactive tabs get the on-surface state layer. Labels show as M3 plain tooltips.
 */
export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  return (
    <div role="tablist" className={clsx("flex gap-0.5 rounded-full bg-surface-container p-0.5", className)}>
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;
        const isHovered = hoveredTab === tab.id;

        return (
          <div key={tab.id} className="relative">
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={tab.label}
              onClick={() => onChange(tab.id)}
              onMouseEnter={() => setHoveredTab(tab.id)}
              onMouseLeave={() => setHoveredTab(null)}
              className={clsx(
                "relative flex h-8 min-w-10 items-center justify-center rounded-full px-2 transition-colors duration-200 ease-standard",
                m3FocusRing,
                isActive
                  ? "text-on-secondary-container"
                  : "text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface",
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 rounded-full bg-secondary-container"
                  transition={{
                    duration: m3Durations.short4,
                    ease: m3Easings.standard,
                  }}
                />
              )}
              <div className="relative z-10 flex items-center justify-center">
                {renderIcon(tab.icon, { size: 18, filled: isActive })}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-label-small text-on-primary">
                    {tab.badge}
                  </span>
                )}
              </div>
            </button>

            {/* Plain tooltip */}
            {isHovered && !isActive && (
              <motion.div
                role="tooltip"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.3,
                  duration: m3Durations.short3,
                  ease: m3Easings.emphasizedDecelerate,
                }}
                className="pointer-events-none absolute top-full left-1/2 z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-extra-small bg-inverse-surface px-2 py-1 text-body-small text-inverse-on-surface"
              >
                {tab.label}
              </motion.div>
            )}
          </div>
        );
      })}
    </div>
  );
}
