"use client";

import { useId, useState, useTransition } from "react";

import { addToCart } from "@/lib/shop/cart";
import { formatEuros } from "@/lib/shop/products";
import type { Product } from "@/lib/shop/products";
import { AddToCart } from "./add-to-cart";
import { MobileStickyCta } from "./mobile-sticky-cta";

export function VariantPickerWithCta({ product }: { product: Product }) {
  const groupName = useId();
  const variants = product.variants ?? [];
  const [selected, setSelected] = useState<string | undefined>();
  const [, startTransition] = useTransition();
  const selectedVariant = variants.find(v => v.id === selected);
  const displayPrice = selectedVariant?.priceCentsOverride ?? product.priceCents;

  const handleMobileAdd = () => {
    if (variants.length > 0 && !selected) {
      return;
    }
    startTransition(async () => {
      await addToCart(product.slug, selected, 1);
    });
  };

  if (variants.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-3xl font-extrabold text-white">{formatEuros(product.priceCents)}</p>
        <AddToCart product={product} size="lg" />
        <MobileStickyCta priceCents={product.priceCents} onAdd={handleMobileAdd} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-[#d4af37]">Choisis ta variante</h3>
        <div role="radiogroup" aria-label="Variantes du produit" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {variants.map(v => {
            const isActive = v.id === selected;
            const price = v.priceCentsOverride ?? product.priceCents;
            return (
              <label
                key={v.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-all motion-safe:duration-200 outline-hidden focus-within:ring-[3px] focus-within:ring-[#d4af37]/50 ${
                  isActive
                    ? "border-[#d4af37] bg-[#d4af37]/15 shadow-[0_2px_0_0_rgba(0,0,0,0.4)]"
                    : "border-[#d4af37]/30 bg-[#0c1730]/40 hover:border-[#d4af37]/60"
                }`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={v.id}
                  checked={isActive}
                  onChange={() => setSelected(v.id)}
                  className="sr-only"
                />
                <span className="text-sm font-semibold text-white">{v.label}</span>
                <span className={`text-sm font-bold ${isActive ? "text-[#d4af37]" : "text-white/70"}`}>
                  {formatEuros(price)}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex items-end justify-between gap-4 border-t border-[#d4af37]/30 pt-4">
        <div>
          <span className="block text-[10px] font-bold uppercase tracking-widest text-[#d4af37]">Total</span>
          <span className="block text-3xl font-extrabold text-white">{formatEuros(displayPrice)}</span>
        </div>
      </div>

      <AddToCart product={product} variantId={selected} size="lg" />

      <MobileStickyCta
        priceCents={displayPrice}
        label={selectedVariant?.label ?? "Choisis ta variante"}
        disabled={!selected}
        onAdd={handleMobileAdd}
      />
    </div>
  );
}
