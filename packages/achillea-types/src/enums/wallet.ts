/** Type de mouvement du portefeuille (doit matcher l'enum côté bot). */
export enum WalletTransactionType {
  Credit = "Credit",
  Debit = "Debit",
  Transfer = "Transfer",
  Payout = "Payout",
  Fine = "Fine",
}

/** Sens du mouvement vis-à-vis du solde du titulaire. */
export enum WalletTransactionDirection {
  In = "in",
  Out = "out",
}
