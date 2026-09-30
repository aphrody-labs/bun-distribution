# ══════════════════════════════════════════════════════════
# Sous-domaine d'infrastructure — ni indexé, ni bruyant
# ══════════════════════════════════════════════════════════
#
# À inclure dans les vhosts qui exposent une API ou une interface
# d'exploitation (supabase, db, storage, realtime, studio, mcp, api). Ces hôtes
# n'ont aucun contenu à référencer : sans `robots.txt`, un robot considère que
# tout est autorisé et parcourt l'API — c'était 56 requêtes en 404 par jour,
# purement gaspillées.
#
# `favicon.ico` renvoie 204 plutôt que 404 : les navigateurs le demandent
# systématiquement, inventer une icône n'aurait aucun sens sur une API.
#
# Placé AVANT toute `auth_basic` du vhost, et avec `auth_basic off` : un robot
# doit pouvoir lire l'interdiction sans authentification, sinon il reçoit 401 et
# ne sait pas qu'il doit partir.
#
# Usage :
#   include /etc/nginx/conf.d/no-index.inc;

location = /robots.txt {
    auth_basic off;
    access_log off;
    default_type text/plain;
    return 200 "User-agent: *\nDisallow: /\n";
}

location = /favicon.ico {
    auth_basic off;
    access_log off;
    return 204;
}
