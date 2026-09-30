# Journal d'audience unifié — à inclure dans les `server` qui déclarent DÉJÀ
# leur propre `access_log`.
#
# Un `access_log` posé dans un bloc `server` REMPLACE celui hérité du niveau
# `http` : sans cette ligne, api/cdn/mcp/studio/supabase disparaîtraient du
# journal commun. nginx accepte plusieurs `access_log` par bloc, les deux
# écritures coexistent donc — le journal historique par domaine reste alimenté.
#
# Le `log_format rg_stats` est défini une seule fois, dans
# `conf.d/00-rg-stats.conf` : le redéclarer ici ferait échouer `nginx -t`.
access_log /var/log/nginx/rg-stats.log rg_stats buffer=32k flush=5s;
