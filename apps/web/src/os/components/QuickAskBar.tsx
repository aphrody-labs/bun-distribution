// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect, useRef } from "react";

interface QuickAskBarProps {
  isOpen: boolean;
  onClose: () => void;
  /** Absent while no assistant backend is wired: free text then gets an explicit answer instead. */
  onSubmitPrompt?: (prompt: string) => void;
  /** False when `appId` names no application. */
  onOpenApp: (appId: string) => boolean;
}

export const QuickAskBar: React.FC<QuickAskBarProps> = ({ isOpen, onClose, onSubmitPrompt, onOpenApp }) => {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResult(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // Check for math evaluation
    if (/^[0-9+\-*/().\s^%]+$/.test(q)) {
      try {
        // eslint-disable-next-line no-eval
        const calc = eval(q);
        setResult(`Result: ${calc}`);
        return;
      } catch {}
    }

    // Direct app opens
    if (q.toLowerCase().startsWith("open ")) {
      const app = q.toLowerCase().replace("open ", "").trim();
      if (onOpenApp(app)) onClose();
      else setResult(`Unknown application: '${app}'.`);
      return;
    }

    if (!onSubmitPrompt) {
      setResult("No assistant is connected: the question was not sent anywhere.");
      return;
    }
    onSubmitPrompt(q);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-16 p-4 animate-in fade-in duration-100"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl rounded-3xl bg-[var(--md-sys-color-surface-container)]/95 backdrop-blur-2xl border border-[var(--md-sys-color-outline-variant)] shadow-2xl overflow-hidden p-2 flex flex-col gap-2 animate-in zoom-in-95 duration-100"
      >
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-3 px-4 py-3 bg-[var(--md-sys-color-surface)] rounded-2xl border border-[var(--md-sys-color-outline-variant)]"
        >
          <span className="text-xl">⚡</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setResult(null);
            }}
            placeholder="Ask Aphrody Quick Ask, calculate, or type 'open terminal'..."
            className="flex-1 bg-transparent text-sm font-medium text-[var(--md-sys-color-on-surface)] outline-none placeholder:text-[var(--md-sys-color-on-surface-variant)]"
          />
          <kbd className="font-mono text-[10px] px-2 py-0.5 rounded bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)]">
            ESC
          </kbd>
        </form>

        {result && (
          <div className="px-4 py-2 text-xs font-mono text-emerald-400 bg-[var(--md-sys-color-surface)] rounded-xl">
            {result}
          </div>
        )}

        <div className="flex items-center justify-between px-3 py-1 text-[11px] text-[var(--md-sys-color-on-surface-variant)] font-mono">
          <span>Suggestions: 'open bunsh', 'open arcade', '24 * 60'</span>
          <span>Press Enter ↵</span>
        </div>
      </div>
    </div>
  );
};
