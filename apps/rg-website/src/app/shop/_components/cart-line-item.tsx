"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTransition } from "react";

import { removeFromCart, updateQty } from "@/lib/shop/cart";
import type { CartItemResolved } from "@/lib/shop/cart";
import { formatEuros } from "@/lib/shop/products";

export function CartLineItem({ item }: { item: CartItemResolved }) {
  const [pending, startTransition] = useTransition();

  const update = (delta: number) => {
    startTransition(async () => {
      await updateQty(item.id, item.qty + delta);
    });
  };

  const remove = () => {
    startTransition(async () => {
      await removeFromCart(item.id);
    });
  };

  return (
    <li
      data-pending={pending || undefined}
      className="grid grid-cols-[96px_1fr_auto] items-center gap-4 rounded-2xl border-2 border-[#d4af37]/40 bg-[#0c1730]/60 p-3 transition-opacity motion-safe:duration-200 data-[pending]:opacity-60"
    >
      <Link href={`/shop/${item.slug}`} className="relative aspect-square overflow-hidden rounded-xl bg-[#0c1730]">
        <Image src={item.product.image} alt={item.product.name} fill sizes="96px" className="object-cover" />
      </Link>

      <div className="min-w-0">
        <Link href={`/shop/${item.slug}`} className="block truncate text-sm font-bold text-white hover:text-[#d4af37]">
          {item.product.name}
        </Link>
        {item.variantLabel && <p className="mt-0.5 truncate text-xs text-white/60">{item.variantLabel}</p>}
        <div className="mt-2 inline-flex items-center gap-1 rounded-full border-2 border-[#d4af37]/40 bg-[#0c1730]">
          <button
            type="button"
            onClick={() => update(-1)}
            disabled={pending || item.qty <= 1}
            aria-label="Diminuer la quantité"
            className="grid size-7 place-items-center rounded-full text-[#d4af37] transition-colors motion-safe:duration-200 hover:bg-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-40 outline-hidden focus-visible:ring-[2px] focus-visible:ring-[#d4af37]/50"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="min-w-6 text-center text-xs font-bold text-white">{item.qty}</span>
          <button
            type="button"
            onClick={() => update(+1)}
            disabled={pending || item.qty >= 10}
            aria-label="Augmenter la quantité"
            className="grid size-7 place-items-center rounded-full text-[#d4af37] transition-colors motion-safe:duration-200 hover:bg-[#d4af37]/15 disabled:cursor-not-allowed disabled:opacity-40 outline-hidden focus-visible:ring-[2px] focus-visible:ring-[#d4af37]/50"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <span className="text-base font-extrabold text-white">{formatEuros(item.lineTotalCents)}</span>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label={`Retirer ${item.product.name} du panier`}
          className="grid size-8 place-items-center rounded-full text-white/50 transition-colors motion-safe:duration-200 hover:bg-[#a14b3f]/20 hover:text-[#a14b3f] outline-hidden focus-visible:ring-[2px] focus-visible:ring-[#a14b3f]/50"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </li>
  );
}
