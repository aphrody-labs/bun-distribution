import { Fraunces, JetBrains_Mono, Poppins } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { absoluteUrl } from "@/lib/site-url";

const fraunces = Fraunces({
  axes: ["opsz", "SOFT", "WONK"],
  display: "swap",
  subsets: ["latin"],
  variable: "--font-display-ds",
});

const jetbrains = JetBrains_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-mono-ds",
});

const poppins = Poppins({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-body-ds",
  weight: ["400", "500", "600", "700"],
});

const superCartoon = localFont({
  display: "swap",
  src: "../../../public/fonts/Super Cartoon.woff2",
  variable: "--font-cartoon-ds",
});

export const metadata = {
  alternates: { canonical: absoluteUrl("/design-system") },
  description:
    "Showcase du design system @rosegriffon/ui : 4 thèmes, tokens MD3, composants — DA Rose Griffon (manga / gaming / Inazuma).",
  title: "Design System — Rose Griffon",
};

export default function DesignSystemLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${fraunces.variable} ${jetbrains.variable} ${poppins.variable} ${superCartoon.variable} theme-roy min-h-screen bg-surface text-on-surface antialiased`}
    >
      {children}
    </div>
  );
}
