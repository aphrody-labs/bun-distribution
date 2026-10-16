<!-- SPDX-License-Identifier: Apache-2.0 -->

# VNC et bureau à distance : carte des cibles (2026-10-09)

Un seul serveur, `aphrody infra remote serve` : visionneuse navigateur WebSocket (8795, jeton Bearer) et RFB/VNC
(5900, mot de passe de 8 caractères) alimentés par la même capture (GDI Windows, X11 XTEST Linux). Client natif :
`aphrody infra remote connect`, outil MCP `aphrody_remote_vnc`, sonde `scripts/tools/infra/vnc-probe.ts`. Déclaration :
services `remote-desktop-*` et `vnc-*` de `tools/config/host/wireguard/aphrody-tunnel.json` (l'allowlist par défaut en
dérive). Contexte réseau : [PRIVATE-TUNNEL.md](PRIVATE-TUNNEL.md), [OMAR-REMOTE-CONTROL.md](OMAR-REMOTE-CONTROL.md).

## Cibles

| Cible           | Adresse VNC / viewer                       | Admis (en plus du loopback)                                           | Persistance                                                                             | État 2026-10-09                                                  |
| --------------- | ------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| PC propriétaire | `10.200.77.4:5900` / `:8795`               | `10.200.77.10` (Omar), `10.200.77.4` (soi-même, pour `remote status`) | tâche `\Aphrody\Remote Desktop` (ouverture de session + toutes les 5 min, 999 relances) | testé : capture                                                  |
| PC d'Omar       | `10.200.77.10:5900` / `:8795`              | `10.200.77.4` (défaut du serveur)                                     | tâches `\Aphrody\` côté Omar (`aphrody infra remote always-online`)                     | joignable, RFB 003.008 ; authentification refusée (mot de passe) |
| dbfr            | `10.200.77.3:5900` / `:8795`               | `10.200.77.4`, `10.200.77.10`                                         | unités `aphrody-desktop-xvfb`, `aphrody-desktop-wm`, `aphrody-remote` (enabled)         | testé : tout                                                     |
| vps             | `10.200.77.1:5900` / `:8795`               | `10.200.77.4`                                                         | mêmes unités                                                                            | testé : tout                                                     |
| Docker          | `127.0.0.1:5905` / `127.0.0.1:8805` (hôte) | réseau Docker `172.16.0.0/12`                                         | `compose.vnc.yaml`, `restart: unless-stopped`, healthcheck                              | testé : tout                                                     |
| WSL             | aucun serveur propre                       | -                                                                     | -                                                                                       | voir ci-dessous                                                  |

Le propriétaire n'est pas admis sur son propre VNC par défaut ; `10.200.77.4` est ajouté pour que `remote status`
(qui sonde depuis cette adresse) ne voie pas un faux « early eof ». Jamais `any`. vps et dbfr ne sont pas admis sur le
VNC du PC : aucun besoin. Pare-feu : ufw des hôtes n'ouvre ces ports qu'aux membres déclarés sur `wg1`
(règles `aphrody-wg-<membre>`), jamais sur Internet ; Defender et le pare-feu Windows restent désactivés exprès.

## Hôtes Linux sans bureau (vps, dbfr)

Bureau virtuel Xvfb `:99` (1600x900, sans TCP), openbox, puis `aphrody infra --root /home/ubuntu/.aphrody remote serve`
lié à l'adresse `wg1` de l'hôte. Unités : `tools/config/host/systemd/aphrody/aphrody-{desktop-xvfb,desktop-wm,remote}.service`
(`Restart=always`, `After=wg-quick@wg1`, repris par `aphrody-selfheal.timer`). Configuration et secrets dans
`/etc/aphrody/remote.env` (root, 0600) : `APHRODY_REMOTE_TOKEN`, `APHRODY_VNC_PASSWORD`, `APHRODY_REMOTE_BIND`,
`APHRODY_VNC_BIND`, `APHRODY_VNC_ALLOW`. Copies côté client (magasin d'identifiants) :
`~/.aphrody/private/<vps|dbfr>/{remote.token,vnc.password}`. Journaux : `journalctl -u aphrody-remote`.
Le répertoire `--root` doit être inscriptible (`/home/ubuntu/var` appartient à root sur ces hôtes).

```sh
ssh vps 'systemctl is-active aphrody-desktop-xvfb aphrody-desktop-wm aphrody-remote; ss -ltn | grep -E ":(5900|8795) "'
ssh vps 'DISPLAY=:99 xterm &'     # fenêtre de test
```

## Docker (bureau pour agents Computer-Use)

`tools/config/container/compose.vnc.yaml` (fichier séparé de `compose.yaml`) : image `aphrody/desktop-vnc:local` bâtie
sur `aphrody:runtime` (`tools/config/container/vnc/`), Xvfb + openbox + `remote serve` lié à l'IP IPv4 du conteneur,
ports publiés sur le loopback seulement, système de fichiers en lecture seule, `cap_drop: ALL`. L'image
`aphrody:runtime` n'a pas encore `remote serve --vnc` : le binaire Linux courant (`~/.aphrody/bin/linux/aphrody`, copié
du vps) est injecté par un contexte de build additionnel ; retirer ce contexte quand l'image est reconstruite.

```sh
APHRODY_HOME=C:/Users/aphro/.aphrody docker compose -f tools/config/container/compose.vnc.yaml up -d --build
APHRODY_VNC_PASSWORD=$(cat ~/.aphrody/private/docker/vnc.password) bun scripts/tools/infra/vnc-probe.ts vnc://127.0.0.1:5905 --act
```

Secrets : `~/.aphrody/private/docker/remote.env` (hors dépôt).

## Commandes

```sh
aphrody infra remote status                       # capture locale, handshakes wg1, 8795/5900/8793 de chaque membre
aphrody infra remote token status                 # source de chaque secret (jamais la valeur)
aphrody infra remote token set vnc --target omar  # mot de passe reçu hors bande, sur stdin
aphrody infra remote connect vps --screenshot vps.jpg --click 700,300 --type bonjour --key Enter
aphrody infra remote open dbfr                    # visionneuse navigateur (jeton du magasin)
aphrody infra remote snapshot --out local.jpg     # une image du bureau local
bun scripts/tools/infra/vnc-probe.ts vps dbfr --act     # capture, déplacement, clic, double clic, saisie, raccourcis, défilement, glisser, clic droit
```

Fonctions du client RFB (`aphrody_remote_vnc`) : capture, déplacement, clic (gauche/droit/milieu), double clic, glisser,
défilement (x/y), saisie, raccourcis, attente. `connect` (CLI) ne couvre que capture, clic, saisie et touche.
Non pris en charge : presse-papiers (pas de ServerCutText/ClientCutText) et sélection d'écran (une seule surface : bureau
virtuel complet côté Windows, écran unique Xvfb côté Linux). Capture : la première image peut n'être que partiellement
peinte juste après la connexion ; refaire une capture.

## PC d'Omar : déblocage

Port 5900 atteignable (directement et par le tunnel inverse `vps:25900`, alias `ssh -N vnc-omar-rt` puis
`vnc://127.0.0.1:15900`) mais le serveur ferme la connexion à l'authentification : le mot de passe du magasin
(`private/remote.token` du propriétaire, dérivé) n'est pas celui d'Omar. Il faut son mot de passe VNC hors bande, puis
`aphrody infra remote token set vnc --target omar`. La tâche `\Aphrody\VNC Omar Probe` (ouverture de session + toutes
les 30 min) lance `vnc-probe.ts omar --wait 86400`, journalise dans `~/.aphrody/logs/vnc-omar-probe.log` et se désactive
au premier succès. Ne pas se connecter en SSH à son PC par essais d'utilisateurs.

## WSL

`AphrodyAlpine` (arrêtée) : pas de serveur VNC. WSLg affiche ses fenêtres dans le bureau Windows : elles sont capturées
et pilotées par le VNC du PC (`10.200.77.4:5900`). Un second serveur dans WSL doublerait la capture sans bureau propre ;
`docker-desktop` est la VM Docker, sans bureau. WSL reste retiré du développement ; rien n'est démarré ni installé.

## Dépannage

- `RFB handshake failed ... unexpected end of file` : mauvais mot de passe ou adresse source non admise (`--vnc-allow`).
- `early eof` en sondant sa propre adresse `wg1` : l'adresse n'est pas dans l'allowlist.
- `Permission denied (os error 13)` au démarrage Linux : répertoire `--root` non inscriptible (`var/runs`).
- Unité `activating` en boucle : Xvfb absent (`apt-get install xvfb openbox`).
- Pas de réponse sur `10.200.77.x` : `wg show wg1` (hub) ; règles `ufw status | grep aphrody-wg`.
