import Link from "next/link";
import { FlecheGauche, Historique } from "@/components/icones";
import { WikiHistory } from "@aphrody/admin-ui/components/admin/WikiHistory";

export const dynamic = "force-dynamic";

export const metadata = { title: "Historique du wiki" };

export default function WikiHistoryPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/wiki" className="btn btn-ghost">
          <FlecheGauche className="h-4 w-4" />
          <span className="sr-only">Retour au wiki</span>
        </Link>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 font-saiyan text-3xl uppercase text-dbz-orange">
            <Historique className="h-6 w-6" />
            Historique des révisions
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Toutes les modifications du wiki éditorial — création, édition,
            suppression, visibilité — avec leur auteur et un retour arrière en
            un clic.
          </p>
        </div>
      </div>
      <WikiHistory />
    </div>
  );
}
