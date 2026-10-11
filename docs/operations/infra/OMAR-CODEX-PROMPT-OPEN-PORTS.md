<!-- SPDX-License-Identifier: Apache-2.0 -->
# Prompt Codex d'Omar : ports ouverts sur le maillage wg1 (2026-10-09)

Complète [OMAR-CODEX-PROMPT-UNBLOCK.md](OMAR-CODEX-PROMPT-UNBLOCK.md). Décision du propriétaire du 2026-10-09 : tous les ports sont ouverts
entre les membres du maillage wg1 (vps, dbfr, PC propriétaire, PC d'Omar et son WSL) et Docker, sans rien ouvrir à Internet
([PRIVATE-TUNNEL.md](PRIVATE-TUNNEL.md)). À coller dans Codex lancé en PowerShell 7 natif Windows administrateur (pas WSL) :
`codex --sandbox danger-full-access --ask-for-approval never`.

```text
MISSION (Codex, PC Windows d'Omar, PowerShell 7 natif ADMINISTRATEUR, pas WSL).
Ouvre tous les ports de ce PC (Windows, WSL, Docker) aux membres du maillage WireGuard wg1 (10.200.77.0/24) et à eux seuls, jamais à Internet. Exécute les étapes 1 à 5 toi-même, sans demander de confirmation ; ne t'arrête que sur un vrai blocage. Les étapes déjà faites ne sont pas des erreurs.

PORTÉE (accord n°2 signé par Omar) : WireGuard wg1, pare-feu pour le sous-réseau wg1, OpenSSH, bureau/VNC Aphrody, conteneur Aphrody, WSL et Docker de Aphrody. Hors portée : documents, comptes, mots de passe et sessions personnels d'Omar ; désactiver ou réactiver ses protections (Defender, profils du pare-feu : ne change pas leur état) ; ouvrir quoi que ce soit à une adresse hors 10.200.77.0/24. Omar révoque quand il veut.

RÈGLES : aucun secret dans les sorties ni le rapport ; sauvegarde avant de modifier un fichier de configuration (.before-<horodatage>) ; ne coupe pas ta propre session ; ne redémarre pas le PC ni WSL sans que Omar le demande.

1) ÉTAT (lecture seule)
Get-NetFirewallProfile | ft Name,Enabled ; Get-NetFirewallRule -Group Aphrody -EA SilentlyContinue | ft DisplayName,Direction,Action,Enabled
Get-NetAdapter | ? Name -match 'wg|aphro|WireGuard' | ft Name,Status ; wsl -l -v ; docker version --format '{{.Server.Version}}'

2) WINDOWS : RÈGLES POUR LE MAILLAGE (n'altère pas l'état des profils)
Remove-NetFirewallRule -DisplayName 'Aphrody wg1 mesh (tous ports)','Aphrody wg1 mesh (tous ports) sortant' -EA SilentlyContinue
New-NetFirewallRule -DisplayName 'Aphrody wg1 mesh (tous ports)' -Direction Inbound -Action Allow -Protocol Any -RemoteAddress 10.200.77.0/24 -Profile Any -Group Aphrody
New-NetFirewallRule -DisplayName 'Aphrody wg1 mesh (tous ports) sortant' -Direction Outbound -Action Allow -Protocol Any -RemoteAddress 10.200.77.0/24 -Profile Any -Group Aphrody
Les services (sshd, VNC/remote serve, MCP, A2A, conteneur) doivent écouter sur 10.200.77.10 (ou loopback + tunnels), pas sur 0.0.0.0 si ce n'est pas nécessaire : n'ouvre rien d'autre qu'une écoute sur l'adresse wg1.

3) WSL : PORTS ACCESSIBLES SUR 10.200.77.10
Lis C:\Users\<toi>\.wslconfig (sauvegarde). Pour que tous les ports de WSL soient joignables sur l'adresse du PC, active le réseau en miroir : [wsl2] networkingMode=mirrored (et firewall=false dans [wsl2] seulement si le pare-feu Hyper-V bloque ; vérifie avec Get-NetFirewallHyperVVMSetting). Ne lance PAS `wsl --shutdown` : écris la configuration et note dans le rapport qu'elle s'applique au prochain redémarrage de WSL. D'ici là le port 2222 (SSH WSL) reste joignable tel quel ; ne casse pas ce qui marche.

4) DOCKER
Les ports publiés par les conteneurs Aphrody doivent l'être sur 10.200.77.10 ou 0.0.0.0 (jamais d'API Docker TCP sans TLS en dehors de loopback). Vérifie : docker ps --format '{{.Names}} {{.Ports}}'. Le conteneur aphrody-pc reste en loopback + tunnels ; ne le change pas. Autorise le trafic des réseaux Docker vers wg1 s'il est bloqué par une règle (Get-NetFirewallRule -Direction Outbound -Action Block).

5) VÉRIFICATION ET RAPPORT (AUCUN secret ; Omar le poste en DM au propriétaire)
Get-NetFirewallRule -Group Aphrody | ft DisplayName,Direction,Action,Enabled ; Get-NetFirewallProfile | ft Name,Enabled ; Get-NetTCPConnection -State Listen | ? LocalAddress -in '0.0.0.0','10.200.77.10' | select LocalAddress,LocalPort -Unique | sort LocalPort
Dans le rapport : règles créées, état des profils du pare-feu (inchangé), ports en écoute sur 10.200.77.10, état de .wslconfig (miroir appliqué au prochain redémarrage de WSL), ports Docker publiés, ce qui a échoué.

ROLLBACK (seulement si demandé) : Remove-NetFirewallRule -Group Aphrody ; restaurer .wslconfig.before-<horodatage>.
```
