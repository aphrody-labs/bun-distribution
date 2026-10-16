import { Check, Home, ShoppingBag } from "lucide-react";
import Link from "next/link";

import { getStripe } from "@/lib/shop/stripe";
import { formatEuros } from "@/lib/shop/products";

export const metadata = {
  robots: { follow: false, index: false },
  title: "Merci · Commande Rose Griffon",
};

interface ThankYouProps {
  searchParams: Promise<{ session_id?: string }>;
}

export default async function ThankYouPage({ searchParams }: ThankYouProps) {
  const { session_id } = await searchParams;

  let total: number | null = null;
  let email: string | null = null;
  let lineCount = 0;

  if (session_id) {
    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ["line_items"],
      });
      total = session.amount_total ?? null;
      email = session.customer_details?.email ?? null;
      lineCount = session.line_items?.data.length ?? 0;
    } catch {
      // Session not found or env var manquante — fallback générique
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-[#d4af37] shadow-[0_4px_0_0_rgba(0,0,0,0.5)]">
        <Check className="size-10 text-[#0c1730]" strokeWidth={3} />
      </div>
      <h1 className="mt-6 text-fluid-display-lg font-extrabold tracking-tight text-white">Merci 🌹</h1>
      <p className="mt-4 max-w-md text-base text-white/80">
        Ta commande est confirmée. Tu vas recevoir un reçu Stripe par email
        {email ? (
          <>
            {" "}
            à <span className="font-semibold text-white">{email}</span>
          </>
        ) : null}
        .
      </p>

      {(total !== null || lineCount > 0) && (
        <dl className="mt-8 grid w-full max-w-sm grid-cols-2 gap-y-2 rounded-2xl border-2 border-[#d4af37]/40 bg-[#0c1730]/60 p-5 text-sm">
          {lineCount > 0 && (
            <>
              <dt className="text-left text-white/60">Articles</dt>
              <dd className="text-right font-semibold text-white">{lineCount}</dd>
            </>
          )}
          {total !== null && (
            <>
              <dt className="text-left text-white/60">Total réglé</dt>
              <dd className="text-right text-base font-extrabold text-[#d4af37]">{formatEuros(total)}</dd>
            </>
          )}
        </dl>
      )}

      <p className="mt-8 max-w-md text-sm text-white/70">
        On prépare ton colis sous 3 à 5 jours ouvrés. Une question ?{" "}
        <a
          href="mailto:contact@rose-griffon.fr"
          className="font-semibold text-[#d4af37] underline decoration-2 underline-offset-4"
        >
          contact@rose-griffon.fr
        </a>
      </p>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/shop"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full border-2 border-[#d4af37] bg-[#0c1730] px-6 text-sm font-extrabold uppercase tracking-wider text-[#d4af37] shadow-[0_3px_0_0_rgba(0,0,0,0.5)] transition-transform motion-safe:duration-200 hover:-translate-y-0.5"
        >
          <ShoppingBag className="size-4" />
          Continuer mes achats
        </Link>
        <Link
          href="/"
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#d4af37] px-6 text-sm font-extrabold uppercase tracking-wider text-[#0c1730] shadow-[0_3px_0_0_rgba(0,0,0,0.5)] transition-transform motion-safe:duration-200 hover:-translate-y-0.5"
        >
          <Home className="size-4" />
          Retour au site
        </Link>
      </div>
    </div>
  );
}
