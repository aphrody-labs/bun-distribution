import { ArrowsClockwise, CircleNotch, ArrowsOut, FunnelSimple } from "@phosphor-icons/react";
import { Popover, usePopover, CircleButton } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { PeerList } from "./components/PeerList";
import { ActivityFeed } from "./components/ActivityFeed";
import { useSyncCount } from "./hooks/useSyncCount";
import { useSyncMonitor } from "./hooks/useSyncMonitor";

interface SyncMonitorPopoverProps {
  className?: string;
}

const getStateColor = (state: string) => {
  switch (state) {
    case "Ready":
      return "bg-success";
    case "Backfilling":
      return "bg-warning";
    case "CatchingUp":
      return "bg-primary";
    case "Uninitialized":
      return "bg-outline";
    case "Paused":
      return "bg-on-surface-variant";
    default:
      return "bg-outline";
  }
};

export function SyncMonitorPopover({ className }: SyncMonitorPopoverProps) {
  const navigate = useNavigate();
  const popover = usePopover();
  const [showActivityFeed, setShowActivityFeed] = useState(false);
  const [prevOpen, setPrevOpen] = useState(popover.open);

  const { onlinePeerCount, isSyncing } = useSyncCount();

  // Réinitialise le fil d'activité à l'ouverture du popover (état dérivé calculé au rendu).
  if (popover.open !== prevOpen) {
    setPrevOpen(popover.open);
    if (popover.open) setShowActivityFeed(false);
  }

  return (
    <Popover.Root open={popover.open} onOpenChange={popover.setOpen}>
      <Popover.Trigger asChild>
        <button
          className={clsx(
            "w-full relative flex items-center gap-2 rounded-small px-2 py-1.5 text-label-large font-medium",
            "text-sidebar-inkDull cursor-default",
            className,
          )}
        >
          <div className="size-4">
            {isSyncing ? (
              <CircleNotch className="animate-spin" weight="bold" size={16} />
            ) : (
              <ArrowsClockwise weight="bold" size={16} />
            )}
          </div>
          <span>Sync</span>
          {onlinePeerCount > 0 && (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-primary rounded-full">
              {onlinePeerCount}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        className="w-[380px] max-h-[520px] z-50 !p-0 !bg-surface !rounded-medium"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
          <h3 className="text-label-large font-semibold text-on-surface">Sync monitor</h3>

          <div className="flex items-center gap-2">
            {onlinePeerCount > 0 && (
              <span className="text-body-small text-on-surface-variant">
                {onlinePeerCount} {onlinePeerCount === 1 ? "peer" : "peers"} online
              </span>
            )}

            <CircleButton icon={ArrowsOut} onClick={() => navigate("/sync")} title="Open full sync monitor" />

            <CircleButton
              icon={FunnelSimple}
              active={showActivityFeed}
              onClick={() => setShowActivityFeed(!showActivityFeed)}
              title={showActivityFeed ? "Show peers" : "Show activity feed"}
            />
          </div>
        </div>

        {popover.open && <SyncMonitorContent showActivityFeed={showActivityFeed} />}
      </Popover.Content>
    </Popover.Root>
  );
}

function SyncMonitorContent({ showActivityFeed }: { showActivityFeed: boolean }) {
  const sync = useSyncMonitor();

  return (
    <>
      <div className="px-4 py-2 border-b border-outline-variant bg-surface-container/50">
        <div className="flex items-center gap-2">
          <div className={`size-2 rounded-full ${getStateColor(sync.currentState)}`} />
          <span className="text-label-medium font-medium text-on-surface-variant">{sync.currentState}</span>
        </div>
      </div>
      <motion.div
        className="overflow-y-auto no-scrollbar"
        initial={false}
        animate={{
          height: showActivityFeed
            ? Math.min(sync.recentActivity.length * 40 + 16, 400)
            : Math.min(sync.peers.length * 80 + 16, 400),
        }}
        transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
      >
        {showActivityFeed ? (
          <ActivityFeed activities={sync.recentActivity} />
        ) : (
          <PeerList peers={sync.peers} currentState={sync.currentState} />
        )}
      </motion.div>
    </>
  );
}
