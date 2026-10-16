import { t } from "elysia";

export const BillingModel = {
  stripeWebhookResponse: t.Object({
    received: t.Boolean(),
    db_sync: t.Optional(t.String()),
  }),
  errorResponse: t.Object({
    error: t.String(),
  }),
} as const;
