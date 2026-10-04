import Link from "next/link";
import { notFound } from "next/navigation";
import { Crayon, FlecheGauche, LienExterne } from "@/components/icones";
import { AdminHeader } from "../../db-universe/_Header";
import {
  TranscriptionRelecteur,
  type PlancheRelecture,
} from "@aphrody/admin-ui/components/admin/TranscriptionRelecteur";
import { getDatabook } from "@/lib/databooks";
import { parseDatabookId } from "@/lib/databooks-rules";

/**
 * Écran de relecture d'un ouvrage transcrit.
 *
 * Les planches sont passées en entier au composant client plutôt que chargées
 * une par une : le plus gros ouvrage fait 362 planches pour ~325 Ko de texte,
 * soit un aller-retour unique contre 362 requêtes pendant une relecture — et la
 * navigation entre planches reste instantanée, ce qui est tout l'intérêt.
 */
export const dynamic = "force-dynamic";

type Filtre = "toutes" | "a-transcrire" | "transcrites" | "suspectes";

const FILTRES = new Set<Filtre>(["toutes", "a-transcrire", "transcrites", "suspectes"]);

export default async function RelecturePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filtre?: string; planche?: string }>;
}) {
  const id = parseDatabookId((await params).id);
  if (id === null) notFound();

  const fiche = await getDatabook(id);
  if (!fiche) notFound();

  const { filtre, planche } = await searchParams;
  const filtreInitial = FILTRES.has(filtre as Filtre) ? (filtre as Filtre) : "toutes";
  const nPlanche = Number(planche);

  const planches: PlancheRelecture[] = fiche.pages.map((p) => ({
    numero: p.number,
    image: p.image,
    texte: p.text ?? "",
    verifiee: p.verifiee === true,
  }));
  const transcrites = planches.filter((p) => p.texte.trim().length > 0).length;

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <AdminHeader
        title={fiche.title}
        subtitle={
          planches.length > 0
            ? `${transcrites}/${planches.length} planches transcrites · ${Math.round((transcrites / planches.length) * 100)} %`
            : "Aucune planche"
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/databooks" className="btn btn-ghost h-9 px-3 text-xs">
              <FlecheGauche className="h-3.5 w-3.5" />
              Suivi
            </Link>
            <Link
              href={`/admin/wiki/studio/db_databooks/${fiche.id}`}
              className="btn btn-ghost h-9 px-3 text-xs"
              title="Métadonnées, couverture, description, gestion des slots"
            >
              <Crayon className="h-3.5 w-3.5" />
              Studio
            </Link>
            <a
              href={`/wiki/databooks/${fiche.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost h-9 px-3 text-xs"
            >
              <LienExterne className="h-3.5 w-3.5" />
              Public
            </a>
          </div>
        }
      />

      {planches.length === 0 ? (
        <div className="dbz-panel p-12 text-center">
          <p className="mb-1 font-saiyan text-xl uppercase text-white/50">Aucune planche</p>
          <p className="text-sm text-white/50">
            Les slots de pages se créent dans le{" "}
            <Link
              href={`/admin/wiki/studio/db_databooks/${fiche.id}`}
              className="text-dbz-orange hover:underline"
            >
              studio
            </Link>
            , avec les scans.
          </p>
        </div>
      ) : (
        <TranscriptionRelecteur
          databookId={fiche.id}
          titre={fiche.title}
          planchesInitiales={planches}
          filtreInitial={filtreInitial}
          plancheInitiale={Number.isSafeInteger(nPlanche) && nPlanche > 0 ? nPlanche : undefined}
        />
      )}
    </div>
  );
}
