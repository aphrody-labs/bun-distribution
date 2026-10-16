// Source: apps/shenron/site/src/lib/youtube.ts at 8172f535ce (preserved Git history).
/**
 * Helpers YouTube (client-safe) — extraction d'id + URL d'embed/thumbnail.
 * Accepte watch?v=, youtu.be/, embed/, shorts/, live/, ou un id brut 11 chars.
 */

const YT_ID_RE = /^[\w-]{11}$/;

export function extractYoutubeId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (YT_ID_RE.test(s)) return s;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id && YT_ID_RE.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && YT_ID_RE.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      // /embed/ID, /shorts/ID, /live/ID, /v/ID
      if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0]!)) {
        const id = parts[1]!;
        return YT_ID_RE.test(id) ? id : null;
      }
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function youtubeEmbedUrl(raw: string): string | null {
  const id = extractYoutubeId(raw);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

export function youtubeThumbUrl(raw: string): string | null {
  const id = extractYoutubeId(raw);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
