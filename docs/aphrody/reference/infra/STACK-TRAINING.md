# Stack training registry

`tools/config/stack-training.json` est la mémoire opérationnelle de l’orchestrateur,
pas un modèle entraîné avec des secrets. Elle enregistre les dépôts de
référence et les packages à meilleur ratio valeur/réutilisation pour décider
des builds et intégrations.

## Règle

Avant d’ajouter une dépendance, l’orchestrateur consulte ce registre :

1. réutiliser une capacité déjà présente dans RG ou dans un dépôt catégorie
   Aphrody (`aphrody-ai`, `aphrody-os`, `aphrody-ui`, `aphrody-web` où réside
   BXC, `aphrody-compat`, `aphrody-contracts`, `aphrody-shell`,
   `aphrody-native`) ;
2. préférer un package Aphrody publié et documenté lorsque le rôle correspond ;
3. garder le code métier dans son dépôt propriétaire ;
4. refuser les copies vendorisées sans provenance et les runtimes concurrents ;
5. mettre à jour la preuve de version à chaque release.

Le registre exclut explicitement secrets, cookies, bases, artefacts de build et
données utilisateur. Il peut être indexé par le RAG d’Aphrody sans exfiltration
de runtime.

## Registre des dépôts

`repositories` est aussi le registre des dépôts vivants : `aphrody-infra
validate` refuse tout `sourceRepo` du catalogue de services, clé
`policies.applicationRoots`, dépôt source ou consommateur de
`tools/config/local-ai.json` et étape de `tools/config/pipeline.json` qui n’y figure pas.
`retiredRepositories` liste les dépôts retirés (le monolithe `aphrody`, scindé
le 2026-09-25) et leurs successeurs ; les nommer est une erreur explicite.
