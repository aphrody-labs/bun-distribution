import { botAdmin } from "@/lib/bot-admin";

export const dynamic = "force-dynamic";

export default async function AdminSyncPage() {
  const [cron, bots, stats] = await Promise.all([
    botAdmin.cron().catch(() => ({ jobs: [] })),
    botAdmin.bots().catch(() => ({ bots: [] })),
    // B11 : réponse validée par le contrat (`{ stats: { totalUsers, … } }`), null si KO.
    botAdmin.stats().catch(() => null),
  ]);
  const totalUsers = stats?.stats.totalUsers ?? null;

  // Le bot n'a plus qu'un client Gateway (les personas historiques ne sont que
  // des aliases). Le dénominateur se lit donc dans l'inventaire, il ne se code
  // pas en dur à 6 : afficher « 1/6 » ferait croire à cinq clients en panne.
  const clientsDeclares = bots.bots.length;
  const clientsEnLigne = bots.bots.filter((b) => b.online).length;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8">
      <header>
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2">SYNCHRONISATION</h1>
        <p className="text-sm text-zinc-300 mb-1">
          Vue d'ensemble de l'architecture de données : comment la base de données du bot se
          synchronise avec Discord, le site et les sauvegardes automatiques. Utile pour comprendre
          les flux et diagnostiquer une désynchronisation.
        </p>
        <p className="text-xs text-dbz-blue-light uppercase tracking-widest">
          DB ↔ Discord ↔ Site · synchronisation quotidienne à 04:00 UTC
        </p>
      </header>

      {/* État global */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="dbz-panel p-4 text-center">
          <div className="text-3xl font-saiyan text-green-400">
            {clientsEnLigne}/{clientsDeclares || "—"}
          </div>
          <div className="text-xs uppercase tracking-widest text-dbz-blue-light mt-1">
            Clients Gateway en ligne
          </div>
        </div>
        <div className="dbz-panel p-4 text-center">
          <div className="text-3xl font-saiyan text-dbz-yellow">
            {totalUsers !== null ? totalUsers.toLocaleString("fr-FR") : "—"}
          </div>
          <div className="text-xs uppercase tracking-widest text-dbz-blue-light mt-1">
            Membres en base
          </div>
        </div>
        <div className="dbz-panel p-4 text-center">
          <div className="text-3xl font-saiyan text-dbz-orange">{cron.jobs.length}</div>
          <div className="text-xs uppercase tracking-widest text-dbz-blue-light mt-1">
            Tâches automatiques
          </div>
        </div>
        <div className="dbz-panel p-4 text-center">
          <div className="text-3xl font-saiyan text-pink-400">2</div>
          <div className="text-xs uppercase tracking-widest text-dbz-blue-light mt-1">
            Timers système (VPS)
          </div>
        </div>
      </div>

      {/* Diagramme architecture */}
      <section>
        <h2 className="text-2xl font-saiyan text-dbz-yellow uppercase mb-3">
          Comment les données circulent
        </h2>
        <p className="text-sm text-zinc-400 mb-3">
          Chaque action sur Discord déclenche une mise à jour en base de données en temps réel. Des
          tâches automatiques réconcilient la DB avec Discord chaque nuit.
        </p>
        <div className="dbz-panel p-6 space-y-4 font-mono text-xs leading-relaxed">
          <div>
            <div className="text-dbz-orange font-bold mb-1">
              Événements Discord → Base de données (temps réel)
            </div>
            <div className="pl-4 text-zinc-300 space-y-0.5">
              <div>• Arrivée d'un membre → création du profil en DB</div>
              <div>
                • Départ d'un membre → <span className="text-red-400">suppression en cascade</span>{" "}
                (XP, zénis, inventaire, succès)
              </div>
              <div>• Changement de rôle → recalcul du niveau et du rôle de rang</div>
              <div>
                • Message envoyé → +XP + <span className="text-dbz-yellow">zénis</span>
              </div>
              <div>• Vocal actif → +20 XP toutes les 60 secondes</div>
              <div>• Bio Discord contenant une URL → attribution du rôle « bio »</div>
            </div>
          </div>

          <div>
            <div className="text-dbz-orange font-bold mb-1">
              Tâches automatiques internes (toutes les N secondes)
            </div>
            <div className="pl-4 text-zinc-300 space-y-0.5">
              {cron.jobs.length === 0 && <div className="text-zinc-500">Aucune tâche chargée</div>}
              {cron.jobs.map((j) => (
                <div key={j.name}>
                  • <span className="text-dbz-yellow">{j.name}</span> — toutes les{" "}
                  {j.intervalMs < 60_000
                    ? `${Math.round(j.intervalMs / 1000)}s`
                    : `${Math.round(j.intervalMs / 60_000)} min`}{" "}
                  · {j.runCount} exécution{j.runCount > 1 ? "s" : ""} · dernière :{" "}
                  {j.lastRunAt ? new Date(j.lastRunAt).toLocaleString("fr-FR") : "jamais"}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-dbz-orange font-bold mb-1">
              Timers système VPS (réconciliation nocturne)
            </div>
            <div className="pl-4 text-zinc-300 space-y-0.5">
              <div>
                • <span className="text-dbz-yellow">shenron-backup.timer</span> 03:00 UTC —
                sauvegarde SQLite (VACUUM INTO) + compression 14 jours
              </div>
              <div>
                • <span className="text-dbz-yellow">shenron-guild-sync.timer</span> 04:00 UTC —
                réconciliation membres, niveaux et historique 24h
              </div>
            </div>
          </div>

          <div>
            <div className="text-dbz-orange font-bold mb-1">Site web (lecture seule via proxy)</div>
            <div className="pl-4 text-zinc-300 space-y-0.5">
              <div>• Base PostgreSQL du site → articles, wiki, profils utilisateurs</div>
              <div>
                • API publique du bot → classement, profil, boutique, stats (cache 30–300 s)
              </div>
              <div>• Flux SSE A2A → page « Événements » temps réel</div>
            </div>
          </div>
        </div>
      </section>

      {/* Réconciliation manuelle */}
      <section>
        <h2 className="text-2xl font-saiyan text-dbz-yellow uppercase mb-3">
          Réconciliation manuelle (urgence)
        </h2>
        <div className="dbz-panel p-6 space-y-3 text-sm">
          <p className="text-zinc-300">
            Si des membres Discord n'apparaissent pas en base de données (ou l'inverse), il est
            possible de forcer la réconciliation via SSH sur le VPS. La synchronisation automatique
            quotidienne (04:00 UTC) gère les cas courants ; cette procédure est réservée aux
            urgences.
          </p>
          <pre className="bg-dbz-bg border border-dbz-border p-3 text-xs text-dbz-yellow overflow-x-auto rounded">
            {`# Synchronisation rapide membres + rôles de niveau (< 30 s)
cd <racine du dépôt shenron sur le VPS>
bash scripts/shenron-guild-sync.sh

# OU via systemd (équivalent)
sudo systemctl start shenron-guild-sync.service
sudo journalctl -u shenron-guild-sync -f

# Reconstruction complète depuis l'historique Discord (lent, < 15 min)
cd apps/shenron/bot
bun scripts/recover-from-discord-history.ts --days 90 --concurrency 6`}
          </pre>
          <p className="text-xs text-zinc-500">
            Exécution automatique chaque nuit à 04:00 UTC via shenron-guild-sync.timer
          </p>
        </div>
      </section>
    </div>
  );
}
