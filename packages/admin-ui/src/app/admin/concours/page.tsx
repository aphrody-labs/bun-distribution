/**
 * /admin/concours — arbitrage du concours communautaire.
 *
 * Deux usages, dans cet ordre :
 *  1. le classement complet des noteurs (l'objet du prix) et des fortunes ;
 *  2. l'ouverture du dossier d'un membre (`?membre=<discordId>`) : chaque note,
 *     chaque avis, chaque commentaire, plus les signaux d'intégrité — le seul
 *     moyen de départager un gagnant d'un cliqueur d'étoiles.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { getMemberContributions, getTopRaters } from "@/lib/contributors";
import { getShenronLeaderboard, type LeaderboardEntry } from "@/lib/shenron";
import { MemberLedger } from "@/components/contest/MemberLedger";
import { formatZeni } from "@/lib/zeni";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Concours communauté" };

const ID_DISCORD = /^\d{5,25}$/;
const fmt = (n: number) => n.toLocaleString("fr-FR");
const dateFmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
      })
    : "—";

export default async function AdminConcoursPage({
  searchParams,
}: {
  searchParams: Promise<{ membre?: string }>;
}) {
  await requireAdmin();
  const { membre } = await searchParams;
  const selected = membre && ID_DISCORD.test(membre) ? membre : null;

  const [raters, richest, dossier] = await Promise.all([
    getTopRaters(200),
    getShenronLeaderboard(50, true, 0, "zeni", "general").catch(
      () => [] as LeaderboardEntry[],
    ),
    selected
      ? getMemberContributions(selected, { limit: 500, viewerIsAdmin: true })
      : Promise.resolve(null),
  ]);

  const totalRatings = raters.reduce((s, r) => s + r.ratings, 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-saiyan text-3xl text-dbz-orange">
          Concours communauté
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-white/55">
          {fmt(raters.length)} membres actifs · {fmt(totalRatings)} notes
          déposées. Clique un membre pour ouvrir son dossier complet (notes,
          avis, commentaires, signaux d&apos;intégrité).
        </p>
      </header>

      {selected && !dossier && (
        <p className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-sm text-amber-200">
          Aucun compte de site pour l&apos;identifiant {selected} : ce membre
          n&apos;a jamais lié son Discord au site, il ne peut donc pas avoir de
          notes.
        </p>
      )}

      {dossier && (
        <section className="rounded-3xl border border-dbz-orange/30 bg-[#141311] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-white/40">
                Dossier membre
              </p>
              <h2 className="font-saiyan text-2xl text-white">
                {dossier.member.username}
              </h2>
              <p className="font-mono text-xs text-white/40">
                {dossier.member.discordId}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/profil/${dossier.member.discordId}`}
                className="rounded border border-dbz-border px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white/70 hover:border-dbz-orange hover:text-dbz-orange"
              >
                Profil public
              </Link>
              <Link
                href="/admin/concours"
                className="rounded border border-dbz-border px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white/70 hover:border-dbz-orange hover:text-dbz-orange"
              >
                Fermer
              </Link>
            </div>
          </div>
          <MemberLedger data={dossier} showSignals />
        </section>
      )}

      <section>
        <h2 className="mb-3 font-saiyan text-xl uppercase text-white">
          Classement des noteurs (complet)
        </h2>
        {raters.length === 0 ? (
          <p className="text-sm text-white/45">Aucune note enregistrée.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-dbz-border">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead className="bg-dbz-border/40 text-left text-xs uppercase tracking-widest text-dbz-blue-light">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">Membre</th>
                  <th className="p-3 text-right">Notes</th>
                  <th className="p-3 text-right">Avis rédigés</th>
                  <th className="p-3 text-right">Commentaires</th>
                  <th className="p-3 text-right">Dernière activité</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-dbz-border/60">
                {raters.map((r) => (
                  <tr
                    key={r.userId}
                    className={
                      r.rank <= 3 ? "bg-dbz-yellow/5" : "hover:bg-white/[.03]"
                    }
                  >
                    <td className="p-3 font-saiyan text-lg text-dbz-orange">
                      #{r.rank}
                    </td>
                    <td className="p-3">
                      <span className="font-semibold text-white/85">
                        {r.username}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-white/30">
                        {r.discordId}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-amber-300">
                      {fmt(r.ratings)}
                    </td>
                    <td className="p-3 text-right font-mono text-white/65">
                      {fmt(r.ratingComments)}
                    </td>
                    <td className="p-3 text-right font-mono text-white/65">
                      {fmt(r.comments)}
                    </td>
                    <td className="p-3 text-right text-xs text-white/40">
                      {dateFmt(r.lastActivity)}
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/admin/concours?membre=${r.discordId}`}
                        className="rounded border border-dbz-border px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-white/60 hover:border-dbz-orange hover:text-dbz-orange"
                      >
                        Dossier
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-saiyan text-xl uppercase text-white">
          Top fortunes en Zénis
        </h2>
        {richest.length === 0 ? (
          <p className="text-sm text-white/45">
            L&apos;API du bot n&apos;a rien renvoyé (bot hors ligne ?).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-dbz-border">
            <table className="w-full min-w-[30rem] border-collapse text-sm">
              <thead className="bg-dbz-border/40 text-left text-xs uppercase tracking-widest text-dbz-blue-light">
                <tr>
                  <th className="p-3">#</th>
                  <th className="p-3">Membre</th>
                  <th className="p-3 text-right">Niveau</th>
                  <th className="p-3 text-right">Zénis</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-dbz-border/60">
                {richest.map((e, i) => (
                  <tr key={e.discordId} className="hover:bg-white/[.03]">
                    <td className="p-3 font-saiyan text-lg text-amber-300">
                      #{e.rank || i + 1}
                    </td>
                    <td className="p-3">
                      <span className="font-semibold text-white/85">
                        {e.username ?? `Guerrier #${e.discordId.slice(-4)}`}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-white/30">
                        {e.discordId}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono text-white/65">
                      {e.level}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-amber-300">
                      {formatZeni(e.zeni)}
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/admin/concours?membre=${e.discordId}`}
                        className="rounded border border-dbz-border px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-white/60 hover:border-dbz-orange hover:text-dbz-orange"
                      >
                        Dossier
                      </Link>
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
