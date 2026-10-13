<!-- SPDX-License-Identifier: Apache-2.0 -->
# SSH direct persistant vers Omar

Le 2026-10-13, `omar-rt` atteignait le PC Windows d'Omar par le relais
`vps:127.0.0.1:22010`, mais `omar` et `omar-pc` étaient refusés. Le tunnel
`10.200.77.10` était actif ; sshd n'écoutait que sur `127.0.0.1`. Sa
configuration demandait pourtant l'écoute sur l'adresse WireGuard : cette
adresse peut être absente lorsque Windows démarre sshd.

L'adapter [restore-omar-ssh.ps1](../../../scripts/tools/infra/restore-omar-ssh.ps1)
affiche un plan par défaut, refuse une machine sans l'adresse d'Omar et
valide les règles attendues. Avec `-Apply` administrateur, il valide d'abord
la configuration candidate avec `sshd -t`, conserve l'authentification et les
sections Match, puis utilise `ListenAddress 0.0.0.0`. Cette écoute reste
valide avant l'arrivée de WireGuard et après son redémarrage.

Avant ce changement d'écoute, le pare-feu limite l'accès SSH entrant à
l'adresse locale `10.200.77.10` : la règle OpenSSH vise le propriétaire
`10.200.77.4`, et une règle SSH distincte conserve les sources du mesh
`10.200.77.0/24`. Le port 22 est retiré de l'ancienne règle multi-port
`Omar-Server-Mesh` ; ses ports 80, 445, 5900 et 8795 conservent leurs filtres.
Le relais local reste utilisable. Le service sshd est Automatic avec reprise
après 10 s, 30 s puis 60 s et remise à zéro après 24 h.

Validation sur le PC réel : plan, configuration `sshd -t`, service et filtres
du pare-feu relus, connexions `omar`, `omar-pc` et `omar-rt` comme `omara`.
Après redémarrage de la tâche native `Aphrody WG omar`, les deux accès directs
réussissent de nouveau. Le relais est brièvement interrompu par ce test puis
son port 22010 réapparaît automatiquement. La tâche native WireGuard et la
tâche `Aphrody Omar tunnel` restent actives ; aucun autre service n'est activé.
Le script est installé sous le home protégé d'Omar pour reproduction.

Limite : aucun reboot complet du PC d'Omar. La persistance repose sur les
services/tâches relus et le redémarrage contrôlé du tunnel. Le relais a servi
au diagnostic initial ; il ne remplace pas la validation directe.
