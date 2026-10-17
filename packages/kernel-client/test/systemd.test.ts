// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import {
  formatJournal,
  getWatchdogUsec,
  notifyReady,
  notifyStatus,
  notifyStopping,
  notifyWatchdog,
  sdNotify,
  startWatchdogLoop,
  SyslogPriority,
} from "../src/systemd.ts";

test("journal formatting uses standard syslog prefixes", () => {
  expect(formatJournal("INFO", "service booted")).toBe("<6>service booted");
  expect(formatJournal("ERR", "database connection failed")).toBe("<3>database connection failed");
  expect(formatJournal("WARNING", "rate limit approaching")).toBe("<4>rate limit approaching");
  expect(SyslogPriority.EMERG).toBe("<0>");
  expect(SyslogPriority.DEBUG).toBe("<7>");
});

test("sdNotify returns false when NOTIFY_SOCKET is not set", () => {
  const prev = process.env.NOTIFY_SOCKET;
  try {
    delete process.env.NOTIFY_SOCKET;
    expect(sdNotify("READY=1")).toBe(false);
    expect(notifyReady()).toBe(false);
    expect(notifyStatus("running")).toBe(false);
    expect(notifyStopping()).toBe(false);
    expect(notifyWatchdog()).toBe(false);
  } finally {
    if (prev !== undefined) process.env.NOTIFY_SOCKET = prev;
  }
});

test("watchdog interval calculation parses WATCHDOG_USEC correctly", () => {
  const prev = process.env.WATCHDOG_USEC;
  try {
    process.env.WATCHDOG_USEC = "20000000"; // 20s
    expect(getWatchdogUsec()).toBe(20000000);

    const loop = startWatchdogLoop();
    expect(loop).not.toBeNull();
    loop?.stop();

    delete process.env.WATCHDOG_USEC;
    expect(getWatchdogUsec()).toBeNull();
    expect(startWatchdogLoop()).toBeNull();
  } finally {
    if (prev !== undefined) process.env.WATCHDOG_USEC = prev;
    else delete process.env.WATCHDOG_USEC;
  }
});
