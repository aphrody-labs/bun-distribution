# SPDX-License-Identifier: Apache-2.0
#
# The shared asset CDN of the Aphrody category repositories on `cdn.aphrody.com`.
#
# `cdn.aphrody.com` is the single CDN origin of the Aphrody repositories, not only the game
# assets. This file adds the shared namespaces next to the game contract of
# `aphrody-assets.inc` (`/dx11/`, `/model/`, `/model-full/`, `/model-chr/`), which is unchanged:
#
#   /s/<scope>/<path>   stable URL of a repository asset, scope from tools/config/asset-catalog.json
#                       (`os` = aphrody-ui/assets, `aphrody` = aphrody-ai/assets). Short cache:
#                       the content behind a stable URL can change with a new release.
#   /s/manifest.json    every served file: sha256, size, type, and its hashed URL
#   /h/<sha16>.<ext>    content-addressed copy, immutable for a year
#
# The release tree is built by `bun scripts/assets/cdn.ts build` and published under
# `/home/ubuntu/apps/cdn/releases/<id>` with an atomic `current` switch (`cdn.ts publish`).

location ^~ /h/ {
    alias /home/ubuntu/apps/cdn/current/h/;
    expires off;
    etag off;
    add_header Cache-Control               "public, immutable, max-age=31536000" always;
    add_header Access-Control-Allow-Origin "*"                                   always;
    add_header X-Content-Type-Options      "nosniff"                             always;
    add_header X-Robots-Tag                "noindex, nofollow"                   always;
    access_log off;
    try_files $uri =404;
}

location = /s/manifest.json {
    alias /home/ubuntu/apps/cdn/current/s/manifest.json;
    add_header Cache-Control               "public, max-age=60, must-revalidate" always;
    add_header Access-Control-Allow-Origin "*"                                   always;
    add_header X-Robots-Tag                "noindex, nofollow"                   always;
    default_type application/json;
}

location ^~ /s/ {
    alias /home/ubuntu/apps/cdn/current/s/;
    add_header Cache-Control               "public, max-age=3600, stale-while-revalidate=86400" always;
    add_header Access-Control-Allow-Origin "*"                                   always;
    add_header X-Content-Type-Options      "nosniff"                             always;
    add_header X-Robots-Tag                "noindex, nofollow"                   always;
    access_log off;
    try_files $uri =404;

    # `types {}` replaces the global table: only what the catalog serves.
    types {
        image/png                png;
        image/jpeg               jpg jpeg;
        image/webp               webp;
        image/avif               avif;
        image/gif                gif;
        image/svg+xml            svg;
        image/x-icon             ico;
        font/ttf                 ttf;
        font/otf                 otf;
        font/woff                woff;
        font/woff2               woff2;
        application/json         json;
        application/manifest+json webmanifest;
        text/css                 css;
        text/plain               txt md;
        video/mp4                mp4;
        video/webm               webm;
        model/gltf-binary        glb;
        application/octet-stream lnk bin;
    }
}
