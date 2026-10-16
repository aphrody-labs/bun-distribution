import type { WalletTransactionDirection, WalletTransactionType } from "../enums/wallet";

/**
 * Portefeuille — un solde par utilisateur dans une devise virtuelle (ex. ACH)
 * plus un journal de mouvements.
 */
export interface WalletBalance {
	balance: number;
	currency: string;
}

/** Une ligne du journal des transactions (`GET /wallet/me/history`). */
export interface WalletTransaction {
	/** PostgreSQL UUID of the immutable transaction row. */
	id: string;
	type: WalletTransactionType;
	amount: number;
	reason: string | null;
	direction: WalletTransactionDirection;
	createdAt: string;
}

export interface WalletHistoryPage {
	transactions: WalletTransaction[];
	total?: number;
}
