# Architecture CDN & Stratégie de Cache Unifiée — Shenron VPS

> **Historique.** Ce document décrit la topologie mono-VPS `dbfr` (Next.js en
> bleu/vert sur les ports `3000`/`3010`, Nginx local). `dbfr` ne sert plus le
> site depuis la délégation à `aphrody-infra` (unités `shenron-site`, `shenron-mcp`,
> `shenron-bot`, sur le VPS principal partagé avec RG/Aphrody/NIE) — voir
> [`INFRA-DELEGATION.md`](INFRA-DELEGATION.md). Les stratégies de cache
> Nginx décrites ci-dessous restent une référence technique, sans garantie
> que les zones/ports correspondent à la configuration actuelle.

## 1. Contexte & Topologie Réelle du VPS (`dbfr`, relevé historique)

- **OS / Serveur Web :** Ubuntu Linux, Nginx 1.28.3 (modules `ngx_brotli`, HTTP/2 et HTTP/3 QUIC natifs).
- **Ressources Machine :** 11 Go RAM, 16 Go Swap.
- **Stockage Critique :** Partition racine `/dev/root` à 90 % d'utilisation (70 Go occupés, **7.9 Go libres**).
- **Empreinte Données :**
  - `apps/site/public/wiki` : ~19 Go (vidéos MP4, webm, clips d'épisodes).
  - `apps/bot/assets` : ~2.9 Go (assets personnages, bannières, sprites DBZ).
  - `apps/site/.next/cache/images` : cache interne de transformation Next.js.
- **DNS / SSL :** Zone `dragonballfr.com` chez OVH, résolution DNS directe (A) vers l'hôte frontal, certificats Let's Encrypt via certbot (ECDSA / RSA).
- **Services locaux unifiés :**
  - `shenron-site.service` (Next.js 16 sous Bun, port 5011, un seul process)
  - `shenron-bot.service` (Bot Shenron / API REST & HLS sur port 5006)
  - `shenron-mcp.service` (Serveur MCP public sur port 5010)

---

## 2. Architecture CDN Hybride à Deux Niveaux

```
                [ Utilisateurs Web / Mobile ]
                             │
                             ▼ (HTTPS / HTTP3 QUIC)
┌─────────────────────────────────────────────────────────────────────────┐
│ Tier 2 (Optionnel - Edge) : Cloudflare Proxy (DNS Proxied)              │
│  - Mise en cache en bordure des assets immutables (statique, fonts)     │
│  - Règles de contournement strictes sur /api/auth/* et /api/wiki-admin/*│
│  - Restitution IP réelle via header CF-Connecting-IP                    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼ (hôte frontal :443)
┌─────────────────────────────────────────────────────────────────────────┐
│ Tier 1 (VPS Frontal Local) : Nginx Reverse-Proxy Haute Performance      │
│  ├── Zone shenron_static  (max_size=2.5G, inactive=30d)                 │
│  │    └─ /_next/static/*, /assets/dbz/*                                 │
│  ├── Zone shenron_images  (max_size=2.0G, inactive=7d)                  │
│  │    └─ /_next/image (clé incluant $http_accept pour AVIF/WebP)        │
│  ├── Zone shenron_hls     (max_size=1.5G, inactive=12h)                 │
│  │    └─ /api/hls/* (Playlists TTL court, Segments TS/MP4 TTL 24h)      │
│  └── Thundering Herd Lock (proxy_cache_lock on)                         │
└────────────┬───────────────────────┬────────────────────────┬───────────┘
             │                       │                        │
             ▼                       ▼                        ▼
    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
    │ Next.js 16 Site  │    │ Bot Shenron API  │    │ Serveur MCP      │
    │ (:3000 / :3010)  │    │ (Bun.serve :5006)│    │ (Bun.serve :5010)│
    │  Bleu / Vert     │    │ Canvas, HLS, API │    │    Pas de cache  │
    └──────────────────┘    └──────────────────┘    └──────────────────┘
```

---

## 3. Matrice des Politiques de Cache

| Type de Ressource | Emplacement / Pattern | Cache-Control | Zone Nginx | Validité | Stratégie Invalidation |
|---|---|---|---|---|---|
| **JS / CSS Next.js** | `/_next/static/*` | `public, max-age=31536000, immutable` | `shenron_static` | 30 jours | Hash de compilation (`deploymentId`) |
| **Images Next.js** | `/_next/image?url=...` | `public, max-age=86400, must-revalidate` | `shenron_images` | 7 jours | Éviction LRU automatique |
| **Segments HLS** | `/api/hls/:id/seg` | `public, max-age=86400, immutable` | `shenron_hls` | 24 heures | URLs signées immuables |
| **Playlists HLS** | `/api/hls/:id/master.m3u8` | `public, max-age=10, stale-while-revalidate=60` | `shenron_hls` | 10 secondes | Revalidation ultra-rapide |
| **Canvas & Cartes** | `/api/canvas/*` | `public, max-age=60, s-maxage=300` | `shenron_images` | 5 minutes | Expiration naturelle par TTL |
| **Pages SSR / ISR** | `/wiki/*`, `/news/*` | `s-maxage=300, stale-while-revalidate` | ISR Next.js | Dynamique | On-Demand Revalidation (`revalidatePath`) |
| **Auth & Admin** | `/api/auth/*`, `/api/wiki-admin/*` | `no-store, private` | **BYPASS** | 0 | Jamais mis en cache |

---

## 4. Directives Nginx Recommandées

### A. Configuration HTTP globale (`/etc/nginx/conf.d/00-shenron-cache.conf`)

```nginx
# Zones de cache Nginx calibrées pour préserver les 7.9 Go disque restants
# Total réservé : 2.5G + 2.0G + 1.5G = 6.0G max avec purge LRU

proxy_cache_path /var/cache/nginx/shenron_static
    levels=1:2
    keys_zone=shenron_static:10m
    max_size=2500m
    inactive=30d
    use_temp_path=off;

proxy_cache_path /var/cache/nginx/shenron_images
    levels=1:2
    keys_zone=shenron_images:20m
    max_size=2000m
    inactive=7d
    use_temp_path=off;

proxy_cache_path /var/cache/nginx/shenron_hls
    levels=1:2
    keys_zone=shenron_hls:10m
    max_size=1500m
    inactive=12h
    use_temp_path=off;

# Contournement automatique pour les sessions Better-Auth
map $http_cookie $bypass_user_cache {
    default 0;
    ~*better-auth\.session_token 1;
    ~*__Secure-better-auth 1;
}
```

### B. Intégration dans le vhost Site (`deploy/nginx/dragonballfr.com.conf`)

```nginx
# Cache des chunks Next.js
location /_next/static/ {
    proxy_pass http://shenron_site;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_cache shenron_static;
    proxy_cache_valid 200 30d;
    proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
    add_header X-Cache-Status $upstream_cache_status always;
}

# Cache de l'optimiseur d'images avec format AVIF/WebP
location /_next/image {
    proxy_pass http://shenron_site;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_cache shenron_images;
    proxy_cache_key "$scheme$request_method$host$uri$is_args$args$http_accept";
    proxy_cache_valid 200 7d;
    proxy_cache_lock on;
    proxy_cache_lock_timeout 5s;
    add_header X-Cache-Status $upstream_cache_status always;
}

# Cache local des descripteurs de fichiers pour les médias lourds
open_file_cache max=10000 inactive=30s;
open_file_cache_valid 60s;
open_file_cache_min_uses 2;
open_file_cache_errors on;
```

---

## 5. Déploiement et Activation

1. Création des répertoires de cache système sur le VPS :
   ```bash
   sudo mkdir -p /var/cache/nginx/shenron_static /var/cache/nginx/shenron_images /var/cache/nginx/shenron_hls
   sudo chown -R www-data:www-data /var/cache/nginx
   sudo chmod -R 700 /var/cache/nginx
   ```
2. Validation de la configuration sans interruption de service :
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. Vérification des en-têtes de réponse :
   - Requête 1 : `X-Cache-Status: MISS`
   - Requête 2 : `X-Cache-Status: HIT`
