"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bot as BotIcon, ChevronDown, Globe, Hash, Wifi } from "lucide-react";
import { api } from "@aphrody/admin-ui/client";
import { formatDuration } from "@aphrody/admin-ui/format";
import { BotSelector, useBotId } from "@aphrody/admin-ui/components/admin/BotSelector";

interface Command {
  name: string;
  description: string;
  type: number;
  guildId: string | null;
  nsfw: boolean;
  options: Array<{
    name: string;
    description: string;
    type: number;
    required: boolean;
    choices?: Array<{ name: string; value: string | number }>;
  }>;
}

interface Guild {
  id: string;
  name: string;
  memberCount: number;
  iconUrl: string | null;
  joinedAt: string | null;
}

interface BotInfo {
  id: string;
  name: string;
  username: string | null;
  avatar: string | null;
  online: boolean;
  uptime: number | null;
  wsPing: number;
  guilds: Guild[];
  commandCount: number;
}

const TYPE_LABELS: Record<number, string> = {
  1: "slash",
  2: "ctx. utilisateur",
  3: "ctx. message",
};

const OPTION_TYPES: Record<number, string> = {
  1: "sous-commande",
  2: "groupe sous-cmd",
  3: "texte",
  4: "entier",
  5: "oui/non",
  6: "utilisateur",
  7: "salon",
  8: "rôle",
  9: "mention",
  10: "nombre",
  11: "fichier",
};

export default function BotPage() {
  const [botId, setBotId] = useBotId();

  const info = useQuery({
    queryKey: ["bot", botId, "info"],
    queryFn: () => api.get<BotInfo>(`/bots/${botId}`),
    staleTime: 10_000,
  });
  const cmds = useQuery({
    queryKey: ["bot", botId, "commands"],
    queryFn: () => api.get<{ commands: Command[]; count: number }>(`/bots/${botId}/commands`),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="dbz-panel p-4">
        <div className="flex items-center gap-2 mb-2">
          <BotIcon className="h-5 w-5 text-dbz-orange" />
          <h2 className="text-lg font-saiyan text-dbz-orange uppercase">Bot Discord unifié</h2>
        </div>
        <p className="text-sm text-zinc-300">
          Le bot fonctionne avec un seul client Gateway Shenron qui rassemble les services,
          commandes et événements. Les anciens IDs de persona restent disponibles comme aliases pour
          les intégrations existantes.
        </p>
      </div>
      <BotSelector value={botId} onChange={setBotId} />

      <div className="grid gap-4 lg:grid-cols-4">
        <KPI title="État" icon={<Wifi className="h-4 w-4" />}>
          {info.data?.online ? (
            <>
              <span className="badge badge-success">en ligne</span>
              <p className="mt-2 text-xs text-zinc-400">
                Ping {info.data.wsPing} ms · uptime{" "}
                {info.data.uptime ? formatDuration(info.data.uptime) : "—"}
              </p>
            </>
          ) : (
            <>
              <span className="badge badge-error">hors ligne</span>
              <p className="mt-2 text-xs text-zinc-400">Login désactivé.</p>
            </>
          )}
        </KPI>
        <KPI title="Commandes" icon={<BotIcon className="h-4 w-4" />}>
          <p className="text-3xl font-bold text-brand-400">{cmds.data?.count ?? "—"}</p>
        </KPI>
        <KPI title="Serveurs" icon={<Globe className="h-4 w-4" />}>
          <p className="text-3xl font-bold text-brand-400">{info.data?.guilds.length ?? "—"}</p>
        </KPI>
        <KPI title="Total membres" icon={<Hash className="h-4 w-4" />}>
          <p className="text-3xl font-bold text-brand-400">
            {info.data?.guilds.reduce((s, g) => s + g.memberCount, 0) ?? "—"}
          </p>
        </KPI>
      </div>

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">Serveurs Discord</h2>
        {info.data?.guilds.length ? (
          <div className="space-y-2">
            {info.data.guilds.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
              >
                {g.iconUrl ? (
                  <img src={g.iconUrl} alt="" className="h-10 w-10 rounded-full" />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-zinc-800" />
                )}
                <div className="flex-1">
                  <p className="font-medium">{g.name}</p>
                  <p className="text-xs text-zinc-500">
                    {g.memberCount} membres · rejoint le {g.joinedAt?.slice(0, 10) ?? "—"}
                  </p>
                </div>
                <code className="text-xs text-zinc-500">{g.id}</code>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            {info.isLoading ? "Chargement…" : "Aucun serveur."}
          </p>
        )}
      </div>

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">Commandes slash ({cmds.data?.count ?? "—"})</h2>
        {cmds.data?.commands.length ? (
          <div className="space-y-2">
            {cmds.data.commands.map((c) => (
              <CommandRow key={c.name} cmd={c} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            {cmds.isLoading ? "Chargement…" : "Aucune commande slash registrée pour ce bot."}
          </p>
        )}
      </div>
    </div>
  );
}

function KPI({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="mb-2 flex items-center gap-2 text-zinc-400">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function CommandRow({ cmd }: { cmd: Command }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-zinc-900/50"
      >
        <ChevronDown
          className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <code className="font-mono text-sm font-semibold text-brand-400">/{cmd.name}</code>
            <span className="badge">{TYPE_LABELS[cmd.type] ?? `type:${cmd.type}`}</span>
            {cmd.nsfw && <span className="badge badge-warning">NSFW</span>}
            {cmd.options.length > 0 && (
              <span className="badge">
                {cmd.options.length} option{cmd.options.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">{cmd.description}</p>
        </div>
      </button>

      {open && cmd.options.length > 0 && (
        <div className="border-t border-zinc-800 p-3">
          <table className="w-full text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="px-2 py-1 text-left">Nom</th>
                <th className="px-2 py-1 text-left">Type</th>
                <th className="px-2 py-1 text-left">Obligatoire</th>
                <th className="px-2 py-1 text-left">Description</th>
                <th className="px-2 py-1 text-left">Choix</th>
              </tr>
            </thead>
            <tbody>
              {cmd.options.map((o) => (
                <tr key={o.name} className="border-t border-zinc-900">
                  <td className="px-2 py-1 font-mono">{o.name}</td>
                  <td className="px-2 py-1 text-zinc-400">{OPTION_TYPES[o.type] ?? o.type}</td>
                  <td className="px-2 py-1">{o.required ? "Oui" : "—"}</td>
                  <td className="px-2 py-1 text-zinc-400">{o.description}</td>
                  <td className="px-2 py-1 text-zinc-400">
                    {o.choices?.map((c) => c.name).join(", ") ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
