import type { MediaSource } from "./work";

export type PlayerFormat = "mp4" | "webm" | "hls" | "dash" | "embed" | "page";

export function inferPlayerFormat(url: string): PlayerFormat {
  const path = url.split(/[?#]/, 1)[0]!.toLowerCase();
  if (path.endsWith(".m3u8") || path.endsWith(".m3u")) return "hls";
  if (path.endsWith(".mpd")) return "dash";
  if (path.endsWith(".webm")) return "webm";
  if (path.endsWith(".mp4")) return "mp4";
  return "embed";
}

export function sourcePlayerUrl(source: MediaSource, startSeconds = 0): string {
  if (source.platform === "youtube") {
    const params = new URLSearchParams({ rel: "0", modestbranding: "1" });
    if (startSeconds > 0) params.set("start", String(Math.floor(startSeconds)));
    return `https://www.youtube-nocookie.com/embed/${source.id}?${params}`;
  }
  if (source.platform === "dailymotion") {
    const params = new URLSearchParams({ "queue-enable": "false", "sharing-enable": "false" });
    if (startSeconds > 0) params.set("start", String(Math.floor(startSeconds)));
    if (source.url.includes("/player/")) {
      params.set("video", source.id);
      return `${source.url.split("?")[0]}?${params}`;
    }
    return `https://www.dailymotion.com/embed/video/${source.id}?${params}`;
  }
  return source.url;
}

export function sourceFromEpisode(
  videoId: string,
  thumbnailUrl: string | null,
): MediaSource | null {
  if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return {
      platform: "youtube",
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      official: true,
    };
  }
  const dailymotionId = thumbnailUrl?.match(
    /dailymotion\.com\/thumbnail\/video\/([A-Za-z0-9]+)/,
  )?.[1];
  if (dailymotionId) {
    return { platform: "dailymotion", id: dailymotionId, url: thumbnailUrl!, official: true };
  }
  return null;
}

export function sourceIsPlayable(source: MediaSource): boolean {
  return source.platform !== "official_page" && source.platform !== "manga_publisher";
}
