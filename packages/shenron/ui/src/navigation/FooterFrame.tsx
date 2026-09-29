import type { ReactNode } from "react";

export function FooterFrame({ children }: { children: ReactNode }) {
  return <footer className="relative mt-auto bg-[#070707] border-t border-white/[0.06]">{children}</footer>;
}
