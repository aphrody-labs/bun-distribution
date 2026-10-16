import { Circle, Lightning } from "@phosphor-icons/react";
import { clsx } from "clsx";
import type { SyncPeerActivity, SyncState } from "../types";
import { timeAgo } from "../utils";

interface PeerListProps {
  peers: SyncPeerActivity[];
  currentState: SyncState;
}

export function PeerList({ peers }: PeerListProps) {
  if (peers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <Circle className="size-8 text-outline mb-2" weight="duotone" />
        <p className="text-body-medium text-on-surface-variant text-center">
          No paired devices
        </p>
        <p className="text-body-small text-outline text-center mt-1">
          Pair a device to start syncing
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {peers.map((peer) => (
        <PeerCard key={peer.deviceId} peer={peer} />
      ))}
    </div>
  );
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function PeerCard({ peer }: { peer: SyncPeerActivity }) {
  return (
    <div className="bg-surface-container rounded-small p-3 border border-outline-variant">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={clsx(
              "size-2 rounded-full",
              peer.isOnline ? "bg-success" : "bg-outline",
            )}
          />
          <span className="text-label-large font-medium text-on-surface">
            {peer.deviceName}
          </span>
        </div>

        {peer.watermarkLagMs && peer.watermarkLagMs > 60000 && (
          <Lightning className="size-4 text-warning" weight="fill" />
        )}
        <span>
          {peer.isOnline ? "Online" : `Last seen ${timeAgo(peer.lastSeen)}`}
        </span>
      </div>

      <div className="flex items-center gap-2 mt-2 text-body-small text-outline">
        <div className="flex gap-2 flex-row">
          <span>{formatBytes(peer.bytesReceived)}</span>
          <span className="text-[10px]">received</span>
        </div>
        <div className="flex gap-2 flex-row">
          <span>{peer.entriesReceived.toLocaleString()}</span>
          <span className="text-[10px]">changes</span>
        </div>
      </div>
    </div>
  );
}
