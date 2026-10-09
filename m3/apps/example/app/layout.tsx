// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";
import type { ReactNode } from "react";
// oxlint-disable-next-line import/no-unassigned-import -- feuille de style globale du thème M3 (effet de bord voulu)
import "m3:theme.css";
// oxlint-disable-next-line import/no-unassigned-import -- feuille de style globale des polices M3 (effet de bord voulu)
import "m3:fonts.css";
// oxlint-disable-next-line import/no-unassigned-import -- feuille de style globale de l'application d'exemple (effet de bord voulu)
import "./globals.css";

export const metadata = {
  title: { default: "m3 example", template: "%s · m3 example" },
  description: "The App Router of @aphrody/m3 on Bun only.",
};

export const viewport = { themeColor: "#6750a4" };

const NAV = [
  ["/", "Home"],
  ["/people", "People"],
  ["/guestbook", "Guestbook"],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="flex items-center gap-6 px-6 h-16 bg-surface-container">
          <strong className="text-primary">m3</strong>
          <nav className="flex gap-4">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="text-on-surface-variant hover:text-primary">
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl p-6">{children}</main>
      </body>
    </html>
  );
}
