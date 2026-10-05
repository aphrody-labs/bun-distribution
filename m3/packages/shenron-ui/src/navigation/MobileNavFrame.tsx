import type { ReactNode } from "react";

export function MobileNavFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <nav
      aria-label={label}
      className="barre-nav fixed inset-x-0 bottom-0 z-[55] border-t-2 border-[var(--color-toriyama-ink,#121417)] bg-[rgba(14,14,18,0.96)] shadow-[0_-4px_20px_rgba(0,0,0,0.6)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
    >
      {children}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
