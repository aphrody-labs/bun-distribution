# Politique de sécurité du contenu de rosegriffon.fr — en mode RAPPORT SEUL.
#
# POURQUOI REPORT-ONLY
# Une CSP posée d'emblée en mode bloquant casse la page au premier domaine oublié, et
# personne ne le voit avant le visiteur. Celle-ci est dérivée des sources réellement
# déclarées par l'application — `images.remotePatterns` de apps/website/next.config.ts
# pour img-src, les deux `<script>` en ligne de src/app/layout.tsx (pré-application du
# thème et JSON-LD) pour 'unsafe-inline'. Elle est donc plausible, pas vérifiée : tant
# qu'aucune session de navigation n'a confirmé zéro violation, elle reste en
# `Content-Security-Policy-Report-Only`, qui rapporte dans la console sans jamais
# bloquer une ressource.
#
# BASCULE EN MODE BLOQUANT
# Ouvrir rosegriffon.fr, la boutique et une fiche produit dans un navigateur, console
# ouverte ; si aucune ligne « [Report Only] Refused to load… » n'apparaît, renommer
# l'en-tête ci-dessous en `Content-Security-Policy`. Le pendant bloquant tourne déjà sur
# azalee.rosegriffon.fr, où l'application l'émet elle-même.
#
# GOOGLE TAG MANAGER
# Le conteneur chargé par src/app/layout.tsx n'était pas déclaré ici : la mesure
# d'audience aurait cessé de fonctionner à la bascule en mode bloquant, sans que
# rien ne le signale ailleurs que dans la console d'un visiteur.
#
# GOOGLE ADSENSE
# Les hôtes publicitaires sont alignés sur ceux de apps/website/next.config.ts, où la
# même politique tourne en mode bloquant. `frame-src` n'est donc plus `'none'` : une
# annonce s'affiche dans une iframe, et l'interdire laisse l'emplacement vide sans
# autre trace qu'un « Refused to frame » en console. Le contenu des créations est
# régi par la CSP de ces iframes, pas par celle-ci.
#
# `frame-ancestors 'none'` double X-Frame-Options: DENY de rg-securite.inc — c'est
# volontaire : X-Frame-Options est l'ancien mécanisme, frame-ancestors le remplace, et
# les deux se contredisent seulement s'ils divergent, ce qu'ils ne font pas ici.
#
# ── RELEVÉ DU 20/9/2026 : ce que le NAVIGATEUR charge vraiment ──────────────────
# Les hôtes ci-dessous ne sont pas déduits d'une lecture du code mais extraits des
# paquets client réellement servis (`/home/ubuntu/rg-releases/website/static/chunks`),
# puis reliés un à un à leur appelant. La liste précédente avait été écrite avant la
# fusion Azalée→Website et il y manquait six familles entières.
#
# GOOGLE MAPS (/evenements, /epita-map)
#   `src/hooks/useGoogleMaps.ts` importe `@googlemaps/js-api-loader` à la volée ; le
#   loader injecte `<script src="https://maps.googleapis.com/maps/api/js">` puis
#   dialogue en XHR avec le même hôte → `script-src` ET `connect-src`. Il injecte
#   aussi la feuille Roboto de `fonts.googleapis.com` (`style-src`) et tire ses
#   tuiles de `maps.gstatic.com` (déjà couvert par `*.gstatic.com`), ses photos de
#   lieu de `*.ggpht.com`. Sans ces trois lignes la carte ne s'initialise jamais :
#   elle reste un rectangle vide, sans erreur réseau visible.
#
# GÉOCODAGE NOMINATIM (/evenements)
#   `src/app/(sousdossiers)/evenements/useEvents.ts` convertit les adresses en
#   coordonnées via `nominatim.openstreetmap.org` — OpenStreetMap, pas Google. Sans
#   cette entrée en `connect-src`, la carte se charge mais AUCUN marqueur n'a de
#   position : le symptôme ressemble à « la base est vide », pas à « la CSP bloque ».
#   (La clé `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` n'est pas autorisée sur l'API Geocoding
#   de Google ; c'est sans effet ici puisque le code ne l'appelle pas.)
#
# WIDGET DISCORD (/community)
#   `src/components/shared/DiscordSection.tsx` appelle
#   `https://discord.com/api/guilds/<id>/widget.json` DEPUIS LE NAVIGATEUR, pour les
#   deux serveurs. `cdn.discordapp.com` (avatars) était déclaré, l'API ne l'était pas.
#
# ACHILLÉA TEMPS RÉEL (/achillea/ranked, /achillea/ranked/match)
#   `src/lib/achillea/use-ranked-queue.ts` et `use-ranked-match.ts` ouvrent une
#   connexion Colyseus vers `wss://ranked.rosegriffon.fr` (valeur de repli, aucune
#   variable d'env définie en production), et `@rosegriffon/achillea-client` interroge
#   `https://ranked.rosegriffon.fr/api`. Un schéma `wss:` doit être déclaré
#   explicitement : `https://…` ne l'autorise pas.
#
# AZALÉE — CONSERVÉ, CONTRAIREMENT AUX APPARENCES
#   `azalee.rosegriffon.fr` ne fait PAS que rediriger : son vhost inclut toujours
#   `supabase-compat.inc`, donc `/rest/v1/` et `/storage/v1/` y répondent (vérifié :
#   200 sur `/rest/v1/`). `src/app/admin/database/images/page.tsx` compose encore des
#   URL `…/storage/v1/object/public/menu/…`. Le retirer de `img-src` casserait la
#   bibliothèque d'images de l'admin ; il reste, et part le jour où ce vhost ne
#   proxifiera plus rien.
#
# TWITCH (/rose-griffon-tv)
#   `react-twitch-embed` charge `embed.twitch.tv` (`script-src`) et pose des iframes
#   de lecteur ; `TwitchChat.tsx` pose une iframe `https://www.twitch.tv/embed/…/chat`
#   → `frame-src`. Trois hôtes d'iframe au total selon le composant utilisé.
#
# IFRAME NOSCRIPT DE GTM
#   `@next/third-parties` pose le repli `<noscript><iframe src=googletagmanager…>`.
#   L'hôte était en `script-src` mais absent de `frame-src`.
#
# POLICES ET TRAVAILLEURS
#   `res.cloudinary.com` sert la Compressa VF de l'effet TextPressure (page 404) →
#   `font-src`. `browser-image-compression` (`src/lib/nostalgie-utils.ts`) exécute sa
#   compression dans un Worker, construit depuis un Blob avec repli sur
#   `cdn.jsdelivr.net` → `worker-src 'self' blob:` + `script-src blob:`. Sans
#   `worker-src`, le repli est `default-src 'self'`, qui interdit `blob:`.
#
# IMAGES INAZUMA
#   `www.inazuma.jp`, `zukan.inazuma.jp` et `inazuma.jp` sont déclarés dans
#   `images.remotePatterns` de next.config.ts mais manquaient ici. Ils ne transitent
#   par `/_next/image` (donc par `'self'`) que si le composant optimise ; les
#   bannières de `/wiki/cross` ne le font pas toutes.
add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'unsafe-inline' blob: https://www.googletagmanager.com https://www.google-analytics.com https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.googleadservices.com https://*.doubleclick.net https://*.adtrafficquality.google https://fundingchoicesmessages.google.com https://adservice.google.com https://www.google.com https://maps.googleapis.com https://embed.twitch.tv https://cdn.jsdelivr.net; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data: https://cdn.rosegriffon.fr https://azalee.rosegriffon.fr https://achillea.rosegriffon.fr https://placehold.co https://cdn.discordapp.com https://static-cdn.jtvnw.net https://pbs.twimg.com https://abs.twimg.com https://dxi4wb638ujep.cloudfront.net https://www.inazuma.jp https://zukan.inazuma.jp https://inazuma.jp https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google https://www.google.com https://*.googleusercontent.com https://*.gstatic.com https://maps.googleapis.com https://*.ggpht.com; media-src 'self' blob: data: https://cdn.rosegriffon.fr; font-src 'self' data: https://cdn.rosegriffon.fr https://*.gstatic.com https://res.cloudinary.com; connect-src 'self' https://cdn.rosegriffon.fr https://api.rosegriffon.fr https://azalee.rosegriffon.fr https://achillea.rosegriffon.fr https://ranked.rosegriffon.fr wss://ranked.rosegriffon.fr https://discord.com https://nominatim.openstreetmap.org https://maps.googleapis.com https://cdn.jsdelivr.net https://www.googletagmanager.com https://www.google-analytics.com https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google https://www.google.com https://*.gstatic.com https://fundingchoicesmessages.google.com; frame-src https://googleads.g.doubleclick.net https://*.doubleclick.net https://*.googlesyndication.com https://*.adtrafficquality.google https://www.google.com https://fundingchoicesmessages.google.com https://www.googletagmanager.com https://www.twitch.tv https://embed.twitch.tv https://player.twitch.tv; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
