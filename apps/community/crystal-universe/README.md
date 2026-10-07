<!-- SPDX-License-Identifier: Apache-2.0 -->

# Dragon Pixel — proposition pour Omar

Mini-jeu original jouable dans un navigateur : combattant personnalisable, arène
2D, combos, sauts, projectiles, charge d'énergie et transformation de huit secondes.
Cinq vagues d'adversaires IA, score, victoire/défaite, pause et reprise.
Trois styles (équilibré, vitesse, puissance) et couleur personnalisable.
Clavier, manette Gamepad API et sept boutons tactiles avec gestion des pointeurs simultanés.
Atelier d'avatar avec nom, race, coiffure et couleurs de peau, cheveux et tenue;
le choix est conservé dans le stockage local du navigateur.
Les archives Shenron permettent de chercher soit tout le RAG, soit les passages
OCR sourcés du manga Dragon Ball et Dragon Ball Super.

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
Manette standard : stick gauche ou croix directionnelle, A saut, X combo, B
projectile, Y charge, LB transformation, Start pause/reprise.

La section **Carte d’expédition · AGE 1000** est un schéma Canvas original de West City
et de ses voies d’accès. Elle utilise seulement les descriptions officielles (campus,
quartiers urbains, complexe Capsule, esplanade et mission glaciaire) ; aucun asset ni
capture du jeu n’est incorporé. Source structurelle : `age1000-map.js`.

```sh
bun test apps/community/crystal-universe/engine.test.js
oxlint --deny-warnings apps/community/crystal-universe/*.js
oxfmt --check apps/community/crystal-universe
```

Téléchargements Android, preuves et limites :
[rapport d'exécution](../../../docs/operations/omar-crystal-universe.md).
