import { getPgPool } from "@/lib/db/pg";
import { cachePublic } from "@/lib/cache-public";

export const dynamic = "force-dynamic";

interface ScheduleSlotRow {
  start_time: string | null;
  end_time: string | null;
  streamer_name: string;
  category: string | null;
}

const {TWITCH_CLIENT_ID} = process.env;
const {TWITCH_CLIENT_SECRET} = process.env;
const DEFAULT_CHANNEL = "rose_griffontv";
const ALLOWED_CHANNELS = new Set(["rose_griffontv", "achillea_ie"]);

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
}

// Cache simple en mémoire pour le token
let accessToken: string | null = null;
let tokenExpiry: number = 0;

async function getTwitchAccessToken(): Promise<string | null> {
  if (accessToken && Date.now() < tokenExpiry) {return accessToken;}
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {return null;}

  try {
    const params = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    });

    const response = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, {
      method: "POST",
    });

    if (!response.ok) {return null;}

    const data: TwitchTokenResponse = await response.json();
    accessToken = data.access_token;
    tokenExpiry = Date.now() + data.expires_in * 1000 - 60_000;
    return accessToken;
  } catch {
    return null;
  }
}

function twitchHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Client-ID": TWITCH_CLIENT_ID!,
  };
}

async function twitchFetch(url: string, token: string) {
  const res = await fetch(url, { headers: twitchHeaders(token), next: { revalidate: 300 } });
  if (!res.ok) {return null;}
  return res.json();
}

// ─── YouTube fallback (rediffs) ─────────────────────────────────────────
// Pas d'API key requise — utilise le RSS feed natif (15 dernières vidéos).
const YOUTUBE_CHANNEL_IDS: Record<string, string> = {
  achillea_ie: "UCh2FiAYaOfuvwTaBVs7CpFw", // @achillearg
  rose_griffontv: "UCleqt3V_yTgxY6XLZeEFV8g", // @rose-griffon
};

interface YoutubeVideo {
  id: string;
  title: string;
  thumbnail_url: string;
  view_count: number;
  created_at: string;
  duration: string;
  url: string;
  type: "youtube";
}

async function fetchYoutubeVideos(channel: string): Promise<YoutubeVideo[]> {
  const channelId = YOUTUBE_CHANNEL_IDS[channel];
  if (!channelId) {return [];}
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
      next: { revalidate: 600 },
    });
    if (!res.ok) {return [];}
    const xml = await res.text();
    const decode = (s: string) =>
      s
        .replaceAll(/&amp;/g, "&")
        .replaceAll(/&quot;/g, '"')
        .replaceAll(/&#39;/g, "'")
        .replaceAll(/&lt;/g, "<")
        .replaceAll(/&gt;/g, ">");

    const out: YoutubeVideo[] = [];
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    let match: RegExpExecArray | null = entryRe.exec(xml);
    while (match !== null) {
      const block = match[1] ?? "";
      const id = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
      const title = block.match(/<title>([^<]+)<\/title>/)?.[1];
      const published = block.match(/<published>([^<]+)<\/published>/)?.[1];
      const thumb = block.match(/<media:thumbnail[^/]*url="([^"]+)"/)?.[1];
      const views = block.match(/<media:statistics[^/]*views="([^"]+)"/)?.[1];
      if (id && title) {
        out.push({
          created_at: published ?? "",
          duration: "",
          id,
          thumbnail_url: thumb ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          title: decode(title),
          type: "youtube",
          url: `https://www.youtube.com/watch?v=${id}`,
          view_count: views ? Number.parseInt(views, 10) : 0,
        });
      }
      match = entryRe.exec(xml);
    }
    return out;
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedChannel = url.searchParams.get("channel") || DEFAULT_CHANNEL;
  const channel = ALLOWED_CHANNELS.has(requestedChannel) ? requestedChannel : DEFAULT_CHANNEL;
  const isPrimaryChannel = channel === DEFAULT_CHANNEL;

  const token = await getTwitchAccessToken();
  let liveData = { category: "", is_live: false, started_at: "", title: "", viewers: 0 };
  let userId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let videos: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let clips: any[] = [];
  let followers = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channelInfo: any = null;

  if (token && TWITCH_CLIENT_ID) {
    try {
      // 1. Récupérer l'utilisateur (pour broadcaster_id)
      const userData = await twitchFetch(
        `https://api.twitch.tv/helix/users?login=${channel}`,
        token
      );
      userId = userData?.data?.[0]?.id || null;

      // 2. Statut live (cache 1 min)
      const streamData = await fetch(`https://api.twitch.tv/helix/streams?user_login=${channel}`, {
        headers: twitchHeaders(token),
        next: { revalidate: 60 },
      }).then((r) => (r.ok ? r.json() : null));

      const stream = streamData?.data?.[0];
      if (stream) {
        liveData = {
          category: stream.game_name,
          is_live: true,
          started_at: stream.started_at,
          title: stream.title,
          viewers: stream.viewer_count,
        };
      }

      if (userId) {
        // 3. VODs : archive prioritaire, fallback highlight, puis upload (couvre tous les cas)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapVideo = (v: any) => ({
          created_at: v.created_at,
          duration: v.duration,
          id: v.id,
          thumbnail_url: v.thumbnail_url,
          title: v.title,
          type: v.type as "archive" | "highlight" | "upload",
          url: v.url,
          view_count: v.view_count,
        });
        for (const type of ["archive", "highlight", "upload"] as const) {
          const data = await twitchFetch(
            `https://api.twitch.tv/helix/videos?user_id=${userId}&first=12&type=${type}`,
            token
          );
          const list = data?.data || [];
          if (list.length > 0) {
            videos = list.map(mapVideo);
            break;
          }
        }

        // Fallback YouTube si Twitch n'a aucun VOD
        if (videos.length === 0) {
          videos = await fetchYoutubeVideos(channel);
        }

        // 4. Tous les clips all-time (paginate jusqu'à épuisement, max 2000)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const allClips: any[] = [];
        let cursor: string | undefined;
        const MAX_CLIP_PAGES = 20; // 20 * 100 = 2000 clips max
        for (let i = 0; i < MAX_CLIP_PAGES; i++) {
          const params = new URLSearchParams({ broadcaster_id: userId, first: "100" });
          if (cursor) {params.set("after", cursor);}
          const page = await twitchFetch(
            `https://api.twitch.tv/helix/clips?${params.toString()}`,
            token
          );
          if (!page?.data?.length) {break;}
          allClips.push(...page.data);
          cursor = page.pagination?.cursor;
          if (!cursor) {break;}
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        clips = allClips.map((c: any) => ({
          created_at: c.created_at,
          creator_name: c.creator_name,
          id: c.id,
          thumbnail_url: c.thumbnail_url,
          title: c.title,
          url: c.url,
          view_count: c.view_count,
        }));

        // 5. Followers count
        const followersData = await twitchFetch(
          `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${userId}&first=1`,
          token
        );
        followers = followersData?.total || 0;

        // 6. Channel info
        const user = userData?.data?.[0];
        if (user) {
          channelInfo = {
            broadcaster_language: "fr",
            createdAt: user.created_at,
            description: user.description,
            profileImageUrl: user.profile_image_url,
            totalViews: user.view_count || 0,
          };
        }
      }
    } catch (error) {
      console.error("Erreur API Twitch:", error);
    }
  }

  // Planning depuis Postgres (direct, bypass Data API Supabase) — uniquement pour la chaîne primaire (RGTV)
  let nextStream: unknown = null;
  let currentScheduled: unknown = null;
  if (isPrimaryChannel) {
    const today = new Date().getDay();
    const nowTime = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    let schedule: ScheduleSlotRow[] = [];
    try {
      const pool = getPgPool();
      const result = await pool.query<ScheduleSlotRow>(
        `SELECT start_time, end_time, streamer_name, category
         FROM stream_schedules
         WHERE day_of_week = $1 AND status = $2
         ORDER BY start_time ASC`,
        [today, "active"]
      );
      schedule = result.rows;
    } catch (dbError) {
      console.error("Erreur Postgres Schedule:", dbError);
    }

    nextStream = schedule.find((s) => s.start_time && s.start_time > nowTime) || null;
    currentScheduled =
      schedule.find((s) => s.start_time && s.end_time && s.start_time <= nowTime && s.end_time > nowTime) ||
      null;
  }

  return Response.json({
    channel,
    url: `https://twitch.tv/${channel}`,
    live: liveData,
    videos,
    clips,
    followers,
    channelInfo,
    schedule: {
      current: currentScheduled,
      next: nextStream,
    },
    updated_at: new Date().toISOString(),
  }, { headers: cachePublic(60, 300) });
}
