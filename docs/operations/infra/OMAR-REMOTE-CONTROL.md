<!-- SPDX-License-Identifier: Apache-2.0 -->

# Contrôle du PC Windows d'Omar depuis Aphrody (tunnel WireGuard privé)

État au 2026-10-08. Paquet de mise en place publié dans le salon admin Discord sécurisé. Aucun secret ici :
clés privées, jetons et identifiants restent sur leur machine ou dans leur magasin protégé et ne transitent
que hors bande. Inventaire : `tools/config/host/wireguard/aphrody-tunnel.json` ; tunnel :
[PRIVATE-TUNNEL.md](PRIVATE-TUNNEL.md).

## 1. Architecture

- Tunnel `aphrody-private` (`wg1` côté Linux, `aphrody` côté Windows), sous-réseau `10.200.77.0/24`, split tunnel.
- Hub `vps` `10.200.77.1`, endpoint `51.77.147.152:51821`, clé publique `McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=`.
- `omar` = `10.200.77.10`, clé publique déclarée `A42Sm27uwGBIkzPeTmK7yQxz24JDpM9h5jjeQyyjfzg=`.
- `aphro-pc` (propriétaire) = `10.200.77.4`. Le flux aphro-pc → omar transite par le hub (routage peer à peer, sans NAT).
- Services sur le PC d'Omar, joignables uniquement par le tunnel :
  - `8795/tcp` : bureau à distance complet `aphrody infra remote serve` (flux JPEG + souris/clavier, visionneuse
    navigateur `http://10.200.77.10:8795/#token=<jeton>`), jeton Bearer obligatoire.
  - `8793/tcp` : `aphrody-mcp http` (outils WinClean `computer_*` par action), Bearer `APHRODY_MCP_HTTP_TOKEN`.
    `aphrody-mcp http` refuse toute adresse non loopback : il écoute sur `127.0.0.1:8793` et un `netsh portproxy`
    le publie sur `10.200.77.10:8793`.

### Prérequis

1. **Release Windows** (ou build source, section 4) : `wg` et `remote` (commits `d03ded4cb`/`6c1f38f56`) ne sont pas dans la release publiée
   `20261007T094136Z-2072d221e312-wasm-0b7fccd7` (commit `5bf7eed5a`). Publier une release Windows incluant ces
   commits avant l'étape Omar ; vérifier avec `aphrody infra wg --help` et `aphrody infra remote --help`.
2. **VPS (ufw `deny routed`)** : règles routées sur `wg1` :
   `ufw route allow in on wg1 out on wg1 from 10.200.77.4 to 10.200.77.10 port 8795 proto tcp comment 'aphrody-wg-omar-remote'`
   et la même pour `8793`.
3. Hors du dépôt, `aphrody infra wg render|up omar` ne trouve pas l'inventaire : sur le PC d'Omar on utilise
   un fichier `.conf` (étape 2.4).

## 2. Côté Omar (PowerShell administrateur)

### 2.1 Installer Aphrody

```powershell
irm https://downloads.aphrody.com/install.ps1 | iex
aphrody --version; aphrody infra wg --help; aphrody infra remote --help
```

### 2.2 Pilote WireGuardNT

```powershell
aphrody infra wg driver install   # wireguard-nt 1.1, SHA-256 épinglé, dans %USERPROFILE%\.aphrody\wireguard
aphrody infra wg driver status
```

### 2.3 Clé privée (une seule des deux options)

- **A, garder la clé déclarée** (recommandé, aucune action serveur) : exporter la clé privée de son tunnel de l'app
  WireGuard (Modifier le tunnel, ligne `PrivateKey`) dans le fichier protégé, puis vérifier la clé publique :

```powershell
$k = "$env:USERPROFILE\.aphrody\wireguard\aphrody.key"
New-Item -ItemType Directory -Force (Split-Path $k) | Out-Null
Read-Host "PrivateKey" | Set-Content -NoNewline $k     # coller, rien ne s'affiche ailleurs
icacls $k /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
Get-Content $k | aphrody infra wg pubkey   # doit afficher A42Sm27uwGBIkzPeTmK7yQxz24JDpM9h5jjeQyyjfzg=
```

- **B, nouvelle clé** : `aphrody infra wg keygen` (écrit `%USERPROFILE%\.aphrody\wireguard\aphrody.key`, affiche la
  clé publique). Envoyer **uniquement la clé publique** au propriétaire, qui met à jour l'inventaire et le hub.

Ne jamais faire tourner l'app WireGuard et `aphrody infra wg` en même temps avec la même clé : désactiver le
tunnel de l'app avant l'étape 2.4.

### 2.4 Configuration et montée du tunnel

```powershell
$dir = "$env:USERPROFILE\.aphrody\wireguard"
$key = (Get-Content "$dir\aphrody.key" -Raw).Trim()
@"
[Interface]
PrivateKey = $key
Address = 10.200.77.10/24

[Peer]
PublicKey = McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=
AllowedIPs = 10.200.77.0/24
Endpoint = 51.77.147.152:51821
PersistentKeepalive = 25
"@ | Set-Content -NoNewline "$dir\aphrody.conf"
icacls "$dir\aphrody.conf" /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
Remove-Variable key
aphrody infra wg up "$dir\aphrody.conf" --name aphrody --detach
aphrody infra wg show aphrody            # handshake récent avec McWu… attendu
Test-Connection 10.200.77.1 -Count 2
```

Le tunnel vit avec son processus détaché (journal `%USERPROFILE%\.aphrody\wireguard\aphrody.log`) ; arrêt :
`aphrody infra wg down aphrody`. Alternative sans nouvelle release : la même configuration dans l'app WireGuard.

### 2.5 Pare-feu Windows (tunnel uniquement)

```powershell
New-NetFirewallRule -DisplayName "Aphrody remote desktop (tunnel)" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 8795 -LocalAddress 10.200.77.10 -RemoteAddress 10.200.77.0/24 -Profile Any
New-NetFirewallRule -DisplayName "Aphrody MCP HTTP (tunnel)" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort 8793 -LocalAddress 10.200.77.10 -RemoteAddress 10.200.77.0/24 -Profile Any
```

Durcissement possible : `-RemoteAddress 10.200.77.4` (seul le PC du propriétaire).

### 2.6 Bureau à distance

Dans la session interactive d'Omar (pas un service : la capture exige le bureau ouvert).

```powershell
aphrody infra remote status
aphrody infra remote serve --bind 10.200.77.10:8795
```

Sans `--token` ni `APHRODY_REMOTE_TOKEN`, le jeton est généré et affiché une seule fois sur stderr : le
transmettre au propriétaire **hors bande** (jamais Discord). Options : `--fps 15 --quality 70 --scale 1`.

### 2.7 MCP HTTP (outils `computer_*`)

```powershell
$env:APHRODY_MCP_HTTP_TOKEN = Read-Host "MCP token (>= 32 octets)"    # depuis le magasin protégé, hors bande
Start-Process aphrody-mcp -ArgumentList "http","--bind","127.0.0.1:8793" -WindowStyle Hidden
netsh interface portproxy add v4tov4 listenaddress=10.200.77.10 listenport=8793 connectaddress=127.0.0.1 connectport=8793
Invoke-RestMethod http://127.0.0.1:8793/healthz
```

Les routes REST hors `/mcp` ne sont pas derrière le Bearer : garder la règle pare-feu 8793 restreinte au tunnel.

## 3. Côté propriétaire (aphro-pc)

```powershell
aphrody infra wg show aphrody            # ou: wg.exe show aphrody (service WireGuardTunnel$aphrody)
Test-Connection 10.200.77.10 -Count 3
Invoke-RestMethod http://10.200.77.10:8795/healthz       # "ok"
$env:APHRODY_REMOTE_TOKEN = Read-Host "remote token"     # reçu hors bande
aphrody infra remote open omar                            # ouvre http://10.200.77.10:8795/#token=…
```

Test MCP direct (Streamable HTTP : initialize, puis appel avec l'en-tête de session) :

```powershell
$t = Read-Host "MCP token"; $u = "http://10.200.77.10:8793/mcp"
$h = @{ Authorization = "Bearer $t"; Accept = "application/json, text/event-stream" }
$init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"owner-test","version":"1"}}}'
$r = Invoke-WebRequest $u -Method Post -Headers $h -ContentType application/json -Body $init
$h["Mcp-Session-Id"] = $r.Headers["Mcp-Session-Id"] | Select-Object -First 1
Invoke-WebRequest $u -Method Post -Headers $h -ContentType application/json -Body '{"jsonrpc":"2.0","method":"notifications/initialized"}' | Out-Null
(Invoke-WebRequest $u -Method Post -Headers $h -ContentType application/json -Body '{"jsonrpc":"2.0","id":2,"method":"tools/list"}').Content
(Invoke-WebRequest $u -Method Post -Headers $h -ContentType application/json -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"computer_observe","arguments":{}}}').Content
```

`RemoteComputerBackend` (`crates/ai/agent-tools/src/computer_use.rs`) ouvre une session Streamable HTTP
(`initialize` puis `Mcp-Session-Id`) et envoie le Bearer de `APHRODY_REMOTE_MCP_TOKEN` (commit `9a5ecd8ca`) : la voie
agent `computer_*` distante vise `http://10.200.77.10:8793/mcp` avec le jeton MCP d'Omar.

### Checklist

| #   | Test                           | Attendu                                                                       |
| --- | ------------------------------ | ----------------------------------------------------------------------------- |
| 1   | `Test-Connection 10.200.77.10` | réponses ; handshake récent dans `wg show` des deux côtés                     |
| 2   | `/healthz` 8795 et 8793        | `ok` / 200                                                                    |
| 3   | Visionneuse ouverte            | image du bureau d'Omar, fluide                                                |
| 4   | Clic (souris)                  | menu Démarrer / fenêtre activée                                               |
| 5   | Saisie                         | texte tapé dans Notepad identique                                             |
| 6   | Raccourcis                     | `Ctrl+C/V`, `Alt+Tab`, `Win+R`, `Ctrl+Shift+Esc`                              |
| 7   | Multi-écran                    | bureau virtuel complet capturé ; clic sur le 2e écran au bon endroit          |
| 8   | Reconnexion                    | fermer/rouvrir l'onglet ; `wg down`/`wg up` ; reprise sans redémarrer `serve` |
| 9   | Jeton faux                     | refus (401) sur 8795 et `/mcp`                                                |
| 10  | MCP                            | `tools/list` contient `computer_*`, `computer_observe` renvoie un état        |

## 4. Prompt Codex du PC d'Omar (build source, tunnel, contrôle à distance)

Posté le 2026-10-08 dans le salon admin sécurisé `1557354144149405806` : en-tête `1557857584604516439`, puis
blocs 1 à 8 `1557857591462469755`, `1557857597871362181`, `1557857604376465439`, `1557857610294632562`,
`1557857616938532915`, `1557857623175331922`, `1557857629689348199`, `1557857636794499283`. Omar lance Codex en
PowerShell administrateur (`codex --sandbox danger-full-access --ask-for-approval never`) et colle les blocs 1→8
en un seul message. Il remplace le paquet 2.1 à 2.7 : build depuis les sources (`-p aphrody -p aphrody-mcp
--features aphrody-mcp/winclean`, seule voie qui embarque les outils `computer_*` dans le MCP du binaire
multi-call), tunnel par l'inventaire du dépôt (`--root`), pare-feu limité à `10.200.77.4`, jetons générés
localement et tâche planifiée de garde. Le dépôt est privé : le compte GitHub d'Omar doit y avoir accès.

```text
MISSION (Codex, PC Windows d'Omar, PowerShell administrateur, Windows 10/11 x64).
Construis Aphrody depuis les sources, installe-le, monte le tunnel WireGuard privé Aphrody et les services de contrôle à distance, de bout en bout et en autonomie (étapes 1 à 10), puis rédige le rapport final (étape 11). Exécute toi-même chaque commande ; ne t'arrête que sur un vrai blocage, en disant lequel.

RÈGLES DE SÉCURITÉ (absolues)
- Ne lis, n'affiche, ne journalise, ne copie jamais une clé privée ni un jeton : aucun Get-Content/cat/type sur *.key, *.token, *.conf, aucun echo de variable secrète. Seule exception : le pipe vers `aphrody infra wg pubkey` (étape 6), qui n'affiche que la clé publique.
- La clé privée WireGuard ne passe jamais par toi : si elle doit être saisie, Omar le fait lui-même dans une autre fenêtre.
- Rien de secret dans Discord, un commit, un journal ou le rapport. Les jetons sont transmis hors bande par Omar lui-même.
- Si tu commites dans le dépôt aphrody : identité git d'Omar (jamais aphrody-dev), branche `omar/<sujet>` uniquement, jamais main.
- Rien hors de ce périmètre (aucun autre service, port ou règle pare-feu).

FAITS
- Tunnel `aphrody-private`, interface Windows `aphrody`, réseau 10.200.77.0/24 (split tunnel).
- Hub vps 10.200.77.1, endpoint 51.77.147.152:51821, clé publique McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=
- Omar = 10.200.77.10/24, clé publique déclarée A42Sm27uwGBIkzPeTmK7yQxz24JDpM9h5jjeQyyjfzg=
- Propriétaire aphro-pc = 10.200.77.4 : seule source autorisée vers les services d'Omar.
- Services Omar : 8795/tcp bureau à distance (`aphrody infra remote serve`) ; 8793/tcp MCP HTTP (`aphrody-mcp http`, qui refuse toute adresse non loopback : 127.0.0.1:8793 + netsh portproxy).
- Variables (redéfinis-les dans chaque nouvelle session) : $Repo = "C:\src\aphrody" ; $AH = "$env:USERPROFILE\.aphrody" ; $Bin = "$env:LOCALAPPDATA\Aphrody\bin"

1) PRÉREQUIS (winget ; « déjà installé » n'est pas une erreur). Ajoute à chaque ligne : --accept-source-agreements --accept-package-agreements --disable-interactivity
winget install -e --id Git.Git
winget install -e --id Rustlang.Rustup
winget install -e --id Kitware.CMake
winget install -e --id NASM.NASM
winget install -e --id LLVM.LLVM
winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
Recharge le PATH : $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';C:\Program Files\NASM'
Vérifie : git --version ; rustup --version ; cmake --version ; nasm -v
Le toolchain Rust exact (1.98.1, cible x86_64-pc-windows-msvc) est épinglé par rust-toolchain.toml et s'installe seul au premier cargo. Si une erreur de build cite perl/openssl : winget install -e --id StrawberryPerl.StrawberryPerl.

2) CLONE (dépôt PRIVÉ : le compte GitHub d'Omar doit y avoir accès ; si git clone échoue en 403/404 ou demande une connexion refusée, arrête-toi et dis-le : Omar demande l'accès au propriétaire)
New-Item -ItemType Directory -Force C:\src | Out-Null
git clone --filter=blob:none https://github.com/aphrody-labs/aphrody.git $Repo
Set-Location $Repo ; git remote -v    # attendu : https://github.com/aphrody-labs/aphrody.git
git merge-base --is-ancestor 167399d53 HEAD ; if ($LASTEXITCODE -ne 0) { throw "main trop ancien" }
(Déjà cloné : git -C $Repo pull --ff-only.) main contient `infra wg` et `infra remote` depuis 9a5ecd8ca et le correctif du tunnel détaché Windows depuis 167399d53.

3) BUILD (20 à 60 min, un seul build)
Set-Location $Repo
cargo build --release --locked -p aphrody -p aphrody-mcp --features aphrody-mcp/winclean
Le double -p est voulu : il produit le binaire multi-call target\release\aphrody.exe avec le serveur MCP et ses outils Windows computer_* (feature winclean). En échec : lis la première erreur, installe le prérequis manquant, relance. Ne modifie ni Cargo.lock ni le code.

4) INSTALLATION (chemin stable + PATH)
New-Item -ItemType Directory -Force $Bin | Out-Null
Copy-Item "$Repo\target\release\aphrody.exe" "$Bin\aphrody.exe" -Force
& "$Bin\aphrody.exe" self install-path --bin "$Bin\aphrody.exe"
$env:Path = "$Bin;$env:Path"
aphrody --version ; aphrody infra wg --help ; aphrody infra remote --help ; aphrody-mcp http --help
`self install-path` ajoute $Bin au PATH utilisateur et y crée aphrody-mcp.exe, aphrody-infra.exe, etc. (liens vers aphrody.exe). Équivalent de aphrody-mcp : `aphrody mcp-server`.

Alternative sans build (release publiée) : irm https://downloads.aphrody.com/install.ps1 | iex
Fichiers : https://downloads.aphrody.com/releases/<id>/files/aphrody-<version>-<commit9>-x86_64-pc-windows-msvc.zip, manifeste https://downloads.aphrody.com/latest.json. À n'utiliser que si `aphrody infra wg --help` ET `aphrody infra remote --help` y répondent. La release n'a pas les outils MCP computer_* : le build source reste la voie complète.

5) PILOTE WireGuardNT
aphrody infra wg driver install    # wireguard-nt épinglé, SHA-256 vérifié, DLL dans $AH\wireguard
aphrody infra wg driver status

6) CLÉ PRIVÉE (fichier $AH\wireguard\aphrody.key)
a. S'il existe : Get-Content "$AH\wireguard\aphrody.key" -Raw | aphrody infra wg pubkey
   Attendu : A42Sm27uwGBIkzPeTmK7yQxz24JDpM9h5jjeQyyjfzg= → OK, passe à d.
b. S'il n'existe pas : affiche à Omar ce message et attends sa confirmation : « Dans une AUTRE fenêtre PowerShell, colle la PrivateKey de ton tunnel (app WireGuard → tunnel → Modifier → ligne PrivateKey) avec : $k="$env:USERPROFILE\.aphrody\wireguard\aphrody.key"; New-Item -ItemType Directory -Force (Split-Path $k)|Out-Null; Read-Host "PrivateKey" | Set-Content -NoNewline $k ». Ne lui demande JAMAIS de te la coller. Puis refais a.
c. Si Omar n'a plus cette clé (ou si a. donne une autre clé publique et qu'il confirme l'avoir perdue) : aphrody infra wg keygen (ajoute --force seulement pour remplacer un aphrody.key erroné). Il affiche la clé PUBLIQUE seule : Omar la poste dans le salon admin Discord ; le propriétaire met à jour l'inventaire et le hub. Continue les étapes ; le handshake viendra après.
d. Restreins l'ACL : icacls "$AH\wireguard\aphrody.key" /inheritance:r /grant:r "${env:USERNAME}:F"
e. Si l'app WireGuard fait tourner un tunnel vers 51.77.147.152:51821 (même clé), arrête-le sans le supprimer : Get-Service 'WireGuardTunnel$*' puis Stop-Service et Set-Service -StartupType Disabled sur ce service. Jamais les deux en même temps.

7) TUNNEL (l'inventaire tools/config/host/wireguard/aphrody-tunnel.json est dans le dépôt : passe toujours --root)
aphrody infra --root $Repo wg plan
aphrody infra --root $Repo wg up omar --detach    # interface aphrody, clé $AH\wireguard\aphrody.key, journal $AH\wireguard\aphrody.log
Start-Sleep 5
aphrody infra --root $Repo wg show aphrody         # attendu : peer McWu…, endpoint 51.77.147.152:51821, handshake récent, transfert > 0
Test-NetConnection 10.200.77.1 ; ping -n 3 10.200.77.1
Sans handshake : 40 dernières lignes de aphrody.log, UDP sortant vers 51.77.147.152:51821 autorisé ?, clé publique de l'étape 6 correcte ? Si la clé a été régénérée, attendre la mise à jour du hub par le propriétaire.
Variante .conf (seulement si `up omar` échoue) : aphrody infra --root $Repo wg render omar --private-key-file "$AH\wireguard\aphrody.key" --out "$AH\wireguard\aphrody.conf" ; même icacls qu'en 6d sur le .conf ; aphrody infra wg up "$AH\wireguard\aphrody.conf" --name aphrody --detach
Arrêt : aphrody infra --root $Repo wg down aphrody

8) PARE-FEU (source aphro-pc uniquement)
Remove-NetFirewallRule -Group "Aphrody tunnel" -ErrorAction SilentlyContinue
New-NetFirewallRule -Group "Aphrody tunnel" -DisplayName "Aphrody remote desktop (tunnel)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8795 -LocalAddress 10.200.77.10 -RemoteAddress 10.200.77.4 -Profile Any
New-NetFirewallRule -Group "Aphrody tunnel" -DisplayName "Aphrody MCP HTTP (tunnel)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8793 -LocalAddress 10.200.77.10 -RemoteAddress 10.200.77.4 -Profile Any
New-NetFirewallRule -Group "Aphrody tunnel" -DisplayName "Aphrody tunnel ping" -Direction Inbound -Action Allow -Protocol ICMPv4 -IcmpType 8 -LocalAddress 10.200.77.10 -RemoteAddress 10.200.77.1,10.200.77.4 -Profile Any

9a) JETONS (générés ici, 32 octets aléatoires, jamais affichés)
$P = "$AH\private" ; New-Item -ItemType Directory -Force $P | Out-Null
function New-Tok($f) { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); (-join ($b | ForEach-Object { $_.ToString('x2') })) | Set-Content -NoNewline $f; icacls $f /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null }
if (-not (Test-Path "$P\remote.token")) { New-Tok "$P\remote.token" }
if (-not (Test-Path "$P\mcp.token")) { New-Tok "$P\mcp.token" }

9b) Écris EXACTEMENT ce script dans "$AH\omar-remote.ps1" (garde-fou : tunnel + 2 services, contrôle toutes les 60 s) :
$Repo='C:\src\aphrody'; $AH="$env:USERPROFILE\.aphrody"; $A="$env:LOCALAPPDATA\Aphrody\bin\aphrody.exe"
while ($true) {
  & $A infra --root $Repo wg show aphrody *> $null
  if ($LASTEXITCODE -ne 0) { & $A infra --root $Repo wg up omar --detach *>> "$AH\omar-remote.log"; Start-Sleep 5; Restart-Service iphlpsvc }
  if (-not (Get-NetTCPConnection -LocalPort 8795 -State Listen -ErrorAction SilentlyContinue)) {
    $env:APHRODY_REMOTE_TOKEN = (Get-Content "$AH\private\remote.token" -Raw).Trim()
    Start-Process $A -ArgumentList 'infra','remote','serve','--bind','10.200.77.10:8795' -WindowStyle Hidden -RedirectStandardError "$AH\remote-serve.log"
    Remove-Item Env:APHRODY_REMOTE_TOKEN }
  if (-not (Get-NetTCPConnection -LocalPort 8793 -State Listen -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq '127.0.0.1')) {
    $env:APHRODY_MCP_HTTP_TOKEN = (Get-Content "$AH\private\mcp.token" -Raw).Trim()
    Start-Process $A -ArgumentList 'mcp-server','http','--bind','127.0.0.1:8793' -WindowStyle Hidden -RedirectStandardError "$AH\mcp-http.log"
    Remove-Item Env:APHRODY_MCP_HTTP_TOKEN }
  Start-Sleep 60
}

9c) PORTPROXY + TÂCHE PLANIFIÉE (à l'ouverture de session d'Omar, privilèges élevés, session interactive : la capture d'écran exige le bureau ouvert)
Set-Service iphlpsvc -StartupType Automatic ; Start-Service iphlpsvc
netsh interface portproxy delete v4tov4 listenaddress=10.200.77.10 listenport=8793 2>$null
netsh interface portproxy add v4tov4 listenaddress=10.200.77.10 listenport=8793 connectaddress=127.0.0.1 connectport=8793
$act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + "$AH\omar-remote.ps1" + '"')
$trg = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$prn = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Aphrody Omar remote' -Action $act -Trigger $trg -Principal $prn -Settings $set -Force
Start-ScheduledTask 'Aphrody Omar remote' ; Start-Sleep 30

10) VÉRIFICATION
aphrody infra --root $Repo wg show aphrody
Invoke-RestMethod http://10.200.77.10:8795/healthz        # ok
Invoke-RestMethod http://127.0.0.1:8793/healthz ; Invoke-RestMethod http://10.200.77.10:8793/healthz
try { Invoke-WebRequest http://127.0.0.1:8793/mcp -Method Post -ContentType application/json -Body '{}' -UseBasicParsing } catch { $_.Exception.Response.StatusCode }   # 401 attendu sans jeton
netsh interface portproxy show v4tov4
Get-NetFirewallRule -Group "Aphrody tunnel" | Format-Table DisplayName,Enabled
Get-ScheduledTask 'Aphrody Omar remote' | Format-Table TaskName,State
Journaux à lire en cas d'échec (sans secret) : $AH\omar-remote.log, remote-serve.log, mcp-http.log, wireguard\aphrody.log

JETONS HORS BANDE : dis à Omar d'ouvrir LUI-MÊME $AH\private\remote.token et $AH\private\mcp.token (notepad) et de les transmettre au propriétaire hors bande (en direct, messagerie chiffrée ou gestionnaire de mots de passe), jamais Discord ni Codex. Côté propriétaire : remote.token → APHRODY_REMOTE_TOKEN (`aphrody infra remote open omar`, visionneuse http://10.200.77.10:8795) ; mcp.token → APHRODY_REMOTE_MCP_TOKEN (outils computer_* vers http://10.200.77.10:8793/mcp).

ROLLBACK (si demandé ou si l'installation doit être annulée)
Unregister-ScheduledTask 'Aphrody Omar remote' -Confirm:$false
aphrody infra --root $Repo wg down aphrody
Get-Process aphrody, aphrody-mcp -ErrorAction SilentlyContinue | Stop-Process -Force
netsh interface portproxy delete v4tov4 listenaddress=10.200.77.10 listenport=8793
Remove-NetFirewallRule -Group "Aphrody tunnel"
Optionnel : Remove-Item "$AH\private\remote.token","$AH\private\mcp.token" ; réactiver le tunnel de l'app WireGuard.

11) RAPPORT FINAL (Omar le poste dans le salon admin Discord ; AUCUN secret : ni clé privée, ni jeton, ni contenu de .key/.token/.conf)
- aphrody --version, git -C $Repo rev-parse --short HEAD, méthode (build source ou release)
- clé publique : A42Sm27uwGBIkzPeTmK7yQxz24JDpM9h5jjeQyyjfzg= confirmée, OU la nouvelle clé publique issue de keygen
- sortie de `aphrody infra --root $Repo wg show aphrody` (clés publiques seulement) et résultat du ping 10.200.77.1
- healthz 8795 et 8793 (127.0.0.1 et 10.200.77.10), 401 sans jeton, portproxy, règles pare-feu, état de la tâche planifiée
- jetons remis hors bande : oui/non (jamais leur valeur)
- ce qui a échoué, pourquoi, et ce qui reste à faire côté Omar ou côté propriétaire
```

## 4 bis. Étape 12 — SSH (posté le 2026-10-08)

Messages `1557864511908745337` et `1557864516170027020` du salon admin, à exécuter par le Codex d'Omar en
PowerShell administrateur après l'étape 11. Omar (GitHub `KyrioFox`, confirmé par le propriétaire le 2026-10-08) n'a
aucune clé publique sur GitHub : son Codex en génère une et ne poste que la ligne `.pub`. Le propriétaire l'installe
ensuite par `~/.aphrody/run/install-omar-ssh-key.ps1 '<ligne publique>'` (vps, dbfr, aphro-pc) puis la déclare dans
`tools/config/host/ssh/omar.authorized_keys`. Liens et état : section « SSH mesh » de
[PRIVATE-TUNNEL.md](PRIVATE-TUNNEL.md). Côté propriétaire, l'alias `omar-pc` (`~/.ssh/config`) attend le `User`
Windows du rapport d'Omar.

```powershell
# a) Clé d'Omar (créée seulement si absente), puis poste ICI la seule ligne publique affichée
$S = "$env:USERPROFILE\.ssh"; New-Item -ItemType Directory -Force $S | Out-Null
if (-not (Test-Path "$S\id_ed25519")) {
  ssh-keygen --% -t ed25519 -f "%USERPROFILE%\.ssh\id_ed25519" -N "" -C omar@KyrioFox
}
Get-Content "$S\id_ed25519.pub"

# b) Serveur OpenSSH, démarrage auto, port 22 ouvert au seul tunnel
if ((Get-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0).State -ne 'Installed') { Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 }
# (si Get-WindowsCapability échoue : winget install --id Microsoft.OpenSSH.Preview -e)
Set-Service sshd -StartupType Automatic; Start-Service sshd
Remove-NetFirewallRule -Name Aphrody-SSH-In-Tunnel -ErrorAction SilentlyContinue
New-NetFirewallRule -Name Aphrody-SSH-In-Tunnel -DisplayName 'Aphrody tunnel SSH' -Group 'Aphrody tunnel' -Direction Inbound -Protocol TCP -LocalPort 22 -LocalAddress 10.200.77.10 -RemoteAddress 10.200.77.0/24 -Profile Any -Action Allow
Disable-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue   # pas de 22 hors tunnel

# c) Clés publiques autorisées (propriétaire GitHub aphrody-dev, PC du propriétaire, vps), tunnel seulement
$keys = @(
 'from="10.200.77.0/24" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF+IwnaVjBqNuHwnId41Eug0Q76N0u2A8pkWqltPn+hP aphrody-dev@github',
 'from="10.200.77.4" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM9fIsjABVye9MqLRBc2ddz2hKJdxNPQm22uzcDKrnkw aphrody-owner-pc',
 'from="10.200.77.1" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICXbajabKOH0cOxwgHWtA3Y4cdT/ZTQcck4c3stty709 aphrody-vps-to-omar-pc')
$adm = [bool]((whoami /groups) -match 'S-1-5-32-544')
$f = if ($adm) { "$env:ProgramData\ssh\administrators_authorized_keys" } else { "$S\authorized_keys" }
$cur = @(if (Test-Path $f) { Get-Content $f })
$keys | Where-Object { $cur -notcontains $_ } | Add-Content -Encoding ascii $f
if ($adm) { icacls $f /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' }

# d) Client : alias vers vps, dbfr, aphro-pc
if (-not (Select-String -Quiet -Path "$S\config" -Pattern '^Host aphro-pc' -ErrorAction SilentlyContinue)) {
"Host vps`n  HostName 10.200.77.1`n  User omar`nHost dbfr`n  HostName 10.200.77.3`n  User omar`nHost aphro-pc`n  HostName 10.200.77.4`n  User aphro`nHost vps dbfr aphro-pc`n  IdentityFile ~/.ssh/id_ed25519`n  IdentitiesOnly yes`n  StrictHostKeyChecking accept-new" | Add-Content -Encoding ascii "$S\config" }

# e) Rapport (ici) : whoami ; $env:USERNAME ; admin=$adm ; (Get-Service sshd).Status ; Get-NetTCPConnection -LocalPort 22 -State Listen ; ligne .pub
# Une fois ta clé installée par le propriétaire : ssh vps whoami ; ssh dbfr whoami ; ssh aphro-pc whoami
```

Rollback : `Stop-Service sshd; Set-Service sshd -StartupType Disabled; Remove-NetFirewallRule -Name Aphrody-SSH-In-Tunnel`.

## 5. Modèle `wg render omar` (sans PrivateKey)

Sortie de `aphrody infra wg render omar` dans le dépôt (`Inventory::render`, `Config::render`) :

```ini
[Interface]
Address = 10.200.77.10/24

[Peer]
PublicKey = McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=
AllowedIPs = 10.200.77.0/24
Endpoint = 51.77.147.152:51821
PersistentKeepalive = 25
```
