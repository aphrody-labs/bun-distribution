import type { ReactNode } from "react";

export function AdminFrame({ children, sidebar }: { children: ReactNode; sidebar: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full flex-col bg-dbz-bg min-[600px]:flex-row">
      {sidebar}
      <main className="relative z-10 min-w-0 flex-1 p-4 min-[600px]:p-6 lg:p-10" id="admin-content">
        {children}
      </main>
    </div>
  );
}
