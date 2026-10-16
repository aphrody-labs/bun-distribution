import { Elysia, status } from "elysia";
import { dbPlugin } from "../../plugins/db";
import { BillingModel } from "./model";

export const billingController = new Elysia({ prefix: "/billing" })
	.use(dbPlugin)
	.post("/webhooks/stripe", async ({ request }) => {
		const sig = request.headers.get("stripe-signature");
		if (!sig) {
			return status(400, { error: "Missing signature" });
		}
		// Simulation ou hook de traitement immédiat
		return { received: true, db_sync: "ok" };
	}, {
		response: {
			200: BillingModel.stripeWebhookResponse,
			400: BillingModel.errorResponse,
			503: BillingModel.errorResponse
		}
	});
