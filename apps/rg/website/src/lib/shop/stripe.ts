/**
 * Instance Stripe partagée pour le shop Rose Griffon.
 * Singleton process-level (réutilisé entre invocations chaudes).
 * Mode auto : utilise STRIPE_SECRET_KEY (sk_test_… ou sk_live_…).
 */
import Stripe from "stripe";

import { SITE_URL } from "@/lib/site-url";

let cached: Stripe | null = null;

export function getStripe(): Stripe {
	if (cached) {
		return cached;
	}
	const key = process.env.STRIPE_SECRET_KEY;
	if (!key) {
		throw new Error("[shop] STRIPE_SECRET_KEY missing — voir .env.example pour la config Stripe.");
	}
	cached = new Stripe(key, {
		// Latest Stripe API version (cf. skill stripe-best-practices). Pin explicite
		// Pour éviter drift silencieux à chaque release Stripe.
		apiVersion: "2026-05-27.dahlia",
		typescript: true,
		// Auto-retry idempotent sur erreurs réseau / 5xx
		maxNetworkRetries: 2,
		timeout: 20_000,
		appInfo: {
			name: "rosegriffon.fr",
			url: SITE_URL,
		},
	});
	return cached;
}
