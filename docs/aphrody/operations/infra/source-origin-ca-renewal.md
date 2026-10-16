<!-- SPDX-License-Identifier: Apache-2.0 -->

# Certificat Origin CA de Gitea

Depuis le 14 octobre 2026, seul le vhost `git.aphrody.app` utilise ce
certificat Cloudflare Origin CA. `source.aphrody.app` utilise le certificat
Let's Encrypt `/etc/letsencrypt/live/source.aphrody.app/`, renouvelé par le
timer Certbot existant et son hook Nginx ; voir
[l'authentification du tunnel](source-tunnel-auth.md).
La clé privée Origin CA reste sur le VPS dans le store
protégé `/home/ubuntu/.aphrody/secrets/tls/source-origin/`.

## Inspection

[L'inspecteur](../../../../scripts/aphrody/tools/infra/source-origin-ca-inspect.sh) lit le
certificat public installé et renvoie un objet JSON stable : état, durée
restante, dates et couverture des deux noms. `healthy` signifie que le
certificat est valide et qu'il reste plus de 30 jours ; `renewal_due` signifie
qu'il reste au plus 30 jours ; `expired`, `invalid` et `unavailable` nécessitent
une intervention.
Le script ne lit ni n'affiche la clé privée et ne contacte pas Cloudflare.

L'orchestration est le heartbeat Codex récurrent `tls-forge-aphrody`. Il inspecte
l'état réel sur le VPS et, lorsque le renouvellement est dû, garde la génération
de clé/CSR et l'installation chez Infra et fait signer le CSR par Cloudflare
MCP. Il n'existe pas de timer VPS prétendant renouveler seul : une mutation
Cloudflare depuis un service VPS contournerait le propriétaire MCP. Le heartbeat
doit vérifier le résultat installé et la configuration Nginx avant de conclure.

Cloudflare indique qu'Origin CA n'envoie pas d'avis d'expiration ; la date doit
donc être suivie par cet inspecteur. Le certificat Origin CA chiffre le lien
Cloudflare-vers-origine, pas les connexions directes des navigateurs.

## Vérification manuelle

Après installation du script par Infra :

```sh
aphrody infra ssh exec --host vps -- /usr/local/libexec/aphrody/source-origin-ca-inspect.sh
```

Codes de sortie : `0` sain, `1` renouvellement dû, `2` certificat invalide ou
inspection impossible. Aucun résultat de ce script ne prouve à lui seul que le
certificat est servi par Nginx ; vérifier ensuite la configuration et le TLS
avec SNI pour chaque nom et son propriétaire de certificat actuel.
