import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { clsx } from "clsx";
import { CircleButton, Icon, m3FocusRing } from "@aphrody/m3-primitives";
import type { DirectorySortBy, MediaSortBy } from "@aphrody/drive-client";

interface SortMenuPanelProps {
  sortBy: DirectorySortBy | MediaSortBy;
  onSortChange: (sort: DirectorySortBy | MediaSortBy) => void;
  viewMode: "grid" | "list" | "media" | "column";
}

export function SortMenuPanel({
  sortBy,
  onSortChange,
  viewMode,
}: SortMenuPanelProps) {
  const sortOptions =
    viewMode === "media"
      ? [
          { value: "datetaken", label: "Date de prise", icon: "photo_camera" },
          {
            value: "modified",
            label: "Date de modification",
            icon: "calendar_today",
          },
          {
            value: "created",
            label: "Date de création",
            icon: "calendar_today",
          },
          { value: "name", label: "Nom", icon: "sort_by_alpha" },
          { value: "size", label: "Taille", icon: "straighten" },
        ]
      : [
          { value: "name", label: "Nom", icon: "sort_by_alpha" },
          {
            value: "modified",
            label: "Date de modification",
            icon: "calendar_today",
          },
          { value: "size", label: "Taille", icon: "straighten" },
          { value: "type", label: "Type", icon: "description" },
        ];

  return (
    <div
      role="menu"
      aria-label="Trier par"
      className="w-60 bg-surface-container rounded-medium shadow-md3-3 overflow-hidden py-2 border border-outline-variant/50"
    >
      <div className="px-3 pb-2 text-title-small text-on-surface-variant border-b border-outline-variant/60 font-medium">
        Trier par
      </div>

      <div className="pt-2">
        {sortOptions.map((option) => {
          const isActive = sortBy === option.value;

          return (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              key={option.value}
              onClick={() => {
                onSortChange(option.value as DirectorySortBy | MediaSortBy);
              }}
              className={clsx(
                "flex items-center gap-3 w-full h-12 px-3 transition-colors ease-standard text-label-large",
                m3FocusRing,
                isActive
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface hover:bg-on-surface/8",
              )}
            >
              <Icon name={option.icon} size={20} filled={isActive} />
              <span className="flex-1 text-left">{option.label}</span>
              {isActive && <Icon name="check" size={20} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface SortMenuProps {
  sortBy: DirectorySortBy | MediaSortBy;
  onSortChange: (sort: DirectorySortBy | MediaSortBy) => void;
  viewMode: "grid" | "list" | "media" | "column";
  className?: string;
}

export function SortMenu({
  sortBy,
  onSortChange,
  viewMode,
  className,
}: SortMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, right: 0 });

  // Update position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        panelRef.current &&
        buttonRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <>
      <div className={clsx(className)}>
        <CircleButton
          ref={buttonRef}
          icon="sort"
          onClick={() => setIsOpen(!isOpen)}
          active={isOpen}
          title="Sort"
        />
      </div>

      {isOpen &&
        createPortal(
          <AnimatePresence>
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: -8 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  duration: m3Durations.medium1,
                  ease: m3Easings.emphasizedDecelerate,
                },
              }}
              exit={{
                opacity: 0,
                y: -8,
                transition: {
                  duration: m3Durations.short3,
                  ease: m3Easings.emphasizedAccelerate,
                },
              }}
              style={{
                position: "fixed",
                top: `${position.top}px`,
                right: `${position.right}px`,
              }}
              className="z-50"
            >
              <SortMenuPanel
                sortBy={sortBy}
                onSortChange={onSortChange}
                viewMode={viewMode}
              />
            </motion.div>
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
