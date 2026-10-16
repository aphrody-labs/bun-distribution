/**
 * Règles du portefeuille — signe des mouvements, agrégation d'un solde.
 *
 * Pur : aucune I/O. Le serveur tient la vérité du solde en base, mais le
 * client doit pouvoir reconstituer et vérifier localement (affichage optimiste,
 * mode hors ligne d'une app mobile).
 */

import {
  WalletTransactionDirection,
  WalletTransactionType,
  type WalletBalance,
  type WalletTransaction,
} from "@rosegriffon/achillea-types";

/** Types de mouvement qui créditent le titulaire. */
const CREDITING_TYPES: readonly WalletTransactionType[] = [WalletTransactionType.Credit, WalletTransactionType.Payout];

/**
 * Sens d'un mouvement déduit de son type, quand l'API ne l'a pas renseigné.
 * `Transfer` est ambigu par nature : il dépend du point de vue, donc on se fie
 * au `direction` servi par l'API et on ne le devine jamais.
 */
export function inferDirection(type: WalletTransactionType): WalletTransactionDirection | null {
  if (CREDITING_TYPES.includes(type)) return WalletTransactionDirection.In;
  if (type === WalletTransactionType.Debit || type === WalletTransactionType.Fine) {
    return WalletTransactionDirection.Out;
  }
  return null;
}

/** Montant signé d'un mouvement du point de vue du titulaire. */
export function signedAmount(transaction: WalletTransaction): number {
  const amount = Math.abs(transaction.amount);
  return transaction.direction === WalletTransactionDirection.In ? amount : -amount;
}

/** Somme signée d'une liste de mouvements. */
export function netAmount(transactions: readonly WalletTransaction[]): number {
  return transactions.reduce((sum, tx) => sum + signedAmount(tx), 0);
}

/** Applique une liste de mouvements à un solde de départ. */
export function applyTransactions(opening: WalletBalance, transactions: readonly WalletTransaction[]): WalletBalance {
  return { ...opening, balance: opening.balance + netAmount(transactions) };
}

/** `true` si le solde couvre une dépense de `amount`. */
export function canAfford(balance: WalletBalance, amount: number): boolean {
  return Number.isFinite(amount) && amount >= 0 && balance.balance >= amount;
}

/** Ventilation par type, pour un récapitulatif ou un graphique. */
export function totalsByType(transactions: readonly WalletTransaction[]): Record<WalletTransactionType, number> {
  const totals = {
    [WalletTransactionType.Credit]: 0,
    [WalletTransactionType.Debit]: 0,
    [WalletTransactionType.Transfer]: 0,
    [WalletTransactionType.Payout]: 0,
    [WalletTransactionType.Fine]: 0,
  };
  for (const tx of transactions) {
    totals[tx.type] = (totals[tx.type] ?? 0) + Math.abs(tx.amount);
  }
  return totals;
}
