import { botAdmin } from "@/lib/bot-admin";

export const dynamic = "force-dynamic";

type Channel = {
  id: string;
  name: string;
  type: number;
  parentId?: string;
  position?: number;
};
type Role = {
  id: string;
  name: string;
  color: number;
  hexColor?: string;
  position: number;
  managed: boolean;
  memberCount?: number;
};

const CHANNEL_TYPES: Record<number, { label: string; description: string }> = {
  0: {
    label: "Salons texte",
    description: "Salons où les membres écrivent des messages",
  },
  2: { label: "Salons vocaux", description: "Salons pour discuter en vocal" },
  4: { label: "Catégories", description: "Groupes organisateurs de salons" },
  5: { label: "Annonces", description: "Salons de publication d'annonces" },
  13: { label: "Scènes", description: "Événements audio en direct" },
  15: { label: "Forums", description: "Espaces de discussion thématiques" },
};

export default async function AdminDiscordPage() {
  const [channelsData, rolesData] = await Promise.all([
    botAdmin.discord.channels().catch(() => ({ channels: [] })),
    botAdmin.roles("shenron").catch(() => ({ roles: [] })),
  ]);
  const channels = channelsData.channels as Channel[];
  const roles = (rolesData.roles ?? []) as Role[];

  const groupedChannels = channels.reduce<Record<number, Channel[]>>((acc, c) => {
    (acc[c.type] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="w-full max-w-6xl mx-auto space-y-10">
      <header>
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2">SERVEUR DISCORD</h1>
        <p className="text-sm text-dbz-blue-light mb-1">
          Vue en direct de votre serveur Discord : salons et rôles actuels.
        </p>
        <p className="text-xs text-white/50 uppercase tracking-widest">
          {channels.length} salon{channels.length !== 1 ? "s" : ""} · {roles.length} rôle
          {roles.length !== 1 ? "s" : ""}
        </p>
      </header>

      {channels.length === 0 && roles.length === 0 && (
        <div className="dbz-panel p-6 text-center text-white/50">
          <p className="text-lg font-saiyan text-dbz-orange mb-2">Données indisponibles</p>
          <p className="text-sm">Le bot ne répond pas ou n&apos;est pas connecté au serveur Discord.</p>
        </div>
      )}

      <section>
        <h2 className="text-2xl font-saiyan text-dbz-yellow uppercase mb-1">Salons</h2>
        <p className="text-xs text-white/50 mb-4">
          Les salons sont regroupés par type. Chaque salon affiche son nom et son identifiant interne Discord.
        </p>
        {channels.length === 0 ? (
          <div className="dbz-panel p-6 text-center text-white/50">Aucun salon accessible.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(groupedChannels)
              .toSorted((a, b) => Number(a[0]) - Number(b[0]))
              .map(([type, list]) => {
                const meta = CHANNEL_TYPES[Number(type)] ?? {
                  label: `Type ${type}`,
                  description: "Type de salon non reconnu",
                };
                return (
                  <div key={type} className="dbz-panel p-4">
                    <h3 className="font-saiyan text-base text-dbz-blue-light mb-0.5 uppercase">
                      {meta.label} <span className="text-white/50 font-mono text-xs normal-case">({list.length})</span>
                    </h3>
                    <p className="text-[10px] text-white/50 mb-3">{meta.description}</p>
                    <ul className="space-y-1 text-xs">
                      {list
                        .toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))
                        .map(c => (
                          <li key={c.id} className="flex justify-between items-center gap-2">
                            <span className="text-white font-medium truncate">#{c.name}</span>
                            <span
                              className="text-gray-600 font-mono text-[10px] shrink-0"
                              title={`ID Discord : ${c.id}`}
                            >
                              {c.id}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-saiyan text-dbz-yellow uppercase mb-1">Rôles</h2>
        <p className="text-xs text-white/50 mb-4">
          Rôles du serveur classés par priorité décroissante. Les rôles &laquo;&nbsp;gérés&nbsp;&raquo; appartiennent à
          un bot ou une intégration.
        </p>
        {roles.length === 0 ? (
          <div className="dbz-panel p-6 text-center text-white/50">Aucun rôle accessible.</div>
        ) : (
          <div className="dbz-panel overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead className="bg-dbz-border/50 border-b-2 border-dbz-border">
                <tr>
                  <th className="p-2 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                    Priorité
                  </th>
                  <th className="p-2 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                    Nom du rôle
                  </th>
                  <th className="p-2 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                    Couleur
                  </th>
                  <th className="p-2 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                    Identifiant
                  </th>
                  <th className="p-2 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                    Info
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dbz-border">
                {[...roles]
                  .toSorted((a, b) => b.position - a.position)
                  .map(r => {
                    const hexColor = r.hexColor ?? (r.color !== 0 ? `#${r.color.toString(16).padStart(6, "0")}` : null);
                    return (
                      <tr key={r.id} className="hover:bg-dbz-blue-light/5">
                        <td className="p-2 font-mono text-xs text-gray-500">{r.position}</td>
                        <td className="p-2">
                          <span
                            className="font-bold"
                            style={{
                              color: hexColor ?? undefined,
                            }}
                          >
                            {r.name}
                          </span>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-4 h-4 border border-dbz-border rounded-sm shrink-0"
                              style={{
                                backgroundColor: hexColor ?? "transparent",
                              }}
                            />
                            <code className="text-[10px] font-mono text-gray-400">{hexColor ?? "—"}</code>
                          </div>
                        </td>
                        <td className="p-2 font-mono text-[10px] text-gray-600" title={`ID Discord : ${r.id}`}>
                          {r.id}
                        </td>
                        <td className="p-2 text-[10px]">
                          {r.managed ? (
                            <span className="text-dbz-orange">Géré (bot)</span>
                          ) : (
                            <span className="text-white/20">Manuel</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
