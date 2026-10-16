import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";

export abstract class BillingService {
  public static async recordOrder(
    db: Kysely<Database>,
    order: {
      stripe_session_id: string;
      stripe_payment_intent_id?: string | null;
      stripe_customer_id?: string | null;
      user_id?: string | null;
      status: string;
      amount_subtotal_cents: number;
      amount_total_cents: number;
      amount_discount_cents: number;
      amount_shipping_cents: number;
      amount_tax_cents: number;
      shipping_name?: string | null;
      shipping_email?: string | null;
      shipping_phone?: string | null;
      shipping_address?: Record<string, unknown> | null;
      items?: unknown;
      patron_discount_applied?: boolean;
      paid_at?: string | null;
    },
  ): Promise<void> {
    await db
      .insertInto("orders")
      .values({
        stripe_session_id: order.stripe_session_id,
        stripe_payment_intent_id: order.stripe_payment_intent_id ?? null,
        stripe_customer_id: order.stripe_customer_id ?? null,
        user_id: order.user_id ?? null,
        status: order.status,
        amount_subtotal_cents: order.amount_subtotal_cents,
        amount_total_cents: order.amount_total_cents,
        amount_discount_cents: order.amount_discount_cents,
        amount_shipping_cents: order.amount_shipping_cents,
        amount_tax_cents: order.amount_tax_cents,
        shipping_name: order.shipping_name ?? null,
        shipping_email: order.shipping_email ?? null,
        shipping_phone: order.shipping_phone ?? null,
        shipping_address: order.shipping_address ?? null,
        items: order.items ?? null,
        patron_discount_applied: Boolean(order.patron_discount_applied),
        paid_at: order.paid_at ?? new Date().toISOString(),
      })
      .execute();
  }
}
