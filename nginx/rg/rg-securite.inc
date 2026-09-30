# En-têtes de sécurité des domaines Rose Griffon dont l'application n'en pose aucun.
#
# POURQUOI UN FICHIER PLUTÔT QUE DES LIGNES RECOPIÉES
# `add_header` posé dans un `location` REMPLACE ceux hérités du `server`, et un
# `add_header` dans un `server` remplace ceux du `http` : nginx n'accumule jamais d'un
# niveau à l'autre. Un bloc qui pose une seule ligne de cache perd donc, en silence,
# tous les en-têtes de sécurité du niveau au-dessus. L'include rend l'oubli impossible.
#
# POUR QUI
# `rosegriffon.fr` : l'audit du 14/8/2026 l'a trouvé sans HSTS, sans CSP et sans
# Permissions-Policy, avec un Referrer-Policy faible — son backend Next n'émet aucun
# en-tête, seul le bloc `http` de nginx.conf s'appliquait.
# `azalee.rosegriffon.fr` : à ne PAS inclure au niveau `server`, l'application y émet
# déjà les cinq en-têtes ; l'include n'y sert que dans les `location` servis par nginx
# lui-même (statiques, page de maintenance), où aucun backend ne répond.
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
