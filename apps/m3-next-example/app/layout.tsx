// SPDX-License-Identifier: Apache-2.0
import { generateM3Metadata, generateM3Viewport } from "@aphrody/m3-next";
import { M3Root } from "@aphrody/m3-next/server";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

// next/font needs literal arguments in the module that calls it, so the font is loaded here and handed to
// M3Root, which points the M3 reference typefaces at it.
const roboto = localFont({
  src: "../../../packages/m3-fonts/fonts/web/RobotoFlex-latin.woff2",
  variable: "--font-roboto-flex",
  weight: "100 1000",
  display: "swap",
});

export const metadata: Metadata = generateM3Metadata({
  name: "M3 on Next 16",
  description: "Base UI, Tailwind v4 and Material 3 on Next.js 16, built and served on Bun.",
});
export const viewport: Viewport = generateM3Viewport();

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Cache Components: the shell is static. The theme preference is read in the browser (pre-paint script and client
    // provider), and /theme reads the cookie on the server inside <Suspense>.
    <M3Root
      readCookie={false}
      className={roboto.variable}
      typefaces={{
        brand: "var(--font-roboto-flex), system-ui, sans-serif",
        plain: "var(--font-roboto-flex), system-ui, sans-serif",
      }}
      bodyClassName="min-h-screen bg-surface text-on-surface"
    >
      {children}
    </M3Root>
  );
}
