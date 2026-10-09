# Persistance au boot

Directive propriétaire (2026-10-09) : tout Aphrody redémarre seul après un reboot, sur Win11 et Ubuntu, depuis un état désiré unique.

## Modèle déclaratif

Source : `tools/config/service-catalog.json`.

- Dérivé automatiquement : chaque `services[]` non `retired` avec `host` devient une entrée `docker` (si `container`) ou `systemd` (si `unit`). Les services `status: retired-*` ne sont jamais audités ni corrigés.
- Explicite : `boot.entries[]` ajoute minuteries, sockets, wrappers `-docker`, tâches planifiées et services Windows. Une entrée explicite l'emporte sur la dérivée.
- `hold` : l'entrée est auditée mais `apply` ne la corrige pas (travail d'un autre propriétaire, déploiement à planifier).

| kind | attendu | correction (`apply`) |
|---|---|---|
| `systemd` | activée au boot, active, `Restart=always|on-failure|on-abnormal` (hors oneshot/timer/socket) | `systemctl enable --now` ou `reset-failed` + `start` ; `Restart=` absent ou unité absente = correction de la source (drop-ins/déploiement), jamais de modification ad hoc |
| `docker` | restart policy `always` ou `unless-stopped`, en cours | `docker update --restart unless-stopped` + `docker start` |
| `scheduledTask` | déclencheurs déclarés (`atStartup`, `atLogon`), redémarrage sur échec (999 x 1 min), activée, en cours | ajout des déclencheurs manquants + `Set-ScheduledTask`/`Register-ScheduledTask` (principal `system`, ou utilisateur S4U si `atStartup`, interactif si `atLogon` seul) |
| `windowsService` | démarrage Automatic, en cours, actions de reprise si `restartOnFailure` | `Set-Service` + `Start-Service` + `sc.exe failure` |

`Aphrody Remote Desktop` reste `atLogon` : la capture d'écran exige la session interactive.

## Commandes

```text
aphrody infra boot audit [--host vps|dbfr|local] [--json]   # lit l'état réel ; code de sortie 1 s'il reste une dérive non retenue
aphrody infra boot plan  [--host ...]                         # liste les commandes qui corrigeraient, sans rien exécuter
aphrody infra boot apply [--host ...]                         # exécute le plan puis relit l'état
```

Sans `--host`, tous les hôtes déclarés sont traités. Les hôtes distants passent par SSH (`sudo -n` pour systemd) ; `local` est la machine courante (entrées Windows via PowerShell).

## État observé (2026-10-09)

- `vps` et `local` : conformes (la tâche `Aphrody MCP HTTP` a reçu le déclencheur AtStartup, principal S4U).
- `dbfr` : conforme sauf deux entrées retenues : `aphrody-jobs-worker-dbfr.service` (désactivé, en échec ; worker corrigé séparément) et `aphrody-a2a.service` (déclaré sur dbfr par le catalogue mais unité absente ; à déployer via `aphrody infra deploy`).
- Conteneurs `shenron-*` de dbfr : `unless-stopped`. Les conteneurs de build du vps (`stab-rel-glibc`, `aphrody-setup-ubuntu`) sont éphémères et non déclarés.
- Unités Shenron retirées sur le vps (`shenron-bot`, `shenron-site`, `shenron-mcp-http`, minuteries) : non touchées.

Implémentation : `crates/infra/infra/src/boot.rs` (tests unitaires inclus).
