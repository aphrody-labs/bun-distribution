import { t } from "elysia";

export const WalletModel = {
	balance: t.Object({
		balance: t.Number(),
		currency: t.String(),
	}),
	history: t.Object({
		transactions: t.Array(t.Object({
			id: t.String(),
			type: t.String(),
			amount: t.Number(),
			reason: t.Nullable(t.String()),
			direction: t.Union([t.Literal("in"), t.Literal("out")]),
			createdAt: t.String(),
		})),
	}),
	unauthorized: t.Object({ message: t.Literal("Authentication required") }),
};
