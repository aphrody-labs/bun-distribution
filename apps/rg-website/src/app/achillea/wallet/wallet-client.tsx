"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatAchCurrency } from "@/lib/achillea";
import type { WalletBalance } from "@rosegriffon/achillea-types/domain/wallet";
import { WalletTransactionDirection } from "@rosegriffon/achillea-types/enums/wallet";
import { Wallet, ArrowLeft, ShieldAlert, Coins, Loader2, ArrowUpRight, ArrowDownLeft, Info } from "lucide-react";
import { signalerException } from "@/lib/achillea/signaler";

type TransactionWebsite = {
  id: string;
  type: string;
  amount: number;
  reason: string | null;
  direction: WalletTransactionDirection;
  createdAt: string;
};

type EtatAcces = "verification" | "connecte" | "non_connecte" | "discord_absent" | "indisponible";

export default function WalletPage() {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<TransactionWebsite[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [etatAcces, setEtatAcces] = useState<EtatAcces>("verification");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/achillea/wallet", { credentials: "same-origin" })
      .then(async reponse => {
        if (cancelled) return;
        if (reponse.status === 401) {
          setEtatAcces("non_connecte");
          return;
        }
        if (reponse.status === 409) {
          setEtatAcces("discord_absent");
          return;
        }
        if (!reponse.ok) throw new Error(`wallet HTTP ${reponse.status}`);
        const donnees = (await reponse.json()) as {
          balance: WalletBalance;
          transactions: TransactionWebsite[];
        };
        setBalance(donnees.balance);
        setTransactions(donnees.transactions);
        setEtatAcces("connecte");
      })
      .catch(cause => {
        if (!cancelled) setEtatAcces("indisponible");
        signalerException("wallet", cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * La session arrive par un aller-retour réseau (`GET /auth/me`) : tant qu'il
   * n'a pas répondu, `isAuthenticated` vaut false. Rendre le mur tout de suite
   * annonce « Connexion requise » à un visiteur DÉJÀ connecté, à CHAQUE
   * chargement — c'est ce qui donne l'impression qu'Achilléa refuse l'accès.
   * Les pages d'administration attendaient déjà, celles-ci non.
   */
  if (etatAcces === "verification") {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center text-sm text-muted-foreground">
        Vérification de la session…
      </div>
    );
  }

  if (etatAcces === "non_connecte" || etatAcces === "discord_absent") {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-4">
        <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-xl font-bold">Connexion requise</h2>
        <p className="text-sm text-muted-foreground">
          {etatAcces === "discord_absent"
            ? "Liez votre compte Discord à votre profil Rose Griffon pour accéder à Achilléa."
            : "Connectez-vous pour consulter votre solde d'Achilléa Points et votre portefeuille."}
        </p>
        {etatAcces === "non_connecte" && (
          <Link
            href="/login?redirect=/achillea/wallet"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition shadow-sm text-xs"
          >
            Se connecter
          </Link>
        )}
      </div>
    );
  }

  if (etatAcces === "indisponible") {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center space-y-3">
        <ShieldAlert className="w-12 h-12 text-rose-400 mx-auto" />
        <h2 className="text-xl font-bold">Portefeuille temporairement indisponible</h2>
        <p className="text-sm text-muted-foreground">
          La base Achilléa ne répond pas encore. Réessayez dans un instant.
        </p>
      </div>
    );
  }

  const currentAmount = balance?.balance ?? 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-1 border-b border-border pb-6">
        <Link
          href="/achillea"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour au hub Achilléa
        </Link>
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Wallet className="w-5 h-5" />
          </span>
          <h1 className="text-3xl font-bold tracking-tight">Portefeuille Virtuel (ACH)</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Consultez votre réserve d'Achilléa Points (AP/ACH), vos gains de tournois et votre relevé d'opérations.
        </p>
      </div>

      {loading ? (
        <div className="py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Chargement de votre portefeuille...</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Balance Card */}
          <div className="border-2 border-border bg-gradient-to-br from-card via-card to-amber-500/5 rounded-3xl p-6 md:p-8 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-2 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2">
                <Coins className="w-5 h-5 text-amber-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Solde disponible
                </span>
              </div>
              <div className="text-4xl md:text-5xl font-black text-amber-400 font-mono tracking-tight">
                {formatAchCurrency(currentAmount)}
              </div>
              <p className="text-xs text-muted-foreground">Crédits cumulés utilisables lors des évènements Achilléa.</p>
            </div>

            <div className="p-4 rounded-2xl bg-background/80 border border-border text-xs space-y-2 max-w-sm">
              <div className="font-bold flex items-center gap-1 text-foreground">
                <Info className="w-4 h-4 text-primary" />
                Usage de la monnaie ACH
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Les points sont crédités automatiquement lors des victoires de tournois et paliers classés franchis.
              </p>
            </div>
          </div>

          {/* Transaction History */}
          <div className="border border-border rounded-2xl bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/20">
              <h3 className="font-bold text-xs uppercase text-muted-foreground">
                Historique des transactions ({transactions.length})
              </h3>
            </div>

            {transactions.length === 0 ? (
              <div className="py-16 text-center text-xs text-muted-foreground">
                Aucune transaction enregistrée pour ce compte.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {transactions.map(tx => {
                  const isCredit = tx.direction === WalletTransactionDirection.In;
                  return (
                    <div
                      key={tx.id}
                      className="p-4 flex items-center justify-between gap-4 hover:bg-muted/20 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isCredit
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                        </div>

                        <div>
                          <div className="font-bold text-xs text-foreground">
                            {tx.reason || (isCredit ? "Crédit de points" : "Débit")}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(tx.createdAt).toLocaleDateString("fr-FR", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                      </div>

                      <div className={`font-mono font-bold text-sm ${isCredit ? "text-emerald-400" : "text-rose-400"}`}>
                        {isCredit ? "+" : "-"}
                        {formatAchCurrency(tx.amount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
