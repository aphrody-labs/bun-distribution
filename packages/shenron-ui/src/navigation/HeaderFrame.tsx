import type { ReactNode } from "react";

export function HeaderFrame({ children }: { children: ReactNode }) {
  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-white/10"
      style={{ viewTransitionName: "site-header" }}
    >
      <div className="absolute inset-0 -z-10 bg-[rgba(10,10,14,0.92)] backdrop-blur-2xl backdrop-saturate-150" />
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-dbz-orange" />
      <div className="h-[env(safe-area-inset-top)]" />
      <div className="page-shell flex h-16 items-center justify-between gap-3 xl:gap-6">
        {children}
      </div>
    </header>
  );
}
