"use client";

/**
 * /admin/ursaf — URSAF (Union de Recouvrement des Saiyens et Autres Fraudeurs)
 * et inflation du serveur.
 *
 * Ordre de lecture voulu : d'abord SIMULER (ce que l'URSAF imposerait
 * aujourd'hui, sans rien écrire), ensuite seulement lancer un cycle. Le mode
 * réel (`economy.ursaf.mode` : off / notice / collect) se règle dans les
 * paramètres ; cette page n'active rien toute seule.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { formatZeni } from "@/lib/zeni";

type Notice = {
  id: number;
  reference: string;
  userId: string;
  flagIds: number[];
  taxable: number;
  rate: number;
  amount: number;
  collected: number;
  severity: string;
  status: "pending" | "notified" | "collected" | "cancelled";
  createdAt: number;
  note: string | null;
};

type Assessment = {
  userId: string;
  taxable: number;
  rate: number;
  amount: number;
  severity: string;
  flagIds: number[];
};

type Inflation = {
  enabled: boolean;
  index: number;
  referenceSupply: number;
  supply: number;
  change7d: number;
  ceiling: number;
  history: Array<{ day: string; supply: number; index: number }>;
};

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const STATUS_LABEL: Record<Notice["status"], string> = {
  pending: "En attente",
  notified: "Notifié",
  collected: "Recouvré",
  cancelled: "Annulé",
};

export default function AdminUrsafPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("all");
  const [simulation, setSimulation] = useState<{ mode: string; assessments: Assessment[] } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const notices = useQuery({
    queryKey: ["ursaf-notices", status],
    queryFn: () => api.get<{ notices: Notice[] }>(`/ursaf/notices?status=${status}&limit=200`),
  });
  const inflation = useQuery({
    queryKey: ["economy-inflation"],
    queryFn: () => api.get<Inflation>("/public/economy/inflation"),
  });

  async function run<T>(label: string, fn: () => Promise<T>, done: (r: T) => string) {
    setBusy(label);
    setMessage(null);
    try {
      const r = await fn();
      setMessage(done(r));
      await qc.invalidateQueries({ queryKey: ["ursaf-notices"] });
      await qc.invalidateQueries({ queryKey: ["economy-inflation"] });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Échec");
    } finally {
      setBusy(null);
    }
  }

  const totalSimule = simulation?.assessments.reduce((s, a) => s + a.amount, 0) ?? 0;
  const inf = inflation.data;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-saiyan text-3xl text-dbz-orange">URSAF &amp; inflation</h1>
        <p className="mt-1 max-w-3xl text-sm text-white/55">
          L&apos;URSAF transforme les signalements anti-triche en avis d&apos;imposition : seuls les
          gains au-delà des seuils sont imposés, sans double comptage, au plus 95 % et jamais plus
          de la moitié du solde. Les zénis recouvrés sont détruits. Le mode (
          <code>economy.ursaf.mode</code> : off, notice ou collect) et l&apos;inflation (
          <code>economy.inflation.enabled</code>) se règlent dans les{" "}
          <Link href="/admin/settings" className="text-dbz-orange hover:underline">
            paramètres
          </Link>
          .
        </p>
      </header>

      {message && (
        <p
          role="status"
          className="rounded-xl border border-white/10 bg-white/[.03] p-3 text-sm text-white/80"
        >
          {message}
        </p>
      )}

      {/* ── Inflation ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-[#151412] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-saiyan text-xl text-white">Indice des prix</h2>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "snapshot",
                () => api.post<{ index: number; supply: number }>("/economy/inflation/snapshot"),
                (r) => `Instantané : masse ${formatZeni(r.supply)}, indice ×${nf.format(r.index)}.`,
              )
            }
            className="rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:border-dbz-yellow hover:text-dbz-yellow disabled:opacity-50"
          >
            Prendre un instantané
          </button>
        </div>
        {inf ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["Statut", inf.enabled ? "Active" : "Inactive"],
              ["Indice", `×${nf.format(inf.index)}`],
              ["7 jours", `${inf.change7d > 0 ? "+" : ""}${nf.format(inf.change7d)} %`],
              ["Masse monétaire", formatZeni(inf.supply)],
              ["Plafond", `×${nf.format(inf.ceiling)}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/10 bg-black/25 p-3">
                <dt className="text-[10px] uppercase tracking-wider text-white/45">{k}</dt>
                <dd className="mt-1 font-semibold text-white">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-white/45">
            {inflation.isLoading ? "Chargement…" : "Indisponible."}
          </p>
        )}
        {inf && inf.history.length > 1 && (
          <ol className="mt-4 flex h-16 items-end gap-1" aria-label="Historique de l'indice">
            {inf.history.map((p) => {
              const h = Math.max(6, ((p.index - 1) / Math.max(0.01, inf.ceiling - 1)) * 100);
              return (
                <li
                  key={p.day}
                  title={`${p.day} · ×${nf.format(p.index)} · ${formatZeni(p.supply)}`}
                  className="flex-1 rounded-t bg-dbz-orange/60"
                  style={{ height: `${Math.min(100, h)}%` }}
                />
              );
            })}
          </ol>
        )}
      </section>

      {/* ── Rattrapage des signalements ───────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-[#151412] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-saiyan text-xl text-white">Rattrapage des signalements</h2>
            <p className="mt-1 max-w-2xl text-xs text-white/50">
              L&apos;anti-triche n&apos;était branché sur aucun gain avant le 12/09 : le farm du
              morpion n&apos;a levé aucun signalement. Le rattrapage rejoue les règles sur les gains
              de jeu de la période (jamais sur les crédits admin), sans geler personne.
            </p>
          </div>
          <div className="flex gap-2">
            {[true, false].map((dryRun) => (
              <button
                key={String(dryRun)}
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (
                    !dryRun &&
                    !window.confirm("Écrire les signalements de rattrapage (7 jours) ?")
                  )
                    return;
                  void run(
                    dryRun ? "backfill-dry" : "backfill",
                    () =>
                      api.post<{
                        flags: number;
                        scannedGains: number;
                        users: Array<{ userId: string; flags: number }>;
                      }>("/anticheat/backfill", { days: 7, dryRun }),
                    (r) =>
                      `${dryRun ? "Simulation" : "Écrit"} : ${r.flags} signalements pour ${r.users.length} membres (${r.scannedGains} gains relus).`,
                  );
                }}
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                  dryRun
                    ? "border-dbz-yellow/60 text-dbz-yellow hover:bg-dbz-yellow/10"
                    : "border-red-400/60 text-red-300 hover:bg-red-500/10"
                }`}
              >
                {dryRun ? "Simuler (7 jours)" : "Écrire les signalements"}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Simulation ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-[#151412] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-saiyan text-xl text-white">Simulation des avis</h2>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "assess",
                  () =>
                    api.post<{ mode: string; assessments: Assessment[] }>("/ursaf/assess", {
                      dryRun: true,
                    }),
                  (r) => {
                    setSimulation(r);
                    return `Simulation : ${r.assessments.length} avis possibles (mode actuel : ${r.mode}).`;
                  },
                )
              }
              className="rounded-xl border border-dbz-yellow/60 px-3 py-1.5 text-xs font-semibold text-dbz-yellow hover:bg-dbz-yellow/10 disabled:opacity-50"
            >
              Simuler (rien n&apos;est écrit)
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (
                  !window.confirm(
                    "Lancer un cycle URSAF selon le mode configuré ? En mode collect, les zénis sont prélevés.",
                  )
                )
                  return;
                void run(
                  "run",
                  () =>
                    api.post<{ mode: string; created: number; collected: number }>("/ursaf/run"),
                  (r) =>
                    r.mode === "off"
                      ? "Mode off : aucun avis émis."
                      : `Cycle ${r.mode} : ${r.created} avis créés, ${r.collected} recouvrés.`,
                );
              }}
              className="rounded-xl border border-red-400/60 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
            >
              Lancer un cycle
            </button>
          </div>
        </div>
        {simulation && (
          <>
            <p className="mt-3 text-sm text-white/60">
              {simulation.assessments.length} avis · total {formatZeni(totalSimule)}
            </p>
            {simulation.assessments.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="bg-white/[.03] text-left text-xs uppercase tracking-wider text-white/45">
                    <tr>
                      <th className="p-2">Membre</th>
                      <th className="p-2 text-right">Base</th>
                      <th className="p-2 text-right">Taux</th>
                      <th className="p-2 text-right">Avis</th>
                      <th className="p-2">Sévérité</th>
                      <th className="p-2">Signalements</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {simulation.assessments.map((a) => (
                      <tr key={a.userId}>
                        <td className="p-2">
                          <Link
                            href={`/admin/concours?membre=${a.userId}`}
                            className="font-mono text-xs text-dbz-orange hover:underline"
                          >
                            {a.userId}
                          </Link>
                        </td>
                        <td className="p-2 text-right font-mono">{formatZeni(a.taxable)}</td>
                        <td className="p-2 text-right">{Math.round(a.rate * 100)} %</td>
                        <td className="p-2 text-right font-mono font-semibold text-dbz-yellow">
                          {formatZeni(a.amount)}
                        </td>
                        <td className="p-2 text-xs">{a.severity}</td>
                        <td className="p-2 text-xs text-white/50">
                          {a.flagIds.map((i) => `#${i}`).join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Avis émis ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-white/10 bg-[#151412] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-saiyan text-xl text-white">Avis d&apos;imposition</h2>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-white"
            aria-label="Filtrer par statut"
          >
            <option value="all">Tous</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {notices.isLoading ? (
          <p className="mt-3 text-sm text-white/45">Chargement…</p>
        ) : (notices.data?.notices.length ?? 0) === 0 ? (
          <p className="mt-3 text-sm text-white/45">Aucun avis.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-white/[.03] text-left text-xs uppercase tracking-wider text-white/45">
                <tr>
                  <th className="p-2">Référence</th>
                  <th className="p-2">Membre</th>
                  <th className="p-2 text-right">Avis</th>
                  <th className="p-2 text-right">Recouvré</th>
                  <th className="p-2">Statut</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {notices.data!.notices.map((n) => (
                  <tr key={n.id}>
                    <td className="p-2 font-mono text-xs">{n.reference}</td>
                    <td className="p-2 font-mono text-xs">{n.userId}</td>
                    <td className="p-2 text-right font-mono">{formatZeni(n.amount)}</td>
                    <td className="p-2 text-right font-mono">{formatZeni(n.collected)}</td>
                    <td className="p-2 text-xs">{STATUS_LABEL[n.status]}</td>
                    <td className="p-2 text-right">
                      {n.status !== "cancelled" && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => {
                            const note = window.prompt(
                              n.status === "collected"
                                ? "Annuler et REMBOURSER cet avis ? Motif :"
                                : "Annuler cet avis ? Motif :",
                            );
                            if (note === null) return;
                            void run(
                              `cancel-${n.id}`,
                              () => api.post(`/ursaf/notices/${n.id}/cancel`, { note }),
                              () =>
                                `Avis ${n.reference} annulé${n.status === "collected" ? " et remboursé" : ""}.`,
                            );
                          }}
                          className="rounded-xl border border-white/15 px-2 py-1 text-[11px] font-semibold text-white/60 hover:border-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          Annuler
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
