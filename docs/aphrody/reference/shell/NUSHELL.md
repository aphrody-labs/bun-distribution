<!-- SPDX-License-Identifier: Apache-2.0 -->
# Nushell dans aphrody-shell

Ce document décrit les éléments Nushell versionnés dans `aphrody-shell` : le
moteur embarqué `aphrody-nu`, ses variables d’environnement, et les scripts
`.nu` du dépôt. Il ne décrit pas la configuration interactive du poste WSL,
qui reste dans `~/.config/nushell` et `~/.config/shell`.

Pour les plugins installés sur le poste, Carapace, Starship, zoxide, les
complétions communautaires et les chemins de configuration Bash/Nu, voir le
[guide Nushell du workspace](../workspace/nu.md).

## Surfaces Nushell

| Surface | Emplacement | Rôle |
| --- | --- | --- |
| Moteur embarqué | `crates/shell/nu` | Construit un contexte Nushell dans le processus Aphrody et évalue du code Nu |
| Script de maintenance | `scripts/tools/shell/scripts/shell_maintenance_workflow.nu` | Audite et nettoie certains artefacts dans le répertoire courant |
| Nettoyage Windows | `scripts/tools/shell/scripts/winclean.nu` | Pipeline de purge et d’optimisation Windows, à effets système |
| Configuration interactive | Hors dépôt, `~/.config/nushell/{env.nu,config.nu}` | Plugins, fonctions, complétions, invite et alias locaux |

Les plugins listés dans le guide du workspace et les commandes interactives de
`nu-cli` ne sont pas chargés par le moteur embarqué. `NuShell::new` assemble les
commandes standard `nu_cmd_lang`, `nu_command` et `nu_cmd_extra`, puis ajoute la
commande Aphrody `aphrody utils`. Il charge aussi la bibliothèque standard Nu.
Les dépendances Nu sont alignées sur la version `0.115.1` dans le manifeste
racine Cargo.
Ce moteur embarqué est une capacité consommée par Aphrody : évaluations dans le
processus, valeurs structurées, interruption et accès IPC authentifié. Il ne
réutilise pas le binaire Nu ni les plugins installés sur le poste. Le moteur ne
compile pas non plus la gestion Nu des plugins : elle n’a pas de consommateur
dans l’évaluateur et pourrait lancer ou modifier des plugins du poste. Les
options Reedline pour l’éditeur Helix et le presse-papiers système restent
désactivées car elles n’apportent rien à cet évaluateur non interactif. Les
variables d’environnement parent sont copiées directement dans `EngineState`;
`PWD` est remplacé par le répertoire initial demandé.

Le shell interactif et les plugins Nu du poste sont des outils facultatifs,
installés hors du graphe Cargo de ce dépôt par
`scripts/dev/setup.nu` avec
`--developer-cli` (inspection) ou `--developer-cli --apply` (installation et
enregistrement des plugins). La liste maintenue est dans
[`developer-cli-tools.json`](../../../../tools/aphrody/config/developer-cli-tools.json).

## Moteur `aphrody-nu`

`NuShell::new(cwd)` initialise le moteur avec un répertoire de travail, la
configuration Nu par défaut et l’environnement parent du processus. Chaque
évaluation utilise une copie privée de l’état moteur. Les variables fournies par
l’appelant sont ajoutées au `$env` de cette évaluation seulement. Le résultat
est converti en JSON structuré et comprend le répertoire courant final.

Les points d’entrée publics incluent :

- `NuShell::new` et `NuShell::from_current_dir` pour créer le moteur ;
- `NuShell::eval` pour évaluer du code, avec répertoire, variables et signal
  d’interruption facultatifs ;
- `NuShell::commands` pour parcourir les commandes connues ;
- `NuShell::help` pour récupérer l’aide d’une commande.

Le timeout d’évaluation par défaut est de 120 secondes. La commande intégrée
`aphrody utils` appelle les services d’utilitaires du noyau via IPC authentifié ;
elle ne cherche pas de binaire dans le `PATH` de l’hôte.

### `aphrody utils`

```nu
aphrody utils status
aphrody utils catalog
aphrody utils run grep -- 'motif' 'src/**/*.rs'
aphrody utils ls --cwd /workspace --format json
aphrody utils cp --check -- 'source.txt' 'destination.txt'
```

`status` expose l’état du service, `catalog` liste les utilitaires disponibles,
et `run` prend le nom puis les arguments littéraux de l’utilitaire. On peut aussi
omettre `run` et passer directement le nom. Utiliser `--` pour transmettre des
options appartenant à l’utilitaire. `--cwd`, `--timeout` (millisecondes),
`--max-output-bytes`, `--format text|json|jsonl` et `--check` contrôlent la
requête. Les valeurs par défaut sont 30 secondes et 1 MiB par flux ; les limites
sont cinq minutes et 8 MiB par flux. `--check` transforme un code de sortie non
nul en erreur Nu.

Variables de processus utilisées par le client noyau :

| Variable | Usage |
| --- | --- |
| `APHRODY_OS_SOCKET` | Sélectionne le point de terminaison IPC ; sans cette variable, l’adresse par défaut du client est utilisée |
| `APHRODY_OS_AUTH_TOKEN` | Jeton facultatif d’authentification transmis au client IPC |

Ne pas mettre de jeton dans le code Nu, les scripts versionnés ou les journaux.
L’environnement Nu embarqué est hérité du processus parent ; l’appelant peut
aussi injecter une variable propre à une évaluation via l’argument `vars` de
`eval`.

## Scripts versionnés

### `scripts/tools/shell/scripts/shell_maintenance_workflow.nu`

Lancer depuis la racine du dépôt concerné :

```sh
nu scripts/shell_maintenance_workflow.nu --help
nu scripts/shell_maintenance_workflow.nu --dry-run --skip-hashes
```

Le script traite le répertoire courant (`$env.PWD`). Il cible `target`, `build`,
`dist`, `.turbo` et `.cache`, puis recherche des fichiers `.log`, `.pdb`, `.ilk`,
`.dmp`, `.tmp` et `.tsbuildinfo`. Il peut ensuite comparer les fichiers de plus
de 50 Ko par taille et empreinte SHA-256. `--dry-run` empêche les suppressions ;
`--skip-hashes` saute l’analyse des doublons. Sans `--dry-run`, il supprime les
artefacts listés et peut supprimer certaines copies identiques dont le chemin
contient `tmp`, `var` ou `cache`. Le filtrage des répertoires ignorés est
heuristique ; inspecter le répertoire courant et faire un dry-run avant toute
exécution destructive.

### `scripts/tools/shell/scripts/winclean.nu`

Script destiné à Nushell 0.115+ sous Windows, seul propriétaire du pipeline
WinClean depuis le retrait de son jumeau PowerShell (`winclean-pipeline.ps1`).
L'aide est consultable avec :

```powershell
nu scripts/tools/shell/scripts/winclean.nu --help
```

Le script supprime le contenu des dossiers temporaires utilisateur et Windows
(entrées de plus d'un jour) et les artefacts OTA NVIDIA, puis agit sur le
système via `powercfg`, `fsutil`, `bcdedit` et `defrag` sans console propre, et
peut générer un index de `C:` avec `fd.exe`. `--skip-index` omet uniquement
l'indexation. Les caches de registre Cargo et sccache sont conservés
(décision du 1er octobre) : le script ne les purge plus.

`--dry-run` affiche chaque action sans rien modifier. Sans cette option, le
script exige une session élevée (`sudo nu scripts/tools/shell/scripts/winclean.nu`)
et refuse de s'exécuter sinon. Chaque étape est individuellement rapportée
(succès ou code de sortie et raison), et le compte des échecs est visible dans
la sortie : le message de fin reflète l'état réel de chaque étape plutôt que
de masquer les erreurs des commandes externes.

## Configuration du poste et plugins

Aucun `env.nu`, `config.nu`, registre de plugins ni binaire de plugin n’est
versionné dans ce dépôt. Ces éléments appartiennent au profil personnel du poste.
Le guide du workspace recense les plugins et leurs versions effectivement
installées, les complétions Git/Cargo importées depuis `nu_scripts`, les alias,
ainsi que les variables de configuration GitHub, Google Cloud, OVH et Aphrody.
Les identifiants et fichiers ADC restent locaux et ne doivent jamais être copiés
dans ce dépôt.

## Validation et maintenance

Pour vérifier rapidement la version intégrée et le chargement des scripts sans
les exécuter :

```sh
nu --version
nu --no-config-file -c 'version'
```

Avant de modifier les dépendances Nushell embarquées, conserver une version
cohérente entre `nu-command`, `nu-cmd-extra`, `nu-cmd-lang`, `nu-engine`,
`nu-parser`, `nu-protocol` et `nu-std` dans le workspace Cargo. `nu-cli` et les
plugins interactifs restent des outils externes installés via Infra. Pour les
scripts, vérifier la syntaxe sous Nushell 0.115+ et revoir les chemins touchés
avant de lancer une opération qui supprime des données.

## Références

- [Guide Nushell du workspace](../workspace/nu.md)
- [Nushell book](https://www.nushell.sh/book/)
- [Plugins Nushell](https://www.nushell.sh/book/plugins.html)
- [Commandes du noyau Aphrody](./COREUTILS-OS-INTEGRATION.md)
- [Backend PTY](../../products/shell/terminal/README.md)
