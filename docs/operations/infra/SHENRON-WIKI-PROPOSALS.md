# Propositions wiki périodiques

Le propriétaire éditorial reste Shenron, `scripts/ops/wiki-fill-supervisor.ts`,
qui réutilise `wiki-fill-agents.ts` et la file SQLite existante sur `dbfr` :
`/home/ubuntu/.aphrody/profiles/dbfr/jobs/wiki-completion-20261015`.
Le service ne publie aucun texte et ne dispose d'aucun chemin d'écriture CMS.
L'opérateur relit les exports approuvés avant l'application CAS distincte.

Le minuteur `shenron-wiki-proposals.timer` lance une passe après le démarrage,
puis six heures après la fin de la précédente. `flock` évite les chevauchements.
La passe relit les 37 tables canoniques ; le jeton de l'actuel conteneur
`aphrody-site-1` reste en mémoire et ne rejoint ni les arguments ni les modèles.
L'authentification Codex existante du compte ubuntu reste sur son hôte.

Une qualification réelle du bundle exact et du modèle `gpt-5.6-luna` est
nécessaire avant toute campagne. Le smoke est un job d'audit indépendant : il ne
remplace aucun pointeur de cible ni aucune décision existante. Sa quarantaine
ferme immédiatement la qualification. Les décisions rejected, quarantined et
approved ne sont jamais réinitialisées. Une nouvelle implémentation ne crée pas
une nouvelle proposition pour une cible déjà inventoriée.

Chaque passe traite au plus 20 candidats, avec 4 runners Codex simultanés. Seuls
les échecs de transport prouvés par des reçus de la tentative courante peuvent
reprendre après six heures, avec le même identifiant et au plus trois tentatives.
Un refus sémantique reste bloqué. Après trois échecs de transport d'inventaire,
le circuit attend 24 heures. Les sources indisponibles n'ont aucune preuve
inventée. Une cible dont le snapshot a changé reste en attente de l'opérateur.

Le job et les journaux restent privés (0700/0600). Les exports
`var/reports/approved-<sha256>.json` sont créés exclusivement, jamais remplacés.
`supervisor-status.json` rapporte l'état partiel et le chemin de l'export ; un
compte de jobs n'est pas une garantie de complétude documentaire. Le quota arrête
la passe avant 2 Gio de captures ou sous 512 Mio libres ; aucune suppression
automatique de preuve. Le plafond du service est 2 CPU, 4 Gio et 256 tâches.

Pour suspendre sans toucher aux autres travaux, créer `supervisor.pause` dans le
job privé. Pour inspecter :

```
aphrody infra service status --id shenron-wiki-proposals-timer --target dbfr
aphrody infra service status --id shenron-wiki-proposals --target dbfr
```

Le déploiement suit un plan privé contenant le hash du bundle, les gates et les
seules mutations prévues. Installer uniquement les deux unités cataloguées,
précréer le journal 0600, vérifier avec `systemd-analyze verify`, recharger le
daemon, puis activer le minuteur par Infra. Ne pas redémarrer les lecteurs, le
pool manga, les builds Bun ou les services VPN pour ce déploiement.

Qualification du 15 octobre 2026 : 23 tests / 138 assertions et contrôle natif de
8 fichiers verts ; catalogue Infra sans erreur ni avertissement et unités
vérifiées. Le smoke réel du bundle scellé a produit une proposition littérale
pour la section 13090, avec un rédacteur et un réviseur `gpt-5.6-luna`
indépendants ; aucun pointeur de cible modifié. La première passe systemd s'est
terminée avec succès à 14:32:54 UTC, sans nouvelle proposition : 90 jobs bloqués,
3 quarantaines et 8 refus conservés. Le minuteur reste activé pour les passes
suivantes. Ces états ne signifient pas que les lacunes sont résolues.

Le chemin Infra `service` normalise actuellement certains noms de minuteurs en
`.service`. Pour agir sur cette paire, employer le propriétaire exact :

```
aphrody infra ssh service --host dbfr --action status shenron-wiki-proposals.timer
aphrody infra ssh service --host dbfr --action status shenron-wiki-proposals.service
```
