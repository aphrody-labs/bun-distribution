<!-- SPDX-License-Identifier: Apache-2.0 -->

# Édition de code en masse

`yolo workspace code-edit` combine la sélection de fichiers par `rg`,
le remplacement textuel par `sd`, les motifs AST par `ast-grep` et les
transforms JS/TS existants par `jscodeshift`. L'aperçu est le comportement
par défaut; `--apply` applique les modifications. Les outils doivent être
installés: `rg` et `sd` sur PATH, les paquets ast-grep/jscodeshift via Bun.

```sh
# Sélection et recherche littérale
yolo workspace code-edit search --root ./src --glob '*.ts' --find ancien

# Remplacement littéral; retirer --apply pour afficher l'aperçu
yolo workspace code-edit replace --root ./src --glob '*.ts' \
  --find ancien --with nouveau --apply

# Ajout avant/après chaque occurrence, suppression
yolo workspace code-edit add-before --root ./src --find 'foo()' --with 'await '
yolo workspace code-edit add-after --root ./src --find 'foo()' --with '; bar()'
yolo workspace code-edit remove --root ./src --find 'obsolete();' --apply

# Regex; les captures $1/$2 sont utilisables dans replace
yolo workspace code-edit replace --engine regex --root ./src \
  --find 'old_(\w+)' --with 'new_$1'

# Transformation syntaxique: le même motif fonctionne malgré les espaces
yolo workspace code-edit replace --engine ast --root ./src --glob '*.ts' \
  --lang ts --find 'oldCall($A)' --with 'newCall($A)' --apply

# Codemod propriétaire existant, parser JSX/TypeScript
yolo workspace code-edit replace --engine codemod --root ./src \
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

## Renommage et restauration par YOLO

Le moteur natif `packages/engine/yolo` possède le renommage de contenu et de chemins.
Workspace lui délègue ces opérations sans dupliquer son implémentation.
`--yolo-root` ou `APHRODY_YOLO_ROOT` permet de sélectionner un autre checkout.

```sh
# Plan: fichiers, identifiants et chemins
yolo workspace code-edit rename --root /chemin/depot \
  --find '@ancien/' --with '@nouveau/' --glob '**/*.ts' --paths

# Appliquer après inspection du plan
yolo workspace code-edit rename --root /chemin/depot \
  --find '@ancien/' --with '@nouveau/' --paths --apply

# Aperçu puis application de la restauration du journal YOLO
yolo workspace code-edit restore --journal /chemin/rename.jsonl
yolo workspace code-edit restore --journal /chemin/rename.jsonl --apply
```

Les règles d'identifiants, le contrôle des collisions et le format des journaux
appartiennent à YOLO. `--glob '!motif'` se traduit en exclusion et les autres
globs en inclusions. Le journal de renommage est une sauvegarde locale du
contenu: il reste dans le store privé de YOLO, hors des fichiers sources.
YOLO vérifie toutes les destinations avant écriture, conserve les octets et
permissions d'origine et refuse la restauration si un fichier a été modifié
depuis. Les écritures sont atomiques par fichier; l'ensemble des fichiers ne
forme pas une transaction atomique. Une interruption peut laisser une
application partielle récupérable par le journal et des dossiers vides.
