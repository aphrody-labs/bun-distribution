// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect, useRef } from "react";
import type { AppId } from "./types";
import { DOCK_ITEMS } from "./Dock";

interface CommandItem {
  id: string;
  title: string;
  category: string;
  icon: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunchApp: (id: AppId) => void;
  onSetTheme: (seed: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onLaunchApp, onSetTheme }) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const commands: CommandItem[] = [
    ...DOCK_ITEMS.map(item => ({
      id: `app-${item.id}`,
      title: `Open ${item.title}`,
      category: "Applications",
      icon: item.icon,
      action: () => {
        onLaunchApp(item.id);
        onClose();
      },
    })),
    {
      id: "theme-emerald",
      title: "Theme: Cyber Emerald (#10b981)",
      category: "Appearance",
      icon: "🟢",
      action: () => {
        onSetTheme("#10b981");
        onClose();
      },
    },
    {
      id: "theme-sapphire",
      title: "Theme: Royal Sapphire (#3b82f6)",
      category: "Appearance",
      icon: "🔵",
      action: () => {
        onSetTheme("#3b82f6");
        onClose();
      },
    },
    {
      id: "theme-amber",
      title: "Theme: Solar Amber (#f59e0b)",
      category: "Appearance",
      icon: "🟡",
      action: () => {
        onSetTheme("#f59e0b");
        onClose();
      },
    },
    {
      id: "theme-rose",
      title: "Theme: Neon Rose (#f43f5e)",
      category: "Appearance",
      icon: "🔴",
      action: () => {
        onSetTheme("#f43f5e");
        onClose();
      },
    },
    {
      id: "theme-violet",
      title: "Theme: Ultra Violet (#8b5cf6)",
      category: "Appearance",
      icon: "🟣",
      action: () => {
        onSetTheme("#8b5cf6");
        onClose();
      },
    },
  ];

  const filtered = commands.filter(
    cmd =>
      cmd.title.toLowerCase().includes(query.toLowerCase()) || cmd.category.toLowerCase().includes(query.toLowerCase()),
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter") {
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-start justify-center pt-20 p-4 animate-in fade-in duration-100"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-xl rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)]">
          <span className="text-lg">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, app name, or theme..."
            className="flex-1 bg-transparent text-sm font-medium text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)]"
          />
          <kbd className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--md-sys-color-on-surface-variant)]">
              No matching commands or applications found.
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={cmd.id}
                  onClick={cmd.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between px-4 py-2.5 rounded-2xl text-left transition-colors ${
                    isSelected
                      ? "bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]"
                      : "hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">{cmd.icon}</span>
                    <span className="text-xs font-semibold">{cmd.title}</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-mono opacity-60">{cmd.category}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
