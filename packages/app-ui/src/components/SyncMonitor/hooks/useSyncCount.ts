import { useState } from "react";
import { useLibraryQuery } from "../../../contexts/SpacedriveContext";

export function useSyncCount() {
  const [onlinePeerCount, setOnlinePeerCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const { data } = useLibraryQuery({
    type: "sync.activity",
    input: {},
  });

  // Derive the counts from each new query result during render (same values as the former effect).
  const [seenData, setSeenData] = useState<typeof data>(undefined);
  if (data !== seenData) {
    setSeenData(data);
    if (data) {
      const onlineCount = data.peers.filter((p) => p.isOnline).length;
      setOnlinePeerCount(onlineCount);

      const state = data.currentState;
      const syncing =
        (typeof state === "object" &&
          ("Backfilling" in state || "CatchingUp" in state)) ||
        false;
      setIsSyncing(syncing);
    }
  }

  return { onlinePeerCount, isSyncing };
}
