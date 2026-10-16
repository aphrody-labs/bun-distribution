import type { MediaEntry, WorkRef } from "./work";
import { runtimeForMediaKind } from "./runtime";

export interface MangaVolume {
  work: WorkRef;
  volume: number;
  title: string;
  url?: string | null;
  publisher?: string | null;
  official?: boolean;
}

/** Adapts a manga volume to the same catalogue consumed by films and episodes. */
export function mangaVolumeEntry(volume: MangaVolume): MediaEntry {
  return {
    id: `${volume.work.id}:manga:${volume.volume}`,
    kind: "manga_volume",
    work: volume.work,
    title: volume.title,
    season: volume.volume,
    volume: volume.volume,
    runtime: runtimeForMediaKind("manga_volume"),
    sources: volume.url
      ? [
          {
            id: `${volume.work.id}:manga:${volume.volume}:source`,
            platform: "manga_publisher",
            url: volume.url,
            official: volume.official ?? false,
          },
        ]
      : [],
  };
}
