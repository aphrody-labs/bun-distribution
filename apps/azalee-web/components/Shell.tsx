"use client";

import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@rosegriffon/ui";
import { AppSidebar, MobileBottomNav, TopAppBar, type UserProfile } from "@rosegriffon/app-shell";

export {
  TopAppBar,
  DesktopTopBar,
  MobileHeader,
  Header,
  type TopAppBarProps,
} from "@rosegriffon/app-shell";

export interface ShellProps {
  children: ReactNode;
  user?: unknown | null;
  profile?: UserProfile | null;
  defaultOpen?: boolean;
  themeToggleSlot?: ReactNode;
}

/** Chrome de l'application Azalée : barre latérale, barre supérieure et navigation mobile partagées. */
export function Shell({ children, user = null, profile = null, defaultOpen = true, themeToggleSlot }: ShellProps) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <TopAppBar appName="Azalée" homeHref="/" user={user} profile={profile} themeToggleSlot={themeToggleSlot} />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <MobileBottomNav />
      </SidebarInset>
    </SidebarProvider>
  );
}

export { Shell as AppShell };
export default Shell;
