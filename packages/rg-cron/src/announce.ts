/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Annonces Discord des publications du site — `POST /v1/discord/announce`.
 *
 * Reprise du serveur `:3006/announce` de l'ancien démon, en REST : il publiait
 * avec le client de passerelle connecté, qu'une fonction serverless n'a pas.
 *
 * ── CE SERVICE PUBLIE DANS UN SALON PUBLIC ──────────────────────────────────
 *  1. **AUCUN SECRET PAR DÉFAUT.** Sans `DISCORD_ANNOUNCE_SECRET`, tout est
 *     refusé : il vaut mieux une annonce qui ne part pas qu'une annonce que
 *     personne n'a demandée.
 *  2. **AUCUNE DEVINETTE DE SALON.** Un salon d'annonces se DÉSIGNE
 *     (`DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID`,
 *     `DISCORD_WEBSITE_ANNOUNCEMENTS_CHANNEL_ID`, à défaut
 *     `DISCORD_NEWS_CHANNEL_ID`) ; il ne se devine pas.
 */

import { timingSafeEqual } from "node:crypto";
import { publierMessageDiscord } from "./lib/discord-rest.js";

function autorise(request: Request, secret: string): boolean {
  const a = Buffer.from(request.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleAnnounceHttp(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Not Found", { status: 404 });

  const secret = (Bun.env.DISCORD_ANNOUNCE_SECRET ?? "").trim();
  if (secret === "") {
    console.error("[announce] requête refusée : DISCORD_ANNOUNCE_SECRET n'est pas configuré.");
    return new Response("Announce service not configured", { status: 503 });
  }
  if (!autorise(request, secret)) return new Response("Unauthorized", { status: 401 });

  let corps: { type?: string; title?: string; slug?: string; excerpt?: string; featured_image_url?: string };
  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const { type, title, slug, excerpt, featured_image_url } = corps;
  if (!title || !slug) return new Response("Missing title or slug", { status: 400 });

  const wiki = type === "wiki";
  const salon = wiki
    ? Bun.env.DISCORD_WIKI_ANNOUNCEMENTS_CHANNEL_ID || Bun.env.DISCORD_NEWS_CHANNEL_ID
    : Bun.env.DISCORD_WEBSITE_ANNOUNCEMENTS_CHANNEL_ID || Bun.env.DISCORD_NEWS_CHANNEL_ID;
  if (!salon) {
    console.error("[announce] refusé : aucun salon d'annonces configuré. Un salon public ne se devine pas.");
    return new Response("Announce channel not configured", { status: 503 });
  }

  const message = await publierMessageDiscord(salon, {
    embeds: [
      {
        title,
        url: wiki ? `https://azalee.rosegriffon.fr/news/${slug}` : `https://rosegriffon.fr/chroniques/${slug}`,
        description: excerpt || undefined,
        // Orange Azalée / rouge Rose Griffon.
        color: wiki ? 0xf2a93b : 0xa14b3f,
        image: featured_image_url ? { url: featured_image_url } : undefined,
        footer: { text: wiki ? "Azalée — Rose Griffon" : "Rose Griffon" },
        timestamp: new Date().toISOString(),
      },
    ],
  });
  if (!message) return Response.json({ error: "Publication Discord refusée" }, { status: 502 });
  console.log(`[announce] Annonce envoyée pour « ${title} » dans le salon ${salon}`);
  return Response.json({ success: true });
}
