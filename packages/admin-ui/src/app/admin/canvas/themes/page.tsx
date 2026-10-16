import { botAdmin } from "@/lib/bot-admin";
import { ThemeCreateForm, ThemeRowActions } from "./ThemeForms";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CanvasThemesPage() {
  const data = await botAdmin.canvas.themes().catch(() => ({ rows: [] }));

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <header>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-4xl font-saiyan text-dbz-orange mb-2">THÈMES DE CARTE</h1>
            <p className="text-sm text-white/60 mb-1">
              Gérez les thèmes visuels des cartes de profil des membres.
            </p>
            <p className="text-xs text-white/50 uppercase tracking-widest">
              {data.rows.length} thème{data.rows.length !== 1 ? "s" : ""} en base · rechargé par le
              bot dans les 60 secondes
            </p>
          </div>
          <Link href="/admin/canvas" className="dbz-button-ghost !text-xs">
            Voir les aperçus
          </Link>
        </div>
      </header>

      <div className="dbz-panel p-4 border-l-4 border-dbz-blue-light/50">
        <p className="text-xs text-white/50">
          <strong className="text-white/70">Comment ça marche ?</strong> Chaque thème définit les
          couleurs du fond, de l&apos;accent et de l&apos;aura de la carte de profil. Un membre peut
          équiper un thème via la boutique du bot (<code>/boutique</code>). Le thème
          &laquo;&nbsp;default&nbsp;&raquo; ne peut pas être supprimé.
        </p>
      </div>

      <ThemeCreateForm />

      {data.rows.length === 0 ? (
        <div className="dbz-panel p-8 text-center">
          <p className="font-saiyan text-dbz-yellow text-xl mb-2">AUCUN THÈME</p>
          <p className="text-sm text-white/50">
            Aucun thème en base — les cartes utilisent les thèmes intégrés par défaut du bot.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.rows.map((t) => (
            <div key={t.id} className="dbz-panel overflow-hidden">
              {/* Aperçu du dégradé */}
              <div
                className="h-32 relative"
                style={{
                  background: `linear-gradient(135deg, ${t.bgGrad1}, ${t.bgGrad2}, ${t.bgGrad3})`,
                }}
              >
                <div className="absolute inset-x-0 bottom-0 p-3 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent">
                  <div>
                    <div
                      className="font-saiyan text-lg leading-none"
                      style={{ color: t.accent, textShadow: t.textShadow }}
                    >
                      {t.name}
                    </div>
                    <code className="text-[10px] text-white/50 font-mono">{t.id}</code>
                  </div>
                  <div className="flex gap-1" title="Couleurs accent et aura">
                    <div
                      className="w-4 h-4 rounded-full border border-white/30"
                      style={{ background: t.accent }}
                      title={`Couleur accent : ${t.accent}`}
                    />
                    <div
                      className="w-4 h-4 rounded-full border border-white/30"
                      style={{ background: t.aura }}
                      title={`Couleur aura : ${t.aura}`}
                    />
                  </div>
                </div>
              </div>
              {/* Infos et actions */}
              <div className="p-3 space-y-2">
                {t.bgFile && (
                  <p className="text-[10px] text-white/50 font-mono truncate" title={t.bgFile}>
                    Image de fond : {t.bgFile}
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] uppercase tracking-widest font-bold ${t.enabled ? "text-green-400" : "text-white/20"}`}
                  >
                    {t.enabled ? "Actif" : "Désactivé"}
                  </span>
                  <ThemeRowActions theme={t} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
