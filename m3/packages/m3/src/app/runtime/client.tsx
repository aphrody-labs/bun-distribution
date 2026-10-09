// SPDX-License-Identifier: Apache-2.0
// Browser entry of the App Router: reads the inlined RSC payload, hydrates the document, wires
// `callServer` for server actions and client navigations, and listens for dev reloads.
import {
  createFromFetch,
  createFromReadableStream,
  createTemporaryReferenceSet,
  encodeReply,
  setServerCallback,
} from "react-server-dom-parcel/client.browser";
import { hydrateRoot } from "react-dom/client";
import { installParcelRequire } from "./registry";
import { applyPayload, navigate, Router } from "./router";
import { ACTION_HEADER, ASSET_PREFIX, HMR_PATH, RSC_CONTENT_TYPE, RSC_HEADER, type RscPayload } from "./shared";

installParcelRequire(ASSET_PREFIX, url => import(/* webpackIgnore: true */ `${ASSET_PREFIX}${url}`));

declare global {
  interface Window {
    __m3_f?: string[] | { push(chunk: string): void };
    __m3_dev?: boolean;
  }
}

function inlinePayload(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const queued = Array.isArray(self.__m3_f) ? self.__m3_f : [];
      for (const chunk of queued) controller.enqueue(encoder.encode(chunk));
      self.__m3_f = { push: (chunk: string) => controller.enqueue(encoder.encode(chunk)) };
      const close = () => controller.close();
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", close, { once: true });
      else close();
    },
  });
}

const load = (href: string) =>
  createFromFetch<RscPayload>(fetch(href, { headers: { [RSC_HEADER]: "1", accept: RSC_CONTENT_TYPE } }));

async function callServer(id: string, args: unknown[]): Promise<unknown> {
  const temporaryReferences = createTemporaryReferenceSet();
  const body = await encodeReply(args, { temporaryReferences });
  const response = fetch(location.pathname + location.search, {
    method: "POST",
    headers: { [ACTION_HEADER]: id, [RSC_HEADER]: "1", accept: RSC_CONTENT_TYPE },
    body,
  });
  const payload = await createFromFetch<RscPayload>(response, { temporaryReferences });
  if (payload.redirect) navigate(payload.redirect, true);
  else applyPayload(payload);
  const result = payload.returnValue as { ok: boolean; data: unknown } | undefined;
  if (result && !result.ok) throw result.data;
  return result?.data;
}

setServerCallback(callServer);

const initial = await createFromReadableStream<RscPayload>(inlinePayload());
hydrateRoot(document, <Router initial={initial} load={load} />, { formState: initial.formState as never });

if (self.__m3_dev) {
  const connect = () => {
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${HMR_PATH}`);
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)) as { type: string };
      if (message.type === "reload") location.reload();
      else if (message.type === "refresh") applyPayload(load(location.pathname + location.search));
    });
    socket.addEventListener("close", () => setTimeout(connect, 500));
  };
  connect();
}
