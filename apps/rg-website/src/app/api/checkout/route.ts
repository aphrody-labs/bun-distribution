import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getStripeCouponForUser } from "@/lib/patreon/discount";
import { getStripe } from "@/lib/shop/stripe";
import { getCart } from "@/lib/shop/cart";
import { getServerUser } from "@/lib/auth-helpers";
import { SITE_URL } from "@/lib/site-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cart = await getCart();
  if (cart.items.length === 0) {
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }

  try {
    const stripe = getStripe();

    let userId: string | null = null;
    let userEmail: string | undefined;
    try {
      const user = await getServerUser();
      if (user) {
        userId = user.id;
        userEmail = user.email ?? undefined;
      }
    } catch (error) {
      console.warn(
        "[checkout] Better Auth session retrieval failed — anonymous checkout",
        error instanceof Error ? error.message : String(error),
      );
    }

    const couponId = userId ? await getStripeCouponForUser(userId) : null;

    const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL;

    // Idempotency key par requête — protège contre double-clic / retry réseau.
    // Inclut l'identifiant user + signature du panier pour différencier des
    // Tentatives légitimement distinctes.
    const idempotencyKey = req.headers.get("x-idempotency-key") ?? `co_${randomUUID()}`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // Pas de `payment_method_types` — dynamic payment methods activés (Stripe
        // Pousse automatiquement card/Apple Pay/Google Pay/SEPA/Link selon eligibility
        // Et géo, géré côté dashboard.stripe.com/settings/payment_methods).
        locale: "fr",
        customer_email: userEmail,
        allow_promotion_codes: true,
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        phone_number_collection: { enabled: true },
        shipping_address_collection: {
          allowed_countries: ["FR", "BE", "CH", "LU", "DE", "ES", "IT", "NL", "PT", "GB", "CA"],
        },
        shipping_options: [
          {
            shipping_rate_data: {
              delivery_estimate: {
                maximum: { unit: "business_day", value: 7 },
                minimum: { unit: "business_day", value: 3 },
              },
              display_name: "Lettre suivie France",
              fixed_amount: { amount: 490, currency: "eur" },
              type: "fixed_amount",
            },
          },
          {
            shipping_rate_data: {
              delivery_estimate: {
                maximum: { unit: "business_day", value: 10 },
                minimum: { unit: "business_day", value: 4 },
              },
              display_name: "Colissimo suivi (UE)",
              fixed_amount: { amount: 990, currency: "eur" },
              type: "fixed_amount",
            },
          },
        ],
        line_items: cart.items.map(item => ({
          price_data: {
            currency: "eur",
            product_data: {
              description: item.product.tagline,
              images: [`${origin}${item.product.image}`],
              metadata: {
                slug: item.product.slug,
                variantId: item.variantId ?? "default",
              },
              name: item.variantLabel ? `${item.product.name} — ${item.variantLabel}` : item.product.name,
            },
            tax_behavior: "inclusive",
            unit_amount: item.unitPriceCents,
          },
          quantity: item.qty,
        })),
        discounts: couponId ? [{ coupon: couponId }] : undefined,
        metadata: {
          cart_signature: cart.items.map(i => `${i.slug}:${i.variantId ?? "_"}x${i.qty}`).join("|"),
          patron_discount: couponId ? "yes" : "no",
          source: "rosegriffon.fr/shop",
          user_id: userId ?? "anonymous",
        },
        success_url: `${origin}/shop/merci?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/shop/panier`,
      },
      { idempotencyKey },
    );

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("[checkout] Erreur création session Stripe:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Service de paiement indisponible" },
      { status: 503 },
    );
  }
}
