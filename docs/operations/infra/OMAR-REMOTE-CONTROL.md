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

1. **Release Windows** : `wg` et `remote` (commits `d03ded4cb`/`6c1f38f56`) ne sont pas dans la release publiée
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

Limite connue : `RemoteComputerBackend` (`crates/ai/agent-tools/src/computer_use.rs`, `call_remote_tool`) poste
`tools/call` sans `initialize` ni session, et `[computer_use] remote_host = "omar"` ne fournit aucun jeton
(`auth_token: None`). Contre un `/mcp` authentifié, la voie agent `computer_*` distante échoue (401/400) tant
que ce n'est pas corrigé ; le test ci-dessus et le bureau à distance 8795 sont les voies qualifiables.

### Checklist

| # | Test | Attendu |
| --- | --- | --- |
| 1 | `Test-Connection 10.200.77.10` | réponses ; handshake récent dans `wg show` des deux côtés |
| 2 | `/healthz` 8795 et 8793 | `ok` / 200 |
| 3 | Visionneuse ouverte | image du bureau d'Omar, fluide |
| 4 | Clic (souris) | menu Démarrer / fenêtre activée |
| 5 | Saisie | texte tapé dans Notepad identique |
| 6 | Raccourcis | `Ctrl+C/V`, `Alt+Tab`, `Win+R`, `Ctrl+Shift+Esc` |
| 7 | Multi-écran | bureau virtuel complet capturé ; clic sur le 2e écran au bon endroit |
| 8 | Reconnexion | fermer/rouvrir l'onglet ; `wg down`/`wg up` ; reprise sans redémarrer `serve` |
| 9 | Jeton faux | refus (401) sur 8795 et `/mcp` |
| 10 | MCP | `tools/list` contient `computer_*`, `computer_observe` renvoie un état |

## 4. Prompt pour l'agent Aphrody/Claude du PC d'Omar

```text
Tu es sur le PC Windows d'Omar (admin). Mets en place le contrôle à distance Aphrody via le tunnel WireGuard
privé, de bout en bout, en PowerShell administrateur (paquet posté par le propriétaire, étapes 2.1 à 2.7). Règles : n'affiche, ne journalise et n'envoie jamais de clé privée ni de jeton ; ne colle
rien de secret dans Discord. 1) Installer/mettre à jour Aphrody (irm https://downloads.aphrody.com/install.ps1 | iex),
vérifier que `aphrody infra wg --help` et `aphrody infra remote --help` existent, sinon s'arrêter et le signaler.
2) `aphrody infra wg driver install`. 3) Si %USERPROFILE%\.aphrody\wireguard\aphrody.key n'existe pas, demander à
Omar de coller la PrivateKey de son tunnel WireGuard existant (Read-Host) et vérifier que `aphrody infra wg pubkey`
donne A42Sm27uwGBIkzPeTmK7yQxz24JDpM9h5jjeQyyjfzg= ; si Omar n'a plus cette clé, `aphrody infra wg keygen` et
afficher seulement la clé publique à transmettre. 4) Désactiver le tunnel de l'app WireGuard s'il utilise la même
clé, écrire aphrody.conf (Address 10.200.77.10/24, peer McWuNyGdzU81q9MEyfvnxoGYIHqGW1UcRqpcge3NxB4=, Endpoint
51.77.147.152:51821, AllowedIPs 10.200.77.0/24, PersistentKeepalive 25), ACL utilisateur seul, puis
`aphrody infra wg up <conf> --name aphrody --detach` et `aphrody infra wg show aphrody` : exiger un handshake.
5) Créer les deux règles New-NetFirewallRule (8795, 8793 ; LocalAddress 10.200.77.10 ; RemoteAddress 10.200.77.0/24 ;
Profile Any). 6) Lancer `aphrody infra remote status` puis `aphrody infra remote serve --bind 10.200.77.10:8795`
dans la session interactive ; le jeton affiché est remis à Omar seul, qui le transmet hors bande. 7) Si un jeton
MCP est fourni par Omar : `aphrody-mcp http --bind 127.0.0.1:8793` avec APHRODY_MCP_HTTP_TOKEN, portproxy
10.200.77.10:8793 -> 127.0.0.1:8793, vérifier /healthz. Rapporte : versions, état wg show (sans clés), règles
pare-feu créées, ports à l'écoute, ce qui a échoué.
```

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
