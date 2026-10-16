import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createPostgresClient } from "@rosegriffon/db/service";
import { getStripe } from "@/lib/shop/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook Stripe — handle paiement confirmé.
 * Pour activer en prod : `stripe listen --forward-to localhost:3000/api/webhook/stripe`
 * (dev) + secret dans STRIPE_WEBHOOK_SECRET. En prod : configurer le webhook
 * sur dashboard.stripe.com/webhooks vers https://rosegriffon.fr/api/webhook/stripe.
 *
 * Events handled :
 *   - `checkout.session.completed` → marquer la commande payée, déclencher fulfillment
 *   - `charge.refunded` → noter le refund
 *   - `payment_intent.payment_failed` → alerte log
 */
export async function POST(req: NextRequest) {
	const secret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!secret) {
		console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET missing — rejecting");
		return NextResponse.json({ error: "Not configured" }, { status: 503 });
	}
	// Garde : un secret au mauvais format (ex. valeur scellée "eyJ2Ijo…" au lieu de "whsec_…")
	// ferait planter constructEvent en 500 ; on rejette proprement en 503 + log explicite.
	if (!secret.startsWith("whsec_")) {
		console.error(
			"[stripe-webhook] STRIPE_WEBHOOK_SECRET mal formé (attendu whsec_…) — variable d'environnement à corriger",
		);
		return NextResponse.json({ error: "Webhook secret misconfigured" }, { status: 503 });
	}

	const sig = req.headers.get("stripe-signature");
	if (!sig) {
		return NextResponse.json({ error: "Missing signature" }, { status: 400 });
	}

	const stripe = getStripe();
	const body = await req.text();

	try {
		const event = stripe.webhooks.constructEvent(body, sig, secret);

		switch (event.type) {
			case "checkout.session.completed": {
				const session = event.data.object;
				console.info("[stripe-webhook] checkout completed", {
					amount: session.amount_total,
					email: session.customer_details?.email,
					id: session.id,
					patron: session.metadata?.patron_discount,
				});

				// Persist le miroir local de la commande (table `orders`).
				// Stripe reste la source de vérité — un échec d'upsert est loggué
				// En ERROR (monitoring catch) mais ne fait pas planter le webhook.
				let dbSync: "ok" | "skipped" | "failed" = "skipped";
				const supabase = createPostgresClient();
				if (!supabase) {
					console.error("[stripe-webhook] no admin supabase client — order NOT mirrored", {
						session_id: session.id,
					});
				} else {
					type OrderItem = {
						label: string | null;
						qty: number | null;
						slug: string | null;
						unit_amount_cents: number;
						variantId: string | null;
						image: string | null;
					};
					let items: OrderItem[] = [];
					try {
						const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
							expand: ["data.price.product"],
						});
						items = lineItems.data.map((item) => {
							const product = item.price?.product;
							const isProduct = typeof product === "object" && product && !("deleted" in product);
							const meta = isProduct ? product.metadata : {};
							const images = isProduct ? product.images : [];
							return {
								label: item.description,
								qty: item.quantity,
								slug: meta.slug || null,
								unit_amount_cents: item.price?.unit_amount || 0,
								variantId: meta.variantId || null,
								image: (images && images.length > 0 ? images[0] : null) ?? null,
							};
						});
					} catch (stripeErr) {
						console.error("[stripe-webhook] failed to fetch session line items", {
							error: stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
							session_id: session.id,
						});
					}

					const { error: upsertErr } = await supabase.from("orders").upsert(
						{
							amount_discount_cents: session.total_details?.amount_discount ?? 0,
							amount_shipping_cents: session.total_details?.amount_shipping ?? 0,
							amount_subtotal_cents: session.amount_subtotal ?? 0,
							amount_tax_cents: session.total_details?.amount_tax ?? 0,
							amount_total_cents: session.amount_total ?? 0,
							paid_at: new Date().toISOString(),
							patron_discount_applied: session.metadata?.patron_discount === "yes",
							shipping_address: session.collected_information?.shipping_details?.address ?? null,
							shipping_email: session.customer_details?.email ?? null,
							shipping_name: session.collected_information?.shipping_details?.name ?? null,
							shipping_phone: session.customer_details?.phone ?? null,
							status: "paid",
							stripe_customer_id:
								typeof session.customer === "string"
									? session.customer
									: (session.customer?.id ?? null),
							stripe_payment_intent_id:
								typeof session.payment_intent === "string"
									? session.payment_intent
									: (session.payment_intent?.id ?? null),
							stripe_session_id: session.id,
							user_id: session.metadata?.user_id !== "anonymous" ? session.metadata?.user_id : null,
							items: items,
						},
						{ onConflict: "stripe_session_id" }
					);
					if (upsertErr) {
						dbSync = "failed";
						console.error("[stripe-webhook] orders upsert FAILED", {
							amount: session.amount_total,
							code: upsertErr.code,
							email: session.customer_details?.email,
							error: upsertErr.message,
							session_id: session.id,
						});
					} else {
						dbSync = "ok";
					}
				}
				return NextResponse.json({ db_sync: dbSync, received: true });
			}
			case "charge.refunded": {
				const charge = event.data.object;
				console.info("[stripe-webhook] refund", {
					amount: charge.amount_refunded,
					id: charge.id,
				});
				break;
			}
			case "payment_intent.payment_failed": {
				const pi = event.data.object;
				console.warn("[stripe-webhook] payment failed", {
					id: pi.id,
					reason: pi.last_payment_error?.message,
				});
				break;
			}
			default: {
				// Ignore other events silently
				break;
			}
		}

		return NextResponse.json({ received: true });
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error("[stripe-webhook] signature verification failed:", msg);
		return NextResponse.json({ error: `Webhook error: ${msg}` }, { status: 400 });
	}
}
