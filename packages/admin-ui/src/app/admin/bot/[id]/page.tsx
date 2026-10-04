import { botAdmin } from "@/lib/bot-admin";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Cmd = {
  name: string;
  description: string;
  type: number;
  options?: unknown[];
};

export default async function BotDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [bot, cmds] = await Promise.all([
    botAdmin.bot(id).catch(() => null),
    botAdmin.commands(id).catch(() => ({ commands: [] })),
  ]);

  if (!bot) {
    return (
      <div className="w-full max-w-4xl mx-auto">
        <Link
          href="/admin/dashboard"
          className="font-saiyan text-dbz-blue-light hover:text-dbz-orange uppercase"
        >
          ← DASHBOARD
        </Link>
        <div className="dbz-panel p-8 text-center mt-8">
          <p className="text-2xl font-saiyan text-red-500 uppercase">Bot introuvable: {id}</p>
        </div>
      </div>
    );
  }

  const commands = cmds.commands as Cmd[];

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      <Link
        href="/admin/dashboard"
        className="font-saiyan text-dbz-blue-light hover:text-dbz-orange uppercase"
      >
        ← DASHBOARD
      </Link>

      <div className="dbz-panel p-6 flex items-center gap-4">
        <img src={bot.avatar} alt={bot.name} className="w-16 h-16 border-2 border-dbz-border" />
        <div className="flex-1">
          <h1 className="text-4xl font-saiyan text-dbz-orange">{bot.name}</h1>
          <p className="text-xs text-gray-500 font-mono">{bot.username}</p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-saiyan ${bot.online ? "text-green-500" : "text-red-500"}`}>
            {bot.online ? "ONLINE" : "OFFLINE"}
          </div>
          <div className="text-xs text-dbz-blue-light uppercase">
            {bot.wsPing}ms · {bot.guildCount} guild
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-saiyan text-dbz-yellow uppercase mb-3">
          Slash commands ({commands.length})
        </h2>
        <div className="dbz-panel overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead className="bg-dbz-border/50 border-b-2 border-dbz-border">
              <tr>
                <th className="p-3 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                  Nom
                </th>
                <th className="p-3 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                  Description
                </th>
                <th className="p-3 text-right text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                  Opts
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dbz-border">
              {commands.map((c) => (
                <tr key={c.name} className="hover:bg-dbz-blue-light/10">
                  <td className="p-3 font-mono text-dbz-orange">/{c.name}</td>
                  <td className="p-3 text-sm text-gray-300">{c.description}</td>
                  <td className="p-3 text-right text-xs text-dbz-blue-light">
                    {c.options?.length ?? 0}
                  </td>
                </tr>
              ))}
              {commands.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-gray-500 font-saiyan uppercase">
                    Aucune commande
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
