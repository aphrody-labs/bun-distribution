"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";

import { formatEuros } from "@/lib/shop/products";

export function CheckoutButton({ subtotalCents }: { subtotalCents: number }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Erreur Stripe");
      }
      window.location.href = data.url;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Erreur de checkout");
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handle}
        disabled={pending || subtotalCents === 0}
        className="group inline-flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#d4af37] px-6 text-base font-extrabold uppercase tracking-wider text-[#0c1730] shadow-[0_4px_0_0_rgba(0,0,0,0.5)] transition-all motion-safe:duration-200 hover:-translate-y-0.5 hover:bg-[#e8c668] hover:shadow-[0_6px_0_0_rgba(0,0,0,0.6)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 outline-hidden focus-visible:ring-[3px] focus-visible:ring-[#d4af37]/60"
      >
        {pending ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            <span>Redirection Stripe…</span>
          </>
        ) : (
          <>
            <span>Passer commande · {formatEuros(subtotalCents)}</span>
            <ArrowRight className="size-5 transition-transform motion-safe:duration-200 group-hover:translate-x-1" />
          </>
        )}
      </button>
      {error && <p className="text-center text-xs font-semibold text-[#a14b3f]">{error}</p>}
      <p className="text-center text-[10px] uppercase tracking-widest text-white/50">
        Paiement sécurisé Stripe · CB / Apple Pay / Google Pay
      </p>
    </div>
  );
}
