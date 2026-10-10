import type { ReactNode } from "react";

export const metadata = { title: { default: "Fixture", template: "%s | Fixture" }, description: "m3 App Router fixture" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav id="nav">nav</nav>
        {children}
      </body>
    </html>
  );
}
