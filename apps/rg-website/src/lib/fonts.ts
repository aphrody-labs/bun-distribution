import { Lato, Noto_Sans, Poppins, Roboto } from "next/font/google";

// Body principal — preload activé.
export const roboto = Roboto({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-roboto",
  weight: ["400", "500", "700"],
});

// Titres marketing — preload activé.
export const poppins = Poppins({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["600", "700"],
});

// ============================================
// POLICES POUR LE THÈME AZALÉE
// ============================================
// Preload=false : n'apparaissent que sur pages secondaires —
// Ne pas pénaliser la home en preloadant inutilement.

export const notoSans = Noto_Sans({
  display: "swap",
  preload: false,
  subsets: ["latin"],
  variable: "--font-noto-sans",
  weight: ["400", "700"],
});

export const lato = Lato({
  display: "swap",
  preload: false,
  subsets: ["latin"],
  variable: "--font-lato",
  weight: ["400", "700"],
});
