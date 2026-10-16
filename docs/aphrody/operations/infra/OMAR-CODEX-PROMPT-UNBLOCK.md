<!-- SPDX-License-Identifier: Apache-2.0 -->
# Prompt Codex d'Omar : déblocage SSH, VNC, tunnels et conteneur (2026-10-09)

Suite de [OMAR-CODEX-PROMPT.md](OMAR-CODEX-PROMPT.md) et de [OMAR-CODEX-PROMPT-CONTAINER.md](OMAR-CODEX-PROMPT-CONTAINER.md),
dans le cadre de l'accord n°2 signé par Omar le 2026-10-09T13:29Z. Constat du 2026-10-09 15:50 : le PC d'Omar est
dans le maillage (wg1 10.200.77.10, ports 22, 2222, 5900, 8795 ouverts), mais le propriétaire ne peut ni s'y
connecter en SSH (nom d'utilisateur Windows inconnu, clé non autorisée) ni ouvrir son VNC (RFB « early eof »).
À coller en un seul message dans Codex lancé en PowerShell 7 natif Windows (pas WSL), terminal administrateur :
`codex --sandbox danger-full-access --ask-for-approval never`.

```text
MISSION (Codex, PC Windows d'Omar, PowerShell 7 natif ADMINISTRATEUR, pas WSL).
Débloque l'accès du propriétaire à ce PC : SSH par clé, VNC, tunnels A2A/MCP, conteneur Aphrody, tout persistant au boot. Exécute les étapes 1 à 7 toi-même, de bout en bout, sans demander de confirmation ; ne t'arrête que sur un vrai blocage, en disant lequel. Les étapes déjà faites ne sont pas des erreurs : vérifie et continue. Termine par le rapport (étape 8).

PORTÉE (accord n°2) : composants Aphrody, conteneur, tâches \Aphrody\*, WireGuard wg1, OpenSSH, bureau/VNC/MCP Aphrody, outils de build. Hors portée : documents, comptes, mots de passe et sessions personnels d'Omar ; désactiver ses protections ; installer autre chose. Omar révoque quand il veut.

RÈGLES (absolues)
- Ne lis, n'affiche, ne journalise, ne copie jamais une clé privée, un jeton ou un mot de passe (*.key, *.token, *.env, id_ed25519 sans .pub). Rien de secret dans Discord, un commit, un journal ou le rapport.
- Ne réactive ni Defender ni le pare-feu. Commits éventuels : identité git d'Omar, branche omar/<sujet>, jamais main.
- Sauvegarde chaque fichier de configuration avant de le modifier (copie .before-<horodatage>), valide avant de redémarrer (sshd -t), et ne coupe jamais ta propre session.

FAITS
- wg1 : hub 10.200.77.1, Omar 10.200.77.10 (ce PC), propriétaire 10.200.77.4, dbfr 10.200.77.3.
- Le hub (vps 51.77.147.152) accepte déjà ta clé SSH pour l'utilisateur omar : ne la change pas.
- Le propriétaire se connecte à ce PC avec cette clé publique (ssh-ed25519 ... aphrody-owner-pc) et le vps avec la clé aphrody-vps-to-omar-pc :
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM9fIsjABVye9MqLRBc2ddz2hKJdxNPQm22uzcDKrnkw aphrody-owner-pc
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICXbajabKOH0cOxwgHWtA3Y4cdT/ZTQcck4c3stty709 aphrody-vps-to-omar-pc
  (clés PUBLIQUES, aucun secret)
- Variables : $AH = "$env:USERPROFILE\.aphrody" ; $P = "$AH\private" ; $Bin = "$env:LOCALAPPDATA\Aphrody\bin" ; $Repo = "C:\src\aphrody"

1) IDENTITÉ ET DIAGNOSTIC (sans secret)
$env:USERNAME ; whoami /groups | Select-String 'Administrateurs|Administrators' ; $PSVersionTable.PSVersion ; (Get-NetAdapter | ? Name -match 'wg|aphro|WireGuard' | ft Name,Status | Out-String)
Get-Service sshd,ssh-agent | ft Name,Status,StartType ; Get-NetTCPConnection -State Listen -LocalPort 22,2222,5900,8795,8999,8788,8793 -EA SilentlyContinue | select LocalAddress,LocalPort,OwningProcess
Get-ScheduledTask -TaskPath '\Aphrody\' | Get-ScheduledTaskInfo | ft TaskName,LastTaskResult,LastRunTime
Mets de côté ces sorties pour le rapport (le nom d'utilisateur Windows est attendu par le propriétaire).

2) SSH PAR CLÉ POUR LE PROPRIÉTAIRE (OpenSSH Windows)
a. Service : Set-Service sshd -StartupType Automatic ; Start-Service sshd ; Set-Service ssh-agent -StartupType Automatic.
b. Configuration : C:\ProgramData\ssh\sshd_config (sauvegarde d'abord). Directives GLOBALES (avant tout bloc Match) : PubkeyAuthentication yes ; PasswordAuthentication no ; KbdInteractiveAuthentication no ; PermitEmptyPasswords no ; MaxAuthTries 3 ; AllowTcpForwarding yes ; ListenAddress 10.200.77.10 (adresse wg1 de ce PC) ; ne garde pas de directive globale après `Match Group administrators` (elle ne s'appliquerait qu'aux administrateurs). Si tu poses AllowUsers, inclus ton nom d'utilisateur Windows (étape 1) et pas d'autre restriction qui exclut le propriétaire. Valide : & "$env:WINDIR\System32\OpenSSH\sshd.exe" -t ; si erreur, restaure la sauvegarde.
c. Clés autorisées : si ton compte est administrateur, le fichier est C:\ProgramData\ssh\administrators_authorized_keys (sinon $env:USERPROFILE\.ssh\authorized_keys). Ajoute les deux clés publiques des FAITS (sans doublon, une par ligne, LF, sans BOM). Droits du fichier administrateur : icacls "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "BUILTIN\Administrators:F" /grant "NT AUTHORITY\SYSTEM:F". Pour authorized_keys d'un utilisateur : icacls <fichier> /inheritance:r /grant "${env:USERNAME}:F" /grant "NT AUTHORITY\SYSTEM:F".
d. Redémarre sshd (Restart-Service sshd) puis vérifie : Get-NetTCPConnection -State Listen -LocalPort 22 ; Get-WinEvent -LogName 'OpenSSH/Operational' -MaxEvents 5 | % Message.
e. Port 2222 (WSL) : ne change rien, il est au propriétaire de l'infra WSL ; note seulement s'il écoute.

3) VNC / BUREAU DISTANT (aphrody infra remote serve)
Le propriétaire reçoit « RFB handshake failed : early eof » : le serveur ferme la connexion, typiquement car son adresse (10.200.77.4) ou celle du hub (10.200.77.1) n'est pas admise.
a. Lis les arguments réels de la tâche : (Get-ScheduledTask -TaskPath '\Aphrody\' | ? TaskName -match 'Remote|Desktop|Bureau' | % { $_.TaskName ; $_.Actions | % { $_.Execute ; $_.Arguments } }) et `aphrody infra remote serve --help`.
b. Le serveur doit : écouter sur 10.200.77.10 (--bind 10.200.77.10:8795, VNC 10.200.77.10:5900) et admettre le propriétaire et le hub : --vnc-allow 10.200.77.4 --vnc-allow 10.200.77.1 (si l'option n'accepte pas plusieurs occurrences, utilise la liste ou le CIDR documenté par --help ; jamais `any`). Le jeton remote.token reste dans $P, ne l'affiche pas.
c. Modifie la tâche (action `conhost.exe --headless "<programme>" <arguments>`, principal Interactive (toi), Settings.Hidden, comme `aphrody infra boot` (docs/operations/infra/BOOT.md) ; ouverture de session, relance 1 min), redémarre-la, puis vérifie localement : Test-NetConnection 10.200.77.10 -Port 5900. Si un mot de passe VNC est exigé, génère-le localement et mets-le dans $P\vnc.password (ACL toi + SYSTEM) ; le propriétaire te le fera relayer hors bande, ne le publie jamais.
d. Rappelle-toi : un bureau n'est capturable que dans une session ouverte (tâche interactive) ; si l'écran est verrouillé, dis-le dans le rapport.

4) MISE À JOUR APHRODY, FORK BUN, CONTENEUR (étapes 1 à 4 de OMAR-CODEX-PROMPT-CONTAINER.md)
Exécute-les si elles ne sont pas déjà faites : fork Bun (bun --version, attendu 1.4.3-aphrody.3 ou plus), Aphrody (irm https://downloads.aphrody.com/install.ps1 | iex), Docker Desktop, image aphrody:runtime, tâche \Aphrody\Container (APHRODY_PC=omar puis `aphrody infra boot apply --host local --entry Container` depuis $Repo). Contrôle : docker ps ; Invoke-RestMethod http://127.0.0.1:8999/healthz.

5) A2A LOCAL ET TUNNELS VERS LE HUB (étapes 5 et 6 de OMAR-CODEX-PROMPT-CONTAINER.md)
Tâche « Aphrody A2A omar » (127.0.0.1:8788) et tâche « Aphrody Omar tunnel » (ssh -N vers omar@10.200.77.1 par wg1, repli omar@51.77.147.152) avec -R 28788 (A2A), 28999 (conteneur), 28793 (MCP HTTP), 28795, 25900, 22010, 22011 et -L 24888→23888, 24889→23889, clé ~/.ssh/id_ed25519. Les jetons du hub (hub-a2a.token, hub-mcp.token) te seront remis hors bande : si absents, note-le et continue.

6) PERSISTANCE AU BOOT
Toutes les tâches \Aphrody\ (Container, A2A omar, Omar tunnel, Remote Desktop, MCP HTTP, WireGuard) : ouverture de session + relance chaque minute en cas d'échec, durée illimitée. sshd et WireGuardTunnel$... en démarrage Automatique avec reprise après échec (sc.exe failure sshd reset= 86400 actions= restart/10000/restart/30000/restart/60000). Ne redémarre pas le PC sans qu'Omar le demande ; dis dans le rapport quelles tâches attendent l'ouverture de session.

7) VÉRIFICATION DEPUIS CE PC (sans secret)
ssh -o BatchMode=yes omar@10.200.77.1 "curl -s -m 5 http://127.0.0.1:28788/ping; curl -s -m 5 http://127.0.0.1:28999/healthz"
Get-NetTCPConnection -State Listen -LocalPort 22,5900,8795,8999,8788,8793,24888,24889 | select LocalAddress,LocalPort
Get-ScheduledTask -TaskPath '\Aphrody\' | Get-ScheduledTaskInfo | ft TaskName,LastTaskResult,LastRunTime

8) RAPPORT FINAL (Omar le poste en DM au propriétaire ou dans #admin-console ; AUCUN secret)
- Nom d'utilisateur Windows ($env:USERNAME), appartenance au groupe administrateurs, version PowerShell.
- sshd : état, ListenAddress, fichier authorized_keys utilisé, résultat de sshd -t.
- VNC : arguments finaux de la tâche (sans jeton), port 5900 en écoute, mot de passe exigé oui/non (jamais sa valeur).
- bun --version ; aphrody --version ; docker --version ; état du conteneur aphrody-pc ; état des tâches \Aphrody\ ; ports en écoute.
- Clé publique ~/.ssh/id_ed25519.pub si absente du hub ; jetons du hub reçus oui/non.
- Ce qui a échoué, pourquoi, ce qui reste à faire côté Omar ou côté propriétaire.

ROLLBACK (seulement si demandé)
Restaure les fichiers *.before-<horodatage> (sshd_config, administrators_authorized_keys), puis Restart-Service sshd ; Unregister-ScheduledTask -TaskPath '\Aphrody\' -TaskName 'Aphrody A2A omar','Aphrody Omar tunnel' -Confirm:$false.
```
