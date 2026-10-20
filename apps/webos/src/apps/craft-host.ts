// SPDX-License-Identifier: Apache-2.0
// Same-origin host for Craft web apps that already implement their parent file bridge.
import {
  webosCraftFileBridges,
  type CraftHostId,
} from "@aphrody/bun-workspace/capabilities";

export type { CraftHostId } from "@aphrody/bun-workspace/capabilities";

const BRIDGES = webosCraftFileBridges();
const BRIDGE_BY_ID = new Map(
  BRIDGES.map(({ bridge }) => [bridge.id, bridge] as const),
);
const BRIDGE_BY_PACKAGE = new Map(
  BRIDGES.map(({ packageId, bridge }) => [packageId, bridge] as const),
);
const BRIDGE_BY_EXTENSION = new Map(
  BRIDGES.flatMap(({ bridge }) =>
    bridge.extensions.map((extension) => [extension, bridge] as const),
  ),
);
const MAX_PENDING_BYTES = 64 * 1024 * 1024;
const MAX_NAME_CHARS = 240;

export function craftHostForPath(path: string): CraftHostId | undefined {
  const ext = path
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.split(".")
    .pop()
    ?.toLowerCase();
  return ext ? BRIDGE_BY_EXTENSION.get(ext)?.id : undefined;
}

export function craftHostForPackage(
  packageId: string,
): CraftHostId | undefined {
  return BRIDGE_BY_PACKAGE.get(packageId)?.id;
}

export function craftHostMaxFileBytes(id: CraftHostId): number {
  return BRIDGE_BY_ID.get(id)?.maxFileBytes ?? 0;
}

function messageType(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return;
  const type = (data as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

function fileName(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return;
  const raw = (data as { name?: unknown }).name;
  if (typeof raw !== "string") return;
  const name = raw.replaceAll("\\", "/").split("/").pop()?.trim();
  if (!name || name === "." || name === "..") return;
  return [...name]
    .map((char) =>
      char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? "_" : char,
    )
    .join("")
    .slice(0, MAX_NAME_CHARS);
}

function fileBytes(data: unknown): Uint8Array | undefined {
  if (!data || typeof data !== "object") return;
  const raw = (data as { bytes?: unknown }).bytes;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (raw instanceof Uint8Array) return raw;
}

export interface CraftHost {
  open(name: string, bytes: Uint8Array): boolean;
  dispose(): void;
}

/** Attach the app's existing open/save protocol to its WebOS host. */
export function attachCraftHost(
  frame: HTMLIFrameElement,
  id: CraftHostId,
  onSave: (name: string, bytes: Uint8Array) => void | Promise<void>,
): CraftHost {
  const bridge = BRIDGE_BY_ID.get(id);
  if (!bridge) throw new Error(`No WebOS file bridge is registered for ${id}`);
  const prefix = bridge.protocol;
  const pending: Array<{ name: string; bytes: Uint8Array }> = [];
  let pendingBytes = 0;
  let ready = false;
  let disposed = false;

  const sendOpen = (name: string, bytes: Uint8Array) => {
    const target = frame.contentWindow;
    if (!target) return false;
    const buffer = bytes.slice().buffer;
    try {
      target.postMessage(
        { type: `${prefix}:open`, name, bytes: buffer },
        location.origin,
        [buffer],
      );
      return true;
    } catch (error) {
      console.error(`Could not open ${name} in ${prefix}`, error);
      return false;
    }
  };

  const onMessage = (event: MessageEvent<unknown>) => {
    if (
      disposed ||
      event.origin !== location.origin ||
      event.source !== frame.contentWindow
    )
      return;

    const type = messageType(event.data);
    if (type === `${prefix}:ready`) {
      ready = true;
      const files = pending.splice(0);
      pendingBytes = 0;
      for (const file of files) sendOpen(file.name, file.bytes);
      return;
    }
    if (type !== `${prefix}:save`) return;

    const name = fileName(event.data);
    const bytes = fileBytes(event.data);
    if (!name || !bytes || bytes.byteLength > bridge.maxFileBytes) {
      console.warn(`Rejected invalid or oversized ${prefix} save`);
      return;
    }
    void Promise.resolve(onSave(name, bytes)).catch((error) =>
      console.error(`Could not save ${name} from ${prefix}`, error),
    );
  };

  const onLoad = () => {
    ready = false;
  };

  window.addEventListener("message", onMessage);
  frame.addEventListener("load", onLoad);
  return {
    open(name, bytes) {
      if (disposed || bytes.byteLength > bridge.maxFileBytes) return false;
      if (!ready) {
        if (pendingBytes + bytes.byteLength > MAX_PENDING_BYTES) return false;
        pending.push({ name, bytes: bytes.slice() });
        pendingBytes += bytes.byteLength;
        return true;
      }
      return sendOpen(name, bytes);
    },
    dispose() {
      disposed = true;
      pending.length = 0;
      pendingBytes = 0;
      window.removeEventListener("message", onMessage);
      frame.removeEventListener("load", onLoad);
    },
  };
}
