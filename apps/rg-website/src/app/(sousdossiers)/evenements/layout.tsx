import type { Metadata } from "next";
import type { ReactNode } from "react";

import { absoluteUrl } from "@/lib/site-url";

// La page est un composant client (`"use client"`) : elle ne peut pas exporter de
// `metadata`. Sans ce layout elle héritait du titre, de la description ET du
// canonique de l'accueil — soit la même fiche de résultat que la page d'accueil,
// dupliquée, et l'instruction de n'indexer que l'accueil.
export const metadata: Metadata = {
  alternates: { canonical: absoluteUrl("/evenements") },
  description:
    "L'agenda des événements Inazuma Eleven de l'association Rose Griffon : rencontres, tournois et conventions en France.",
  openGraph: {
    description:
      "L'agenda des événements Inazuma Eleven de l'association Rose Griffon : rencontres, tournois et conventions en France.",
    title: "Événements | Rose Griffon",
    type: "website",
    url: absoluteUrl("/evenements"),
  },
  title: "Événements | Rose Griffon",
};

export default function EvenementsLayout({ children }: { children: ReactNode }) {
  return children;
}
