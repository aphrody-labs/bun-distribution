"use client";

import { Check, Copy, Terminal } from "lucide-react";
import { useCallback, useState, type ReactElement } from "react";

export type ApiAccessProps = {
  path: string;
  description: string;
  variants?: Array<{ label: string; path: string }>;
  entryPath?: string;
  labels?: Partial<Record<"title" | "copy" | "open" | "entry", string>>;
  className?: string;
};

export function ApiAccess({
  path,
  description,
  variants = [],
  entryPath,
  labels = {},
  className = "",
}: ApiAccessProps): ReactElement {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((key: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(current => (current === key ? null : current)), 1600);
    });
  }, []);
  const absolute = (value: string) =>
    typeof window === "undefined" ? value : new URL(value, window.location.origin).toString();
  const text = {
    title: "API access",
    copy: "Copy curl command for",
    open: "Open",
    entry: "Entry point:",
    ...labels,
  };
  const lines = [{ label: "JSON", path }, ...variants];
  return (
    <section className={`rounded-xl border border-white/10 bg-white/[0.02] p-4 ${className}`} aria-label={text.title}>
      <div className="mb-3 flex items-center gap-2">
        <Terminal className="h-4 w-4 text-dbz-orange" aria-hidden="true" />
        <h2 className="font-display text-sm font-semibold tracking-wide text-white">{text.title}</h2>
        <span className="text-xs text-white/45">{description}</span>
      </div>
      <ul className="space-y-2">
        {lines.map(line => (
          <li key={line.path} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-white/40">
              {line.label}
            </span>
            <a
              href={line.path}
              className="min-w-0 flex-1 truncate rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-dbz-blue-light hover:text-dbz-orange"
            >
              {line.path}
            </a>
            <button
              type="button"
              onClick={() => copy(line.path, `curl -s ${absolute(line.path)}`)}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded border border-white/10 px-2 text-[11px] font-semibold text-white/70 transition-colors hover:border-dbz-orange hover:text-dbz-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dbz-yellow"
              aria-label={`${text.copy} ${line.label}`}
            >
              {copied === line.path ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              curl
            </button>
          </li>
        ))}
      </ul>
      {entryPath ? (
        <p className="mt-3 text-[11px] leading-relaxed text-white/40">
          {text.entry}{" "}
          <a href={entryPath} className="text-white/60 underline underline-offset-2">
            {entryPath}
          </a>
          .
        </p>
      ) : null}
    </section>
  );
}
