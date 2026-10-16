"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, Code2 } from "lucide-react";
import { PlainField } from "../editor/PlainField";

/**
 * Éditeur JSON visuel : textarea monospace avec validation `JSON.parse` live,
 * prettify/minify, badge OK/erreur.
 */
export function JsonEditor({
  value,
  onChange,
  rows = 8,
  placeholder = "{}",
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value.trim()) {
      setError(null);
      return;
    }
    try {
      JSON.parse(value);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [value]);

  const prettify = () => {
    try {
      onChange(JSON.stringify(JSON.parse(value || "{}"), null, 2));
    } catch {
      /* ignore */
    }
  };

  const minify = () => {
    try {
      onChange(JSON.stringify(JSON.parse(value || "{}")));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex-1 space-y-2">
      <PlainField
        value={value}
        onChange={onChange}
        minRows={rows}
        maxRows={40}
        placeholder={placeholder}
        monospace
        spellCheck={false}
      />
      <div className="flex items-center gap-2 text-xs">
        {error ? (
          <span className="inline-flex items-center gap-1 text-red-400">
            <AlertCircle className="h-3 w-3" /> {error}
          </span>
        ) : value.trim() ? (
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <Check className="h-3 w-3" /> JSON valide
          </span>
        ) : (
          <span className="text-white/50">Vide</span>
        )}
        <button
          type="button"
          onClick={prettify}
          disabled={!!error}
          className="ml-auto btn btn-ghost px-2"
          title="Prettify"
        >
          <Code2 className="h-3 w-3" /> Prettify
        </button>
        <button type="button" onClick={minify} disabled={!!error} className="btn btn-ghost px-2" title="Minify">
          Minify
        </button>
      </div>
    </div>
  );
}

/** Devine si une string ressemble à du JSON (commence par `[` ou `{`). */
export function looksLikeJson(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}
