# Material Design 3

## Principes

Material Design 3 organise l'interface autour de composants réutilisables et
de tokens sémantiques. Les tokens décrivent l'intention visuelle, tandis que
les composants appliquent ces valeurs à leur structure et à leurs états.

## Couleur

Les rôles de couleur distinguent notamment la surface, le contenu, les
contours et les couleurs d'accent. Une paire claire/sombre doit conserver un
contraste lisible et des relations cohérentes entre les rôles.

## États et interaction

Les composants exposent des états explicites : repos, survol, focus, pression,
sélection, désactivation et erreur. Les états ne doivent pas dépendre d'une
couleur isolée ; ils doivent rester identifiables avec un contraste adapté.

## Thèmes

Un thème regroupe les tokens de couleur, typographie, forme et élévation. Les
packages de tokens produisent les valeurs consommées par les composants et les
feuilles de style. Les applications peuvent définir une source de couleur
personnalisée sans modifier les composants.

## Développement avec m3-bun

`m3-bun` fournit l'outillage Bun pour lancer les vérifications, les tests et
les commandes de développement des packages M3. Il ne définit pas le modèle
de conception ; il l'exécute et le distribue.
