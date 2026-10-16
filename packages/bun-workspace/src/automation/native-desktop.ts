// SPDX-License-Identifier: Apache-2.0
/** Product startup against Yolo's precompiled system-WebView host; no engine source graph. */
import { desktop, type DesktopSession, type DesktopWindow } from "@aphrody/runtime-sdk/desktop";

export interface NativeDesktopOptions {
  /** URL of the product's existing canonical UI server. */
  url: string;
  title: string;
  executable?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface NativeDesktopApplication {
  readonly session: DesktopSession;
  readonly window: DesktopWindow;
  close(): Promise<void>;
}

/** A loaded page is startup evidence; screenshot/rendering and bundle gates stay separate. */
export async function launchNativeDesktop(options: NativeDesktopOptions): Promise<NativeDesktopApplication> {
  options.signal?.throwIfAborted();
  const url = new URL(options.url);
  const session = await desktop.open({
    grants: ["window.create", "window.control", "window.observe"],
    allowedOrigins: [url.origin],
    ...(options.executable === undefined ? {} : { executable: options.executable }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  try {
    const window = await session.createWindow({
      url: String(url),
      title: options.title,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    let sequence = 0;
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted();
      // eslint-disable-next-line no-await-in-loop -- Poll the single native event cursor in order.
      const events = await session.events(sequence);
      sequence = events.sequence;
      if (events.events.some(event => event.window === window.id && event.kind === "destroyed")) {
        throw new Error("Product desktop was destroyed before its page loaded");
      }
      if (events.events.some(event => event.window === window.id && event.kind === "load-finished")) {
        return { session, window, close: () => session.close() };
      }
      // eslint-disable-next-line no-await-in-loop -- Bound native polling without occupying the UI thread.
      await Bun.sleep(25);
    }
    throw new Error("Product desktop page did not load before its startup deadline");
  } catch (error) {
    await session.close();
    throw error;
  }
}
