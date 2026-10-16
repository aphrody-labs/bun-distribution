import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { getCart } from "@/lib/shop/cart";
import { absoluteUrl, SITE_URL } from "@/lib/site-url";
import { CartIconButton } from "./_components/cart-icon-button";

export const metadata = {
  alternates: { canonical: absoluteUrl("/shop") },
  description:
    "Stickers, prints, badges, t-shirts et packs personnage édition limitée illustrés par les artistes de la communauté Rose Griffon.",
  openGraph: {
    description: "Produits collector Inazuma Eleven France — packs personnage, prints A5, stickers, badges, textile.",
    images: ["/RG_Logo_V2.5.webp"],
    title: "Boutique Rose Griffon",
  },
  title: "Boutique · Rose Griffon",
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  contactPoint: {
    "@type": "ContactPoint",
    availableLanguage: ["French"],
    contactType: "Customer Service",
    email: "contact@rose-griffon.fr",
  },
  logo: absoluteUrl("/RG_Logo_V2.5.webp"),
  name: "Association Rose Griffon",
  sameAs: [
    "https://twitter.com/rosegriffon_fr",
    "https://www.tiktok.com/@rose-griffon",
    "https://discord.gg/rosegriffon",
    "https://www.patreon.com/rosegriffon",
  ],
  url: SITE_URL,
};

export default async function ShopLayout({ children }: { children: ReactNode }) {
  const cart = await getCart();

  return (
    <div className="relative min-h-screen bg-[#0c1730] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      {/* Grain overlay */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          backgroundSize: "240px 240px",
        }}
      />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b-2 border-[#d4af37]/40 bg-[#0c1730]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0c1730]/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
          <Link
            href="/shop"
            className="group inline-flex items-center gap-3 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[#d4af37]/50 rounded-full"
          >
            <span className="relative grid size-10 place-items-center rounded-full bg-white shadow-[0_2px_0_0_rgba(0,0,0,0.5)] transition-transform motion-safe:duration-200 group-hover:rotate-12">
              <Image src="/RG_Logo_V2.5.webp" alt="" width={26} height={26} className="size-6" aria-hidden />
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#d4af37]">Boutique</span>
              <span className="text-base font-extrabold text-white">Rose Griffon</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <HeaderLink href="/shop">Catalogue</HeaderLink>
            <HeaderLink href="/nous-soutenir">Patreon</HeaderLink>
            <HeaderLink href="/">← Site</HeaderLink>
          </nav>

          <CartIconButton initialCount={cart.itemCount} />
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10">{children}</div>

      {/* Footer */}
      <footer className="relative z-10 mt-24 border-t-2 border-[#d4af37]/40 bg-[#0c1730]/80">
        <div className="mx-auto max-w-7xl px-4 py-12 md:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d4af37]">Association Rose Griffon</p>
              <p className="mt-2 max-w-md text-sm text-white/70">
                Inazuma Eleven France — illustrations originales, packs collector et goodies imprimés en France.
                Soutiens-nous via{" "}
                <Link
                  href="/nous-soutenir"
                  className="font-semibold text-[#d4af37] underline decoration-[#d4af37] decoration-2 underline-offset-4"
                >
                  Patreon
                </Link>{" "}
                pour débloquer -20% à vie sur la boutique.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs uppercase tracking-widest text-white/60 md:text-right">
              <dt>Livraison</dt>
              <dd className="text-white">France 4,90€ · UE 9,90€</dd>
              <dt>Délai</dt>
              <dd className="text-white">3-10 jours ouvrés</dd>
              <dt>Paiement</dt>
              <dd className="text-white">Stripe · CB / Apple Pay</dd>
              <dt>Support</dt>
              <dd className="text-white">
                <a
                  href="mailto:contact@rose-griffon.fr"
                  className="text-[#d4af37] underline decoration-2 underline-offset-2"
                >
                  contact@rose-griffon.fr
                </a>
              </dd>
            </dl>
          </div>
        </div>
      </footer>
    </div>
  );
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider text-white/80 transition-colors motion-safe:duration-200 hover:bg-[#d4af37]/15 hover:text-[#d4af37] outline-hidden focus-visible:ring-[3px] focus-visible:ring-[#d4af37]/50"
    >
      {children}
    </Link>
  );
}
