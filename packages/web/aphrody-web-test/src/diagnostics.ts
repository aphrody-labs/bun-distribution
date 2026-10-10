// SPDX-License-Identifier: Apache-2.0

import { ObscuraPage } from "./cdp.ts";

export interface DiagnosticsOptions {
  waitUntil?: "load" | "domcontentloaded" | "commit" | "networkidle";
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
  ignore?: RegExp[];
}

export type PageDiagnostics =
  | { available: false; reason: string }
  | {
      available: true;
      status: number;
      finalUrl: string;
      jsErrors: string[];
      consoleErrors: string[];
      ignored: string[];
      networkRequests: number;
    };

/** Collect browser diagnostics through the shared Obscura CDP server. */
export async function collectPageDiagnostics(
  url: string,
  opts: DiagnosticsOptions = {},
): Promise<PageDiagnostics> {
  let page: ObscuraPage;
  try {
    page = await ObscuraPage.connect();
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const jsErrors: string[] = [];
  const consoleErrors: string[] = [];
  let networkRequests = 0;
  page.page.on("pageerror", (error) => jsErrors.push(error.message));
  page.page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const countRequest = () => networkRequests++;
  page.page.view.addEventListener("Network.requestWillBeSent", countRequest);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (opts.extraHeaders)
      await page._send("Network.setExtraHTTPHeaders", { headers: opts.extraHeaders });
    const response = await Promise.race([
      page.goto(url, opts.waitUntil ?? "load"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Page diagnostics timed out")),
          opts.timeoutMs ?? 45_000,
        );
      }),
    ]);
    const ignored: string[] = [];
    const keep = (messages: string[]) =>
      messages.filter((message) => {
        if ((opts.ignore ?? []).some((pattern) => pattern.test(message))) {
          ignored.push(message);
          return false;
        }
        return true;
      });
    return {
      available: true,
      status: response.status,
      finalUrl: page.url(),
      jsErrors: keep(jsErrors),
      consoleErrors: keep(consoleErrors),
      ignored,
      networkRequests,
    };
  } finally {
    if (timer) clearTimeout(timer);
    page.page.view.removeEventListener("Network.requestWillBeSent", countRequest);
    await page.close();
  }
}
