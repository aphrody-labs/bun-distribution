import Link from "next/link";
import { AdminHeader } from "../db-universe/_Header";
import { DatabooksCatalogManager } from "@aphrody/admin-ui/components/admin/DatabooksCatalogManager";
import { progressionTranscription } from "@/lib/databooks-transcription";
import { getCampagneStats } from "@/lib/databooks-campagne";
import { ScanText, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DatabooksAdminPage() {
  const [progression, campagne] = await Promise.all([
    progressionTranscription(),
    getCampagneStats(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <AdminHeader
        title="Databooks &amp; Traductions"
        subtitle="Catalogue des 451 ouvrages officiels · Pilotage des campagnes de traduction FR et suivi de la qualité OCR"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/transcriptions"
              className="btn btn-ghost h-9 px-3 text-xs flex items-center gap-1.5"
            >
              <ScanText className="h-3.5 w-3.5" />
              Transcriptions &amp; Arbitrage
            </Link>
            <a
              href="/wiki/databooks"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost h-9 px-3 text-xs flex items-center gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Catalogue Public
            </a>
          </div>
        }
      />

      <DatabooksCatalogManager initialFiches={progression.fiches} initialCampagne={campagne} />
    </div>
  );
}
