import type { Metadata } from "next";
import type { ReactNode } from "react";

import { absoluteUrl } from "@/lib/site-url";

// Page client : voir `../evenements/layout.tsx` pour la raison d'être de ce layout.
export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/emotes-showcase") },
  description:
    "La galerie des émotes Rose Griffon : toutes les illustrations Inazuma Eleven dessinées pour la communauté.",
  openGraph: {
    description:
      "La galerie des émotes Rose Griffon : toutes les illustrations Inazuma Eleven dessinées pour la communauté.",
    title: "Galerie des émotes | Rose Griffon",
    type: "website",
    url: absoluteUrl("/emotes-showcase"),
  },
  title: "Galerie des émotes | Rose Griffon",
};

export default function EmotesShowcaseLayout({ children }: { children: ReactNode }) {
  return children;
}
