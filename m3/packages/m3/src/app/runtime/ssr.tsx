// SPDX-License-Identifier: Apache-2.0
// Server runtime of the ssr layer: turns the RSC stream into streamed HTML and inlines the RSC
// payload as `self.__m3_f.push(...)` scripts so the browser hydrates without a second request.
import { createFromReadableStream } from "react-server-dom-parcel/client.edge";
import { renderToReadableStream } from "react-dom/server";
import { aliases, installParcelRequire, loaders, modules } from "./registry";
import { Router } from "./router";
import { ASSET_PREFIX, type RscPayload } from "./shared";

/** What the generated ssr entry hands to the runtime: a loader per client module id. */
export function setClientModules(
  defs: Record<string, () => Promise<Record<string, unknown>>>,
): void {
  installParcelRequire(ASSET_PREFIX);
  for (const [id, loader] of Object.entries(defs))
    loaders.set(id, async () => {
      if (!modules.has(id)) modules.set(id, await loader());
    });
}

/** Map the browser bundle of each client module to its id (from the client manifest). */
export function setClientBundles(bundles: Record<string, string[]>): void {
  for (const [id, urls] of Object.entries(bundles)) for (const url of urls) aliases.set(url, id);
}

export interface RenderHtmlOptions {
  /** Browser entry module URL. */
  bootstrap: string;
  /** Inline script run before the bootstrap module. */
  bootstrapScriptContent?: string;
  formState?: unknown;
  nonce?: string;
  signal?: AbortSignal;
  onError?: (error: unknown) => void;
}

const encoder = new TextEncoder();

function scriptFor(text: string, nonce?: string): Uint8Array {
  const json = JSON.stringify(text)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const attr = nonce ? ` nonce="${nonce.replace(/"/g, "&quot;")}"` : "";
  return encoder.encode(`<script${attr}>(self.__m3_f||=[]).push(${json})</script>`);
}

const TAIL = "</body></html>";

/**
 * Interleave the RSC payload with the HTML. React may cut its output mid-tag, so HTML is buffered
 * and flushed at the end of the task, where React's flushes stop on a safe boundary; the payload
 * scripts go after it, once `<body>` is open, and the document tail goes last.
 */
function injectFlight(
  flight: ReadableStream<Uint8Array>,
  nonce?: string,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const htmlDecoder = new TextDecoder();
  let pending: string[] = [];
  let html: Uint8Array[] = [];
  let bodyOpen = false;
  let scheduled = false;
  let controller: TransformStreamDefaultController<Uint8Array>;
  let seen = "";

  const flushNow = () => {
    scheduled = false;
    for (const chunk of html) controller.enqueue(chunk);
    html = [];
    if (bodyOpen && pending.length) {
      controller.enqueue(scriptFor(pending.join(""), nonce));
      pending = [];
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(flushNow, 0);
  };

  const flightDone = (async () => {
    const reader = flight.getReader();
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle d'un flux : chaque chunk suit le précédent, dans l'ordre
      const { done, value } = await reader.read();
      if (done) break;
      pending.push(decoder.decode(value, { stream: true }));
      if (bodyOpen) schedule();
    }
    const rest = decoder.decode();
    if (rest) pending.push(rest);
  })();

  return new TransformStream<Uint8Array, Uint8Array>({
    start(c) {
      controller = c;
    },
    transform(chunk) {
      if (!bodyOpen) {
        seen = (seen + htmlDecoder.decode(chunk, { stream: true })).slice(-4096);
        bodyOpen = seen.includes("<body");
      }
      html.push(chunk);
      schedule();
    },
    async flush() {
      await flightDone;
      flushNow();
    },
  });
}

/** Strip `</body></html>` from the HTML so it can be re-appended after the payload scripts. */
function holdTail(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let carry = "";
  return new TransformStream({
    transform(chunk, controller) {
      const text = carry + decoder.decode(chunk, { stream: true });
      const index = text.lastIndexOf(TAIL);
      if (index !== -1 && text.slice(index + TAIL.length).trim() === "") {
        controller.enqueue(encoder.encode(text.slice(0, index)));
        carry = "";
        return;
      }
      // Keep a possible partial tail for the next chunk.
      const keep = Math.min(text.length, TAIL.length - 1);
      controller.enqueue(encoder.encode(text.slice(0, text.length - keep)));
      carry = text.slice(text.length - keep);
    },
    flush(controller) {
      const rest = carry + decoder.decode();
      if (rest) controller.enqueue(encoder.encode(rest));
    },
  });
}

function appendTail(): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    flush(controller) {
      controller.enqueue(encoder.encode(TAIL));
    },
  });
}

/** Render the HTML document of an RSC stream. */
export async function renderHtml(
  rsc: ReadableStream<Uint8Array>,
  options: RenderHtmlOptions,
): Promise<ReadableStream<Uint8Array>> {
  const [forReact, forInline] = rsc.tee();
  const payload = await createFromReadableStream<RscPayload>(forReact);
  const stream = await renderToReadableStream(<Router initial={payload} />, {
    bootstrapModules: [options.bootstrap],
    bootstrapScriptContent: options.bootstrapScriptContent,
    formState: (options.formState ?? payload.formState) as never,
    nonce: options.nonce,
    signal: options.signal,
    onError(error: unknown) {
      const digest = (error as { digest?: unknown } | null)?.digest;
      if (typeof digest === "string") return digest;
      options.onError?.(error);
      return undefined;
    },
  });
  return stream
    .pipeThrough(holdTail())
    .pipeThrough(injectFlight(forInline, options.nonce))
    .pipeThrough(appendTail());
}
