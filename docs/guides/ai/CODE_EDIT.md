<!-- SPDX-License-Identifier: Apache-2.0 -->

# Édition de code en masse

`aphrody-workspace code-edit` combine la sélection de fichiers par `rg`,
le remplacement textuel par `sd`, les motifs AST par `ast-grep` et les
transforms JS/TS existants par `jscodeshift`. L'aperçu est le comportement
par défaut; `--apply` applique les modifications. Les outils doivent être
installés: `rg` et `sd` sur PATH, les paquets ast-grep/jscodeshift via Bun.

```sh
# Sélection et recherche littérale
aphrody-workspace code-edit search --root ./src --glob '*.ts' --find ancien

# Remplacement littéral; retirer --apply pour afficher l'aperçu
aphrody-workspace code-edit replace --root ./src --glob '*.ts' \
  --find ancien --with nouveau --apply

# Ajout avant/après chaque occurrence, suppression
aphrody-workspace code-edit add-before --root ./src --find 'foo()' --with 'await '
aphrody-workspace code-edit add-after --root ./src --find 'foo()' --with '; bar()'
aphrody-workspace code-edit remove --root ./src --find 'obsolete();' --apply

# Regex; les captures $1/$2 sont utilisables dans replace
aphrody-workspace code-edit replace --engine regex --root ./src \
  --find 'old_(\w+)' --with 'new_$1'

# Transformation syntaxique: le même motif fonctionne malgré les espaces
aphrody-workspace code-edit replace --engine ast --root ./src --glob '*.ts' \
  --lang ts --find 'oldCall($A)' --with 'newCall($A)' --apply

# Codemod propriétaire existant, parser JSX/TypeScript
aphrody-workspace code-edit replace --engine codemod --root ./src \
  --glob '*.tsx' --lang tsx --transform /chemin/transform.ts
```

Les filtres `--glob` sont répétables et suivent la syntaxe ripgrep, par exemple
`--glob '*.ts' --glob '!*.test.ts'`. Les règles d'ignore sont respectées; les
fichiers binaires contenant NUL et les liens symboliques sont exclus. La commande
ne cible jamais un fichier extérieur à `--root`. Les arguments sont transmis
sans interprétation shell; conserver les quotes simples autour des captures `$`.

En AST, les ajouts sont exprimés dans un modèle de remplacement complet.
En codemod, seul `replace --transform` est accepté: le transform décide des
ajouts, retraits et réécritures. L'aperçu du codemod utilise `--dry --print`;
son code est exécuté et doit être un transform propriétaire de confiance.
L'application se fait par lots de 100 fichiers; une erreur arrête les lots
suivants, mais ne restaure pas les lots déjà écrits. Examiner le diff puis
exécuter les gates du propriétaire et Oxfmt sur les fichiers modifiés.
