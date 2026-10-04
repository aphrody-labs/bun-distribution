import { AdminHeader } from "../db-universe/_Header";
import { TranscriptionsDashboard } from "@aphrody/admin-ui/components/admin/TranscriptionsDashboard";
import { getTranscriptionsOverview } from "@/lib/transcriptions-admin";

export const dynamic = "force-dynamic";

export default async function TranscriptionsPage() {
  const initialData = await getTranscriptionsOverview();

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <AdminHeader
        title="Transcriptions & Arbitrage"
        subtitle="Supervision du corpus manga et databooks · Arbitrage des défauts OCR et relecture multi-agents"
      />
      <TranscriptionsDashboard initialData={initialData} />
    </div>
  );
}
