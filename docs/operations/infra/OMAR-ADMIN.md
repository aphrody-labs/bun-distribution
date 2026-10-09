<!-- SPDX-License-Identifier: Apache-2.0 -->
# Administration DBFR — Omar

Correction propriétaire du 2026-10-09 : **Omar administre DBFR**.
**Yoyo / aphrody-dev administre tout Aphrody Labs**. Un accès SSH technique
ne définit pas une autorité sur une organisation, un autre domaine ou ses données.

La [déclaration Infra](../../../tools/config/host/omar-admin.json) est corrigée.
Les anciens grants actifs n'ont pas été révoqués ou modifiés par ce lot.
La réconciliation globale Discord et son installation avec --apply sont bloquées
faute de mapping vérifié vers le serveur DBFR ; le service déclaré observe seulement.
Ne pas appliquer une permission administrateur DBFR au serveur Aphrody Labs.

Les scripts [observation](../../../scripts/tools/omar-admin-access.py) et
[installation](../../../scripts/tools/install-omar-admin.py) utilisent le CLI
natif du contexte. Les authentifications restent dans leurs stores protégés.

## Observations historiques — 2026-10-07

Ces résultats datés décrivent des accès, pas l'autorité actuelle.

| Surface | État du 7 octobre 2026 | Limite |
| --- | --- | --- |
| VPS / DBFR | Compte Unix `omar`, `sudo -n id -u` = `0` sur les deux hôtes | Accès complet déjà actif ; clés privées conservées |
| SSH / WireGuard | Droits déclarés et appliqués dans le [tunnel privé](PRIVATE-TUNNEL.md) | La connexion depuis le PC d'Omar reste à qualifier |
| Discord Aphrody | Rôle `Aphrody Administrator`, ID `1557350369254703104`, permission administrateur `8`, créé puis relu | Aucun des deux comptes d'Omar n'est membre du serveur `1554189180030947338` ; rôle non attribué |
| GitHub `aphrody-labs` | Attribution autorisée, identité attendue | Ne pas supposer que `KyrioFox` est Omar ; aucun droit de ce compte n'a été changé |
| MCP HTTP / A2A / kernel privilégié VPS | Unités inactives ; aucune politique `/etc/aphrody/host-bridge/auth.json` | Ne pas annoncer un accès applicatif actif ni lancer les unités sans leur qualification |
| Kit et app desktop | Omar possède le flux administrateur via son fichier d'accès | Installation sur son PC non qualifiée par cette passe |


La confirmation GitHub de KyrioFox date du 2026-10-08 ; aucune attribution
administrateur GitHub n'est autorisée par cette politique DBFR.
