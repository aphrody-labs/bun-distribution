import type { Metadata } from "next";

import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: {
    default: "Azalée — Le Wiki Inazuma Eleven: Victory Road | Rose Griffon",
    template: "%s | Wiki Azalée | Rose Griffon",
  },
  description:
    "Base de données complète Inazuma Eleven: Victory Road. Personnages, techniques, objets, quêtes et wiki communautaire.",
  icons: {
    icon: "/RG_Azalee-logo.webp",
    shortcut: "/RG_Azalee-logo.webp",
    apple: "/RG_Azalee-logo.webp",
  },
  openGraph: {
    title: "Azalée — Le Wiki Inazuma Eleven: Victory Road",
    description:
      "Base de données complète Inazuma Eleven: Victory Road. Personnages, techniques, objets, quêtes et wiki communautaire.",
    url: absoluteUrl("/wiki"),
    siteName: "Azalée Wiki",
    locale: "fr_FR",
    type: "website",
    images: [
      {
        url: "/RG_Azalee-logo.webp",
        width: 1200,
        height: 630,
        alt: "Logo Azalée Wiki",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Azalée — Le Wiki Inazuma Eleven: Victory Road",
    description:
      "Base de données complète Inazuma Eleven: Victory Road. Personnages, techniques, objets, quêtes et wiki communautaire.",
    images: ["/RG_Azalee-logo.webp"],
  },
};

export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return <div className="wiki-scope min-h-full">{children}</div>;
}
