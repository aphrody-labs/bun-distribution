import { Sparkles } from "lucide-react";
import Link from "next/link";

import { PATRON_DISCOUNT_PERCENT, getPatronDiscount } from "@/lib/patreon/discount";
import { getServerUser } from "@/lib/auth-helpers";

export async function PatreonDiscountBanner() {
  let userId: string | null = null;
  try {
    const user = await getServerUser();
    userId = user?.id ?? null;
  } catch {
    // Not logged in
  }

  if (!userId) {
    return (
      <aside
        aria-live="polite"
        className="rounded-2xl border-2 border-[#d4af37]/40 bg-gradient-to-r from-[#0c1730] via-[#0c1730]/95 to-[#a14b3f]/30 p-4 text-white shadow-[0_3px_0_0_rgba(0,0,0,0.4)]"
      >
        <p className="flex items-start gap-3 text-sm">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-[#d4af37]" />
          <span>
            <strong className="font-extrabold text-[#d4af37]">
              Patrons Rose Griffon · {PATRON_DISCOUNT_PERCENT}% de réduction
            </strong>{" "}
            sur toute la boutique. Connecte-toi à ton compte pour appliquer la remise automatiquement au checkout — ou
            rejoins le Patreon depuis{" "}
            <Link
              href="/nous-soutenir"
              className="font-semibold underline decoration-[#d4af37] decoration-2 underline-offset-4 hover:text-[#d4af37]"
            >
              /nous-soutenir
            </Link>
            .
          </span>
        </p>
      </aside>
    );
  }

  const discount = await getPatronDiscount(userId);
  if (!discount.active) {
    return (
      <aside
        aria-live="polite"
        className="rounded-2xl border-2 border-[#d4af37]/40 bg-[#0c1730] p-4 text-white shadow-[0_3px_0_0_rgba(0,0,0,0.4)]"
      >
        <p className="flex items-start gap-3 text-sm">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-[#d4af37]" />
          <span>
            Tu n'as pas (encore) lié ton Patreon, ou ton tier n'est plus actif. Active ton soutien sur{" "}
            <Link
              href="/nous-soutenir"
              className="font-semibold underline decoration-[#d4af37] decoration-2 underline-offset-4 hover:text-[#d4af37]"
            >
              /nous-soutenir
            </Link>{" "}
            pour débloquer{" "}
            <strong className="font-extrabold text-[#d4af37]">{PATRON_DISCOUNT_PERCENT}% sur la boutique</strong>.
          </span>
        </p>
      </aside>
    );
  }

  const tier = discount.tierTitles[0] ?? "Patron";
  return (
    <aside
      aria-live="polite"
      className="relative overflow-hidden rounded-2xl border-2 border-[#d4af37] bg-gradient-to-r from-[#a14b3f] via-[#0c1730] to-[#0c1730] p-4 text-white shadow-[0_3px_0_0_rgba(0,0,0,0.5)]"
    >
      <div aria-hidden className="absolute -right-8 -top-8 size-32 rounded-full bg-[#d4af37]/20 blur-2xl" />
      <p className="relative flex items-center gap-3 text-sm">
        <Sparkles className="size-5 shrink-0 text-[#d4af37]" />
        <span>
          <strong className="font-extrabold text-[#d4af37]">{tier} ✓</strong> — ta remise{" "}
          <strong className="font-extrabold text-white">-{discount.percent}%</strong> sera appliquée automatiquement au
          checkout. Merci pour ton soutien 🌹
        </span>
      </p>
    </aside>
  );
}
