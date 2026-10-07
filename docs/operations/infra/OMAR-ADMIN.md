<!-- SPDX-License-Identifier: Apache-2.0 -->
# Administration Aphrody — Omar

Directive propriétaire du 7 octobre 2026 : donner à Omar les droits administrateur
sur les surfaces Aphrody, en conservant les authentifications du propriétaire.

La déclaration [omar-admin.json](../../../config/host/omar-admin.json) distingue
l'identité vérifiée et les droits souhaités de leur activation réelle. Le compte
Discord principal est `1323725494184841256` (`trape17_10161`, Omar le Prime),
confirmé par l'API Discord et le DM livré `1557349160041324594`. L'ancien compte
`1527405876695142620` (`omlar_`) est également documenté comme compte d'Omar dans
le plan Shenron ; il n'a actuellement aucun serveur commun avec les bots disponibles.

## État vérifié

| Surface | État du 7 octobre 2026 | Limite |
| --- | --- | --- |
| VPS / DBFR | Compte Unix `omar`, `sudo -n id -u` = `0` sur les deux hôtes | Accès complet déjà actif ; clés privées conservées |
| SSH / WireGuard | Droits déclarés et appliqués dans le [tunnel privé](PRIVATE-TUNNEL.md) | La connexion depuis le PC d'Omar reste à qualifier |
| Discord Aphrody | Rôle `Aphrody Administrator`, ID `1557350369254703104`, permission administrateur `8`, créé puis relu | Aucun des deux comptes d'Omar n'est membre du serveur `1554189180030947338` ; rôle non attribué |
| GitHub `aphrody-labs` | Attribution autorisée, identité attendue | Ne pas supposer que `KyrioFox` est Omar ; aucun droit de ce compte n'a été changé |
| MCP HTTP / A2A / kernel privilégié VPS | Unités inactives ; aucune politique `/etc/aphrody/host-bridge/auth.json` | Ne pas annoncer un accès applicatif actif ni lancer les unités sans leur qualification |
| Kit et app desktop | Omar possède le flux administrateur via son fichier d'accès | Installation sur son PC non qualifiée par cette passe |

Une invitation Discord privée, à usage unique, valable sept jours, a été envoyée
à Omar en DM via le bot Shenron (message `1557350536251052033`). Elle reste dans
le store protégé VPS `/home/ubuntu/.aphrody/private/omar-discord-invite.json` ;
son URL ne figure ni dans Git ni dans les rapports.

## Réconciliation

Le [script Infra](../../../scripts/tools/omar-admin-access.py) lit la déclaration
et appelle le CLI natif `aphrody infra ssh`. Les identifiants du bot restent dans
`/etc/aphrody-discord.env` sur VPS. Sans option, il observe seulement. Avec
`--apply`, il crée ou complète le rôle, puis l'attribue aux comptes vérifiés
qui sont membres du serveur. Une seconde exécution relit les droits. Un rôle
homonyme ambigu ou géré par une intégration bloque la mutation. Aucun autre rôle
ou propriétaire n'est modifié.

```sh
python3 scripts/tools/omar-admin-access.py
python3 scripts/tools/omar-admin-access.py --apply
```

GitHub n'est pas modifié par ce script. Une fois le login confirmé, utiliser
`aphrody git api` pour la mutation autorisée de l'organisation et vérifier le
rôle retourné ainsi que l'état actif ou en attente d'acceptation.

## Suivi borné

- [x] Vérifier les comptes Unix et les droits sudo VPS/DBFR.
- [x] Déclarer les identités vérifiées et créer le rôle administrateur Discord.
- [x] Envoyer l'invitation privée au compte principal d'Omar.
- [ ] Réexécuter `--apply` après son arrivée sur le serveur Discord.
- [ ] Confirmer son compte GitHub et appliquer/vérifier les droits correspondants.
- [ ] Qualifier les services privés avant d'annoncer leur activation.

Validation : plan en lecture seule, application puis relecture du rôle Discord,
Ruff check/format et contrôle des liens locaux/whitespace. Aucun build moteur.
