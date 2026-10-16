"use client";

import { Button } from "@rosegriffon/ui";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { syncGoogleEvents } from "@/app/admin/events/actions";

export function SyncEventsButton() {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await syncGoogleEvents();
      if (result.success) {
        toast.success(`Synchronisation réussie : ${result.imported} importés, ${result.skipped} ignorés.`);
      } else {
        toast.error("Erreur lors de la synchronisation.");
      }
    } catch (error) {
      console.error(error);
      toast.error("Une erreur est survenue lors de la synchronisation.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Button variant="outline" onClick={handleSync} disabled={isSyncing} className="gap-2">
      <RefreshCw className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
      {isSyncing ? "Sync..." : "Sync Google"}
    </Button>
  );
}
