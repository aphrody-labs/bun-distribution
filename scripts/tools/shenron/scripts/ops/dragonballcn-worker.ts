/**
 * dragonballcn-worker.ts — Parallel Bun worker for DragonBallCN scraping.
 */
import { join, resolve } from "node:path";
import { DRAGONBALLCN_BASE_URL as BASE_URL, parseGalleryPages } from "../../../../../packages/shenron/pipeline/src/dragonballcn-gallery.ts";

const bxcRoot = process.env.BXC_ROOT?.trim() || resolve(import.meta.dir, "..", "..", "..", "aphrody-web", "apps", "bxc");
const { ImpersonatedClient } = await import(join(bxcRoot, "src", "ffi", "curl-impersonate.ts"));

let client: InstanceType<typeof ImpersonatedClient> | null = null;

function getClient(): InstanceType<typeof ImpersonatedClient> {
  if (!client) {
    client = new ImpersonatedClient({ profile: "chrome131" });
  }
  return client;
}

export interface WorkerTask {
  id: string; // DID
  did?: string;
  category: string;
  title: string;
  categoryTitle?: string;
  arc?: string;
  coverUrl?: string;
  url?: string;
  date?: string;
}

// Typage global Bun Worker
declare const self: {
  onmessage: ((event: MessageEvent<WorkerTask>) => void) | null;
  postMessage: (message: unknown) => void;
};

self.onmessage = async (event: MessageEvent<WorkerTask>) => {
  const task = event.data;
  const did = task.did || task.id;
  const targetUrl = `${BASE_URL}/list/gain_1.php?did=${encodeURIComponent(did)}`;

  try {
    const c = getClient();
    const res = await c.fetch(targetUrl, {
      headers: {
        Referer: `${BASE_URL}/`,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
      },
      timeoutMs: 45_000,
    });

    if (res.status >= 400) {
      throw new Error(`HTTP ${res.status} while fetching volume ${did}`);
    }

    const html = await res.text();
    const detail = parseGalleryPages(html, did, BASE_URL);

    self.postMessage({
      type: "success",
      did,
      volume: {
        ...task,
        did,
        title: task.title || detail.title,
        totalPages: detail.totalPages,
        pages: detail.pages,
      },
    }, self.location.origin);
  } catch (error) {
    self.postMessage({
      type: "error",
      did,
      error: error instanceof Error ? error.message : String(error),
    }, self.location.origin);
  }
};
