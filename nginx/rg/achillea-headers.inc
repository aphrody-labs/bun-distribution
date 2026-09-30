# En-têtes de sécurité communs aux domaines achillea.
#
# POURQUOI UN FICHIER PLUTÔT QUE DES LIGNES RECOPIÉES
# `add_header` posé dans un `location` REMPLACE ceux hérités du `server` — nginx
# n'accumule pas. Chaque bloc qui pose un seul en-tête perd donc tous les autres,
# ce qui obligeait à recopier les cinq lignes à l'identique dans trois endroits :
# la première divergence passait inaperçue. Un include par bloc rend l'oubli
# impossible et la dérive visible en un seul diff.
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;
add_header X-DNS-Prefetch-Control "on" always;
