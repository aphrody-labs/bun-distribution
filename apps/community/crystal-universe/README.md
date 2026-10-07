<!-- SPDX-License-Identifier: Apache-2.0 -->

# Crystal Universe — proposition pour Omar

Mini-jeu original jouable dans un navigateur : combattant personnalisable, arène
2D, combos, sauts, projectiles, charge d'énergie et transformation de huit secondes.
Cinq vagues d'adversaires IA, score, victoire/défaite, pause et reprise.
Trois styles (équilibré, vitesse, puissance) et couleur personnalisable.
Clavier et sept boutons tactiles avec gestion des pointeurs simultanés.

La proposition fusionne la charge/transformation et le combat d'arène de Dragon
Crystal avec la personnalisation et l'invasion par vagues de Warriors of the
Universe. Ce prototype est solo ; les services multijoueurs des jeux originaux
ne sont pas intégrés. Aucun graphisme, personnage ou code de ces jeux n'est copié.

Depuis la racine du checkout :

```sh
bun apps/community/crystal-universe/serve.js
```

Ouvrir `http://127.0.0.1:4317/`, choisir le style, puis **Jouer / Recommencer**.
Le serveur reste local. Aucun déploiement public n'a été effectué.

Flèches ou Q/D : déplacement ; Espace : saut ; J : combo ; K : projectile ;
L : charge ; T : transformation ; P : pause. Les commandes sont aussi affichées
dans le jeu. Une perte de focus ou le passage en arrière-plan met en pause.

```sh
bun test apps/community/crystal-universe/engine.test.js
oxlint --deny-warnings apps/community/crystal-universe/*.js
oxfmt --check apps/community/crystal-universe
```

Téléchargements Android, preuves et limites :
[rapport d'exécution](../../../docs/operations/omar-crystal-universe.md).
