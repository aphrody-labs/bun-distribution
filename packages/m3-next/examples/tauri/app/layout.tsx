// SPDX-License-Identifier: Apache-2.0
import { M3Root } from "@aphrody/m3-next/server";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "M3 for Tauri" };

export default function RootLayout({ children }: { children: ReactNode }) {
  // No `mode` and no `readCookie`: with `tauri: true` the shell is static and the pre-paint script applies the saved
  // preference from the cookie the client provider writes.
  return <M3Root bodyClassName="min-h-screen p-6">{children}</M3Root>;
}
