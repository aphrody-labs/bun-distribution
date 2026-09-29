# Administration Windows → VPS

Les alias SSH et les fonctions PowerShell sont installés hors dépôt afin de ne
jamais versionner de clé privée ou de `rclone.conf` :

- SSH : `~/.ssh/config` du profil Windows
- Outils : `VpsTools.ps1` dans le `bin` du profil utilisateur
- Profil : `$PROFILE` PowerShell

## Cibles

Les adresses, rôles et services de chaque hôte ne sont pas recopiés ici : ils vivent dans
`aphrody-infra` (`inventory/`, `config/service-catalog.json`, `docs/PRODUCTION-ALLOCATION.md`).
Rôles actuels, résumés dans [`INFRA-DELEGATION.md`](INFRA-DELEGATION.md) :

| Alias  | Rôle opérationnel |
| ------ | ----------------- |
| `vps`  | VPS principal : runtime applicatif Shenron (site, API bot, MCP) partagé avec RG/Aphrody/NIE |
| `dbfr` | PostgreSQL `shenron_site`, données et backups |

Toujours confirmer la cible avant une action :

```powershell
ssh dbfr 'hostname; uptime; df -h /'
ssh vps 'hostname; uptime; df -h /'
```

## Transferts

Les commandes `*-copy` ajoutent ou mettent à jour sans supprimer. Les
commandes `*-sync` commencent en `--dry-run` et ne peuvent supprimer côté
serveur qu’avec `-Apply` explicitement fourni.

```powershell
dbfr-upload .\archive.zip ~/transfer
dbfr-download ~/transfer/archive.zip .\Downloads
dbfr-sync .\projet ~/projet
dbfr-sync .\projet ~/projet -Apply
```

Le même jeu de commandes existe avec le préfixe `vps-`. Utiliser `copy` par
défaut; réserver `move` aux transferts dont la suppression de la source est
attendue.

## Diagnostic borné

```powershell
vps-status
vps-ports
vps-systemd status shenron-site
vps-logs shenron-bot 100
```

Pour l’hôte de données, remplacer `vps-` par `dbfr-`. Les scans Nmap restent
limités aux hôtes administrés. Ne jamais afficher ni committer les
fichiers `.ssh`, les clés privées ou `%APPDATA%\rclone\rclone.conf`.

## État vérifié le 2026-09-07 (historique)

Relevé antérieur à la délégation à `aphrody-infra` : `dbfr` portait alors site, bot et MCP,
et `vps` était un repli arrêté. Ce n'est plus la répartition actuelle.

- Les deux connexions SSH par clé fonctionnaient.
- `dbfr` : racine à environ 95 % ; `vps` : racine à environ 92 %.
- `dragonballfr.com`, `bot.dragonballfr.com/health` et `mcp.dragonballfr.com/health`
  répondaient HTTP 200.

Le déploiement ne passe plus par ce dépôt : voir [`INFRA-DELEGATION.md`](INFRA-DELEGATION.md).
Ne pas éditer directement un checkout sur un serveur.
