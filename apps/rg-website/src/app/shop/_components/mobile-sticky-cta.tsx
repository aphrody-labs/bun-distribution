"use client";

import { ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";

import { formatEuros } from "@/lib/shop/products";

/**
 * Sticky CTA mobile pour les pages produit. Apparaît après scroll > 60%
 * de la hauteur du viewport (au-delà de la galerie au-dessus du fold).
 * Cache automatiquement sur ≥ md (le bouton "Ajouter" reste dans la sticky aside).
 */
export function MobileStickyCta({
  priceCents,
  label,
  disabled,
  onAdd,
}: {
  priceCents: number;
  label?: string;
  disabled?: boolean;
  onAdd: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => {
      const threshold = window.innerHeight * 0.4;
      setVisible(window.scrollY > threshold);
    };
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-x-0 bottom-0 z-40 border-t-2 border-[#d4af37] bg-[#0c1730]/95 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 shadow-[0_-4px_20px_rgba(0,0,0,0.5)] backdrop-blur md:hidden ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
      } transition-all motion-safe:duration-300`}
    >
      <div className="mx-auto flex max-w-md items-center justify-between gap-3">
        <div>
          <span className="block text-[9px] font-bold uppercase tracking-widest text-[#d4af37]">
            {label ?? "Total"}
          </span>
          <span className="text-xl font-extrabold leading-none text-white">{formatEuros(priceCents)}</span>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[#d4af37] px-5 text-xs font-extrabold uppercase tracking-wider text-[#0c1730] shadow-[0_3px_0_0_rgba(0,0,0,0.5)] transition-transform motion-safe:duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[#d4af37]/60"
        >
          <ShoppingBag className="size-4" />
          {disabled ? "Choisis option" : "Au panier"}
        </button>
      </div>
    </div>
  );
}
