/**
 * `/wallet` — portefeuille virtuel du joueur connecté (lecture seule).
 *
 * Crédit, débit et transfert restent pilotés côté système (ranked, tournois,
 * sanctions) : ils ne sont pas exposés au joueur. L'ajustement staff vit sur
 * `/admin/ops/wallets/:userId/adjust` (cf. `admin.ts`).
 */

import { z } from "zod";

import type {
	WalletBalance,
	WalletHistoryPage,
	WalletTransaction,
} from "@rosegriffon/achillea-types/domain/wallet";
import {
	WalletTransactionDirection,
	WalletTransactionType,
} from "@rosegriffon/achillea-types/enums/wallet";

import { AchilleaResource, type AchilleaClientResult } from "./http";

export const walletTransactionTypeSchema = z.enum(
	WalletTransactionType
) satisfies z.ZodType<WalletTransactionType>;
export const walletTransactionDirectionSchema = z.enum(
	WalletTransactionDirection
) satisfies z.ZodType<WalletTransactionDirection>;

export const walletBalanceSchema = z.object({
	balance: z.number(),
	currency: z.string(),
}) satisfies z.ZodType<WalletBalance>;

export const walletTransactionSchema = z.object({
	id: z.string(),
	type: walletTransactionTypeSchema,
	amount: z.number(),
	reason: z.string().nullable(),
	direction: walletTransactionDirectionSchema,
	createdAt: z.string(),
}) satisfies z.ZodType<WalletTransaction>;

export const walletHistoryPageSchema = z.object({
	transactions: z.array(walletTransactionSchema),
	total: z.number().optional(),
}) satisfies z.ZodType<WalletHistoryPage>;

export type WalletHistoryQuery = {
	limit?: number;
	offset?: number;
}

/** 2 routes. */
export class WalletResource extends AchilleaResource {
	/** `GET /wallet/me` — solde courant (le portefeuille est créé à la volée). */
	balance(): Promise<AchilleaClientResult<WalletBalance>> {
		return this.http.get("/wallet/me", walletBalanceSchema);
	}

	/** `GET /wallet/me/history` — journal des mouvements, du plus récent au plus ancien. */
	history(query: WalletHistoryQuery = {}): Promise<AchilleaClientResult<WalletHistoryPage>> {
		return this.http.get("/wallet/me/history", walletHistoryPageSchema, { query });
	}
}
