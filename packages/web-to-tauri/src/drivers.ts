// SPDX-License-Identifier: Apache-2.0
/**
 * Capture side of the parity check: one driver per way of reaching a page. The reference side is
 * a CDP endpoint (the `aphrody-web` engine or any Chromium); the wrapped side is the Tauri debug
 * bridge (wry) or the CDP port of a CEF app. Both run `PARITY_SNAPSHOT_BODY` so the snapshots are
 * comparable.
 */
import { BrowserPage } from "@aphrody/bun-web/cdp";
import { TauriBridge } from "@aphrody/bun-web/tauri";
import {
  buildReport,
  compareSnapshots,
  PARITY_SNAPSHOT_BODY,
  verifyPolicy,
  type CompareOptions,
  type PageSnapshot,
  type ParityReport,
  type PathReport,
} from "./parity.ts";
import type { ConversionPlan } from "./types.ts";

export interface SnapshotDriver {
  label: string;
  capture(url: string): Promise<PageSnapshot>;
  close(): Promise<void>;
}

/** Evaluates in a CDP page (`Runtime.evaluate` takes an expression, not a function body). */
export async function cdpDriver(
  endpoint?: string,
  label = "cdp",
): Promise<SnapshotDriver> {
  const page = await BrowserPage.connect(endpoint);
  return {
    label,
    async capture(url) {
      await page.goto(url, "networkidle");
      return page.evaluate<PageSnapshot>(`(() => {${PARITY_SNAPSHOT_BODY}})()`);
    },
    async close() {
      page.close();
    },
  };
}

/** Evaluates in the first window of a running debug-enabled wry app. */
export async function bridgeDriver(
  exe?: string,
  label = "tauri-bridge",
): Promise<SnapshotDriver> {
  const { bridge } = await TauriBridge.connectToRunning(exe);
  return {
    label,
    async capture(url) {
      await bridge.evaluate(
        `window.location.assign(${JSON.stringify(url)}); return true;`,
      );
      const deadline = Date.now() + 30_000;
      for (;;) {
        await Bun.sleep(300);
        // The page is unloading right after `assign`; a failing evaluate means "not ready yet".
        const state = await bridge
          .evaluate<string>(`return document.readyState + "|" + location.href;`)
          .catch(() => "");
        if (
          state.startsWith("complete|") &&
          new URL(state.slice(9)).pathname === new URL(url).pathname
        )
          break;
        if (Date.now() > deadline)
          throw new Error(`the app did not finish loading ${url} within 30 s`);
      }
      // Late requests (fetch after load) settle before the snapshot reads the resource timeline.
      await Bun.sleep(1500);
      return bridge.evaluate<PageSnapshot>(PARITY_SNAPSHOT_BODY);
    },
    async close() {
      bridge.close();
    },
  };
}

export interface RunParityOptions {
  reference: SnapshotDriver | null;
  wrapped: SnapshotDriver | null;
  /** Origin the original is served from. Defaults to the origin of the probed URL. */
  referenceBase?: string;
  /** Origin the app is serving from: the same as the original in remote mode, loopback otherwise. */
  wrappedBase?: string;
  compare?: CompareOptions;
}

/** Captures every parity path on both sides and builds the report. A missing driver is reported, never passed. */
export async function runParity(
  plan: ConversionPlan,
  options: RunParityOptions,
): Promise<ParityReport> {
  const skipped: string[] = [];
  const policy = verifyPolicy(plan);
  const paths: PathReport[] = [];
  if (!options.reference)
    skipped.push("reference capture: no CDP endpoint for the original");
  if (!options.wrapped)
    skipped.push(
      "wrapped capture: no running app (debug bridge or CEF CDP port)",
    );
  const referenceBase =
    options.referenceBase ??
    (plan.probe.kind === "site"
      ? new URL(plan.probe.finalUrl).origin
      : undefined);
  const wrappedBase = options.wrappedBase ?? referenceBase;
  if (!referenceBase || !wrappedBase)
    skipped.push("a directory plan needs --reference-base and --app-base");
  for (const path of plan.parityPaths) {
    if (
      !options.reference ||
      !options.wrapped ||
      !referenceBase ||
      !wrappedBase
    ) {
      paths.push({
        path,
        status: "skipped",
        textSimilarity: null,
        findings: [],
      });
      continue;
    }
    try {
      const reference = await options.reference.capture(
        new URL(path, referenceBase).href,
      );
      const wrapped = await options.wrapped.capture(
        new URL(path, wrappedBase).href,
      );
      const originMap =
        referenceBase === wrappedBase
          ? {}
          : { [new URL(wrappedBase).origin]: new URL(referenceBase).origin };
      paths.push(
        compareSnapshots(path, reference, wrapped, {
          originMap,
          ...options.compare,
        }),
      );
    } catch (error) {
      paths.push({
        path,
        status: "fail",
        textSimilarity: null,
        findings: [
          {
            severity: "regression",
            check: "capture",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  }
  return buildReport(paths, policy, skipped);
}
