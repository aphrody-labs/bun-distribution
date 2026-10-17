// SPDX-License-Identifier: Apache-2.0
/**
 * Native systemd integration for Bun runtimes:
 * - Zero-dependency sd_notify and watchdog heartbeats via `bun:ffi` libc sockets.
 * - Standard syslog priority formatting for high-performance direct journald indexing.
 */
import { dlopen, FFIType, type Library } from "bun:ffi";

/** Standard syslog priority prefixes for stdout/stderr journald indexing. */
export const SyslogPriority = {
  EMERG: "<0>",
  ALERT: "<1>",
  CRIT: "<2>",
  ERR: "<3>",
  WARNING: "<4>",
  NOTICE: "<5>",
  INFO: "<6>",
  DEBUG: "<7>",
} as const;

export type SyslogLevel = keyof typeof SyslogPriority;

/** Format a message with a syslog priority prefix recognized by systemd journald. */
export function formatJournal(level: SyslogLevel, message: string): string {
  return `${SyslogPriority[level]}${message}`;
}

export const journal = {
  emerg: (msg: string) => console.error(formatJournal("EMERG", msg)),
  alert: (msg: string) => console.error(formatJournal("ALERT", msg)),
  crit: (msg: string) => console.error(formatJournal("CRIT", msg)),
  err: (msg: string) => console.error(formatJournal("ERR", msg)),
  warn: (msg: string) => console.warn(formatJournal("WARNING", msg)),
  notice: (msg: string) => console.log(formatJournal("NOTICE", msg)),
  info: (msg: string) => console.log(formatJournal("INFO", msg)),
  debug: (msg: string) => console.debug(formatJournal("DEBUG", msg)),
};

const libcSymbols = {
  socket: {
    args: [FFIType.i32, FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
  sendto: {
    args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i64,
  },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
} as const;

let libc: Library<typeof libcSymbols> | false | null = null;
function getLibc() {
  if (libc !== null) return libc;
  if (process.platform === "win32") {
    libc = false;
    return false;
  }
  try {
    const libPath = process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6";
    libc = dlopen(libPath, libcSymbols);
    return libc;
  } catch {
    libc = false;
    return false;
  }
}

/**
 * Send a notification string to systemd via `NOTIFY_SOCKET`.
 * Supports both filesystem paths and Linux abstract namespace sockets (leading `@`).
 *
 * @returns `true` if notification was transmitted, `false` if `NOTIFY_SOCKET` was unset or unavailable.
 */
export function sdNotify(state: string): boolean {
  const socketPath = process.env.NOTIFY_SOCKET;
  if (!socketPath) return false;

  const lib = getLibc();
  if (!lib) return false;

  const AF_UNIX = 1;
  const SOCK_DGRAM = 2;
  const fd = lib.symbols.socket(AF_UNIX, SOCK_DGRAM, 0);
  if (fd < 0) return false;

  try {
    const isAbstract = socketPath.startsWith("@");
    const rawPath = isAbstract ? `\0${socketPath.slice(1)}` : socketPath;
    const pathBuffer = Buffer.from(rawPath, "utf-8");

    // struct sockaddr_un:
    //   unsigned short sun_family (2 bytes)
    //   char sun_path[108]
    const sockaddr = Buffer.alloc(2 + 108);
    sockaddr.writeUInt16LE(AF_UNIX, 0);
    pathBuffer.copy(sockaddr, 2, 0, Math.min(pathBuffer.length, 108));

    const stateBuf = Buffer.from(state, "utf-8");
    const addrLen = isAbstract ? 2 + pathBuffer.length : 2 + pathBuffer.length + 1;

    const sent = lib.symbols.sendto(fd, stateBuf, BigInt(stateBuf.length), 0, sockaddr, addrLen);

    return Number(sent) >= 0;
  } finally {
    lib.symbols.close(fd);
  }
}

/** Notify service manager that startup is complete. */
export function notifyReady(): boolean {
  return sdNotify("READY=1");
}

/** Update the service's single-line status message. */
export function notifyStatus(status: string): boolean {
  return sdNotify(`STATUS=${status}`);
}

/** Notify service manager that service shutdown has initiated. */
export function notifyStopping(): boolean {
  return sdNotify("STOPPING=1");
}

/** Send keepalive heartbeat ping for services with `WatchdogSec=`. */
export function notifyWatchdog(): boolean {
  return sdNotify("WATCHDOG=1");
}

/** Read watchdog timeout in microseconds from `WATCHDOG_USEC`. */
export function getWatchdogUsec(): number | null {
  const raw = process.env.WATCHDOG_USEC;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Spawns an automatic periodic watchdog heartbeat timer.
 * Defaults to sending `WATCHDOG=1` at half the interval specified in `WATCHDOG_USEC`.
 *
 * @returns a controller with `.stop()` to cancel the heartbeat, or `null` if watchdog is not enabled.
 */
export function startWatchdogLoop(customIntervalMs?: number): { stop(): void } | null {
  let intervalMs: number | null = null;
  if (customIntervalMs !== undefined && customIntervalMs > 0) {
    intervalMs = customIntervalMs;
  } else {
    const usec = getWatchdogUsec();
    if (usec) {
      intervalMs = Math.max(100, Math.floor(usec / 2000));
    }
  }

  if (!intervalMs) return null;

  const timer = setInterval(() => {
    sdNotify("WATCHDOG=1");
  }, intervalMs);

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
