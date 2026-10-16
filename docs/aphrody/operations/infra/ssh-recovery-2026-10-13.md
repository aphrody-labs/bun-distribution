<!-- SPDX-License-Identifier: Apache-2.0 -->
# Accès SSH persistant du poste Windows

Observation du 2026-10-13 : les alias `vps` et `dbfr` utilisent les adresses
privées `10.200.77.1` et `10.200.77.3`. Sans interface Windows `aphrody`, les
deux accès MCP expirent. Les serveurs publics répondent, mais refusent cette
clé hors du réseau privé. La tâche Mesh est désactivée et le tunnel natif
précédent dépendait de la durée de vie de son processus.

Le service officiel `WireGuardTunnel$aphrody` est maintenant installé depuis
la configuration du magasin protégé du propriétaire. Son démarrage est
Automatic, sous LocalSystem, avec reprise après 5 s, 5 s puis 60 s et remise
à zéro du compteur après 24 h. Le tunnel reste limité à `10.200.77.0/24`.
La clé existante reste locale, sans régénération ni publication. La tâche Mesh
et ses autres applications restent dans leur état précédent.

L'adapter [restore-ssh-tunnel.ps1](../../../../scripts/aphrody/tools/infra/restore-ssh-tunnel.ps1)
affiche un plan par défaut. `-Apply`, avec élévation Windows, installe le
service absent et converge son démarrage et sa reprise. Il conserve la
configuration protégée et refuse un autre réseau ou une autre adresse locale.
Le [catalogue Infra](../../../../tools/aphrody/config/service-catalog.json) déclare le
service ; voir la [procédure boot](BOOT.md).

Validation : analyse syntaxique PowerShell et JSON, plan avant application,
service Running/Automatic, `sc qfailure`, audit boot ciblé sans dérive,
connexions MCP et OpenSSH vers les deux serveurs. Après redémarrage contrôlé
du service Windows, de nouvelles connexions MCP et OpenSSH réussissent.
Le second plan reconnaît le service installé.

Sur les deux serveurs, `ssh.socket` et `wg-quick@wg1` sont enabled/active.
`ssh.service` est activé par son socket, avec `Restart=on-failure` ; son état
disabled ne constitue donc pas une panne de démarrage. `sshd -t` réussit et
l'authentification par mot de passe reste désactivée. Aucune modification
serveur n'a été nécessaire.

Limite : aucun redémarrage complet du poste ni des serveurs n'a été effectué.
La persistance est qualifiée par les paramètres SCM/systemd et le redémarrage
du tunnel. L'audit boot utilise le binaire Windows natif déjà installé
`aphrody-native-21ff48ba62` : le binaire CLI actuellement sur PATH tente un
adapter Linux pour cet audit local et échoue avec `program not found`.
