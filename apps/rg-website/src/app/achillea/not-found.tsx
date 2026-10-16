import Link from "next/link";
import { Button } from "@rosegriffon/ui";
import { FileQuestion, ArrowLeft } from "lucide-react";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";

export const metadata = metadonneesAchillea({
  titre: "Page introuvable",
  description: "La ressource Achilléa demandée n'existe pas ou a été déplacée.",
  chemin: null,
  indexable: false,
});

export default function AchilleaNotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="size-16 rounded-full bg-muted text-muted-foreground flex items-center justify-center mx-auto">
          <FileQuestion className="size-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Page Introuvable</h1>
          <p className="text-sm text-muted-foreground">
            La page que vous cherchez n&apos;existe pas, a été déplacée ou son URL est incorrecte.
          </p>
        </div>

        <div className="pt-2">
          <Link href="/achillea">
            <Button variant="outline" className="gap-2">
              <ArrowLeft className="size-4" />
              Retour à l&apos;accueil Achilléa
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
