// SPDX-License-Identifier: Apache-2.0
import type { Client } from "discordx";

export interface CleanupStep {
  name: string;
  action: () => Promise<unknown> | unknown;
}

export interface GracefulShutdownConfig {
  client?: Client | (() => Promise<unknown> | unknown);
  steps?: CleanupStep[];
  timeoutMs?: number;
  exitProcess?: boolean;
  logger?: {
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
  };
}

/**
 * Registers standardized SIGTERM and SIGINT signal handlers for clean process termination.
 *
 * Ensures that timers, background loops, Discord Gateway connections, and database pools
 * are shut down in predictable order within a safety deadline, preventing ghost "Online"
 * bot presences or dangling TCP connections.
 */
export function registerGracefulShutdown(config: GracefulShutdownConfig): () => void {
  const logger = config.logger ?? console;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const exitProcess = config.exitProcess ?? true;

  let shuttingDown = false;

  async function handleSignal(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info?.(
      `[discord-kit] Received ${signal} — initiating graceful shutdown (deadline: ${timeoutMs}ms)`,
    );

    const hardStop = setTimeout(() => {
      logger.error?.("[discord-kit] Graceful shutdown deadline exceeded — forcing exit");
      if (exitProcess) process.exit(1);
    }, timeoutMs);
    hardStop.unref?.();

    let failed = false;

    // 1. Run custom cleanup steps in order (e.g. cron timers, web server, worker drain)
    if (config.steps) {
      for (const step of config.steps) {
        try {
          logger.info?.(`[discord-kit] Shutdown step: stopping ${step.name}...`);
          // oxlint-disable-next-line no-await-in-loop -- arrêt ordonné : chaque étape de nettoyage doit se terminer avant la suivante
          await step.action();
        } catch (err) {
          failed = true;
          logger.error?.(
            `[discord-kit] Shutdown step failed for ${step.name}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }

    // 2. Destroy Discord Gateway connection
    if (config.client) {
      try {
        logger.info?.("[discord-kit] Disconnecting Discord Gateway client...");
        if (typeof config.client === "function") {
          await config.client();
        } else {
          await config.client.destroy();
        }
      } catch (err) {
        failed = true;
        logger.error?.(
          "[discord-kit] Failed to disconnect Discord client cleanly:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    clearTimeout(hardStop);
    logger.info?.("[discord-kit] Graceful shutdown finished");

    if (exitProcess) {
      process.exit(failed ? 1 : 0);
    }
  }

  const onSigTerm = () => void handleSignal("SIGTERM");
  const onSigInt = () => void handleSignal("SIGINT");

  process.on("SIGTERM", onSigTerm);
  process.on("SIGINT", onSigInt);

  return () => {
    process.off("SIGTERM", onSigTerm);
    process.off("SIGINT", onSigInt);
  };
}
