import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Copy } from "@phosphor-icons/react";
import { useDaemonStatus } from "../../hooks/useDaemonStatus";
import { usePlatform } from "../../contexts/PlatformContext";
import { Icon, Button } from "@aphrody/m3-primitives";
import folderIcon from "@aphrody/assets/icons/FolderNoSpace.png";

function CLICommand({ command, description }: { command: string; description: string }) {
  const copyToClipboard = () => {
    navigator.clipboard.writeText(command);
  };

  return (
    <div className="group relative rounded-small px-3 py-2">
      <code className="text-body-small text-primary">{command}</code>
      <p className="mt-1 text-body-small text-on-surface-variant">{description}</p>
      <button
        onClick={copyToClipboard}
        className="absolute right-2 top-2 rounded-extra-small p-1 opacity-0 transition-opacity hover:bg-on-surface/8 group-hover:opacity-100"
        title="Copy to clipboard"
      >
        <Copy className="size-3 text-on-surface-variant" weight="bold" />
      </button>
    </div>
  );
}

export function DaemonDisconnectedOverlay({
  forceShow = false,
  daemonStatus,
}: {
  forceShow?: boolean;
  daemonStatus: ReturnType<typeof useDaemonStatus>;
}) {
  const { isConnected, isChecking, isInstalled, startDaemon, installAndStartDaemon } = daemonStatus;
  const [installAsService, setInstallAsService] = useState(isInstalled);
  const [prevIsInstalled, setPrevIsInstalled] = useState(isInstalled);
  const platform = usePlatform();

  // Update checkbox when installation state changes (état dérivé calculé au rendu, sans effet).
  if (isInstalled !== prevIsInstalled) {
    setPrevIsInstalled(isInstalled);
    setInstallAsService(isInstalled);
  }

  useEffect(() => {
    console.log("[DaemonDisconnectedOverlay] isInstalled changed to:", isInstalled);
  }, [isInstalled]);

  // Log checkbox state changes
  useEffect(() => {
    console.log("[DaemonDisconnectedOverlay] installAsService checkbox state:", installAsService);
  }, [installAsService]);

  const shouldShow = forceShow || !isConnected;

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-lg bg-black/50"
        >
          <div className="fixed right-4 top-4 flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 text-label-medium font-medium">
              <div
                className={`size-2 rounded-full ${
                  isChecking ? "bg-warning" : isConnected ? "bg-success" : "bg-error"
                } animate-pulse`}
              />
              <span className="text-on-surface-variant">
                {isChecking ? "Starting..." : isConnected ? "Connected" : "Disconnected"}
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 text-label-medium font-medium">
              <div className={`size-2 rounded-full ${isInstalled ? "bg-primary" : "bg-outline"}`} />
              <span className="text-on-surface-variant">
                {isInstalled ? "Persistent" : "Temporary"}
              </span>
            </div>
          </div>

          <div className="flex max-w-4xl gap-8 rounded-small border border-outline-variant p-8 shadow-md3-5">
            <div className="flex flex-1 flex-col items-center justify-center gap-6 px-12">
              <img
                src={folderIcon}
                alt="Spacedrive folder icon"
                className="size-32 select-none"
                draggable={false}
              />

              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-headline-small font-bold text-on-surface">
                  Daemon disconnected
                </h1>
                <p className="max-w-xs text-body-medium leading-relaxed text-on-surface-variant">
                  The Spacedrive daemon is required for the app to function. It runs in the
                  background, managing your libraries, indexing files, and syncing data across
                  devices.
                </p>
              </div>

              <div className="flex flex-col items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-body-medium text-on-surface">
                  <input
                    type="checkbox"
                    checked={installAsService}
                    onChange={async (e) => {
                      const shouldInstall = e.target.checked;
                      setInstallAsService(shouldInstall);

                      if (shouldInstall) {
                        const success = await installAndStartDaemon();
                        if (!success) {
                          setInstallAsService(false);
                        }
                      } else {
                        try {
                          await platform.uninstallDaemonService?.();
                        } catch (error) {
                          console.error("Failed to uninstall daemon service:", error);
                          setInstallAsService(true);
                        }
                      }
                    }}
                    className="size-4 cursor-pointer rounded-extra-small border-outline-variant bg-surface accent-primary"
                  />
                  <span>Install as persistent service</span>
                </label>

                <div className="flex items-center gap-2">
                  <Button aria-label="Help" title="Help" variant="gray">
                    <Icon name="help" size={18} />
                  </Button>
                  <Button onClick={startDaemon} disabled={isChecking} variant="accent">
                    {isChecking ? "Starting daemon..." : "Restart Daemon"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex w-80 flex-col gap-3 rounded-small border border-outline-variant p-4">
              <span className="text-label-medium font-medium text-on-surface-variant">
                CLI commands
              </span>

              <div className="space-y-2">
                <CLICommand command="sd start" description="Start the daemon in background mode" />
                <CLICommand
                  command="sd start --foreground"
                  description="Start the daemon in foreground mode (see logs)"
                />
                <CLICommand command="sd stop" description="Stop the daemon gracefully" />
                <CLICommand command="sd restart" description="Restart the daemon" />
                <CLICommand
                  command="sd daemon install"
                  description="Install daemon to start automatically on login (macOS/Linux)"
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
