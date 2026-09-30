# SUPERSEDED (2026-09-26): the /rest/v1/ and /graphql/v1 blocks below proxy to 127.0.0.1:8809
# (rg-postgrest), a service docs/PLAN.md's decision ledger (2026-09-23) records as "removed (no
# consumer)" — no systemd/rg-postgrest.service file exists in this repo. Do not install this file:
# those two locations would 502. /realtime/v1/ and /storage/v1/ below still match the live routing
# (rg-api:8800), but rg-production.conf implements them inline and never includes this .inc.
# See docs/PORTS-AND-DOMAINS.md.
# ══════════════════════════════════════════════════════════
# Compatibilité Supabase self-host — à inclure dans un vhost
# ══════════════════════════════════════════════════════════
#
# Expose sur le domaine hôte les deux surfaces que `@supabase/supabase-js`
# attend, servies par nos propres services :
#   /rest/v1/     → rg-postgrest.service  (PostgREST 12.2 sur la base rg locale)
#   /storage/v1/  → rg-storage.service    (Bun, fichiers sur /var/www/rg-storage)
#
# Inclure ce fichier dans le vhost de chaque app permet de pointer
# NEXT_PUBLIC_SUPABASE_URL sur l'origine de l'app elle-même : aucune requête
# cross-origin, et les URLs absolues déjà enregistrées en base
# (https://azalee.rosegriffon.fr/storage/v1/object/public/…) restent valables.
#
# Usage :
#   include /etc/nginx/conf.d/supabase-compat.inc;

location /rest/v1/ {
    # RETIRED (2026-09-23, docs/PLAN.md): rg-postgrest had no consumer and no systemd unit remains.
    # Kept only as historical reference for the location shape; never install unless rg-postgrest
    # is redeployed and re-added to config/service-catalog.json.
    proxy_pass http://127.0.0.1:8809/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 3s;
    proxy_read_timeout 60s;

    # PostgREST n'émet pas d'en-têtes CORS : on les pose ici pour les clients
    # navigateur d'une autre origine (le website interroge parfois azalee).
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin  "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS" always;
        add_header Access-Control-Allow-Headers "authorization, apikey, content-type, prefer, range, x-client-info, accept-profile, content-profile" always;
        add_header Access-Control-Max-Age       "86400" always;
        add_header Content-Length 0;
        return 204;
    }
    add_header Access-Control-Allow-Origin   "*" always;
    add_header Access-Control-Expose-Headers "content-range, content-location, range-unit" always;
}

# API GraphQL auto-générée par pg_graphql, exposée comme chez Supabase :
# PostgREST publie `graphql_public.graphql()` en RPC, on la présente sous
# /graphql/v1 avec le profil de schéma qui va bien.
location = /graphql/v1 {
    # RETIRED (2026-09-23, docs/PLAN.md): same rg-postgrest dependency as /rest/v1/ above.
    proxy_pass http://127.0.0.1:8809/rpc/graphql;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_set_header Accept-Profile  graphql_public;
    proxy_set_header Content-Profile graphql_public;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 3s;
    proxy_read_timeout 60s;

    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin  "*" always;
        add_header Access-Control-Allow-Methods "POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "authorization, apikey, content-type, x-client-info" always;
        add_header Content-Length 0;
        return 204;
    }
    add_header Access-Control-Allow-Origin "*" always;
}

location /realtime/v1/ {
    proxy_pass http://127.0.0.1:8800/realtime/v1/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    # Flux SSE : jamais de tampon, jamais de coupure sur inactivité.
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    add_header X-Accel-Buffering no;
}

# Compatibilité d'une couverture d'article publiée avant la migration Storage.
# L'objet source n'existe ni dans le bucket local `article`, ni dans les
# sauvegardes disponibles. L'article pointe désormais vers l'asset du jeu qui
# servait de couverture ; garder cette redirection exacte évite que les pages
# et caches sociaux antérieurs à la migration continuent de recevoir une 404.
location = /storage/v1/object/public/article/71308511-4a51-4e8b-9f50-57e8c547a951.webp {
    return 301 https://cdn.rosegriffon.fr/dx11/menu/220_img/gallery_img2/img_story_ev02_main_0020.png$is_args$args;
}

location /storage/v1/ {
    proxy_pass http://127.0.0.1:8800/storage/v1/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 3s;
    proxy_read_timeout 300s;
    # Les uploads d'images passent par ici (avatars, médias d'article).
    client_max_body_size 512m;
    proxy_request_buffering off;
}
