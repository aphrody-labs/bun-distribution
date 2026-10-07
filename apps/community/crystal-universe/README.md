<!-- SPDX-License-Identifier: Apache-2.0 -->

# Dragon Pixel — proposition pour Omar

Mini-jeu original jouable dans un navigateur : combattant personnalisable, arène
WebGPU 3D avec repli Canvas 2D, combos, sauts, projectiles, charge d'énergie et
transformation de huit secondes.
Cinq vagues d'adversaires IA, score, victoire/défaite, pause et reprise.
Trois styles (équilibré, vitesse, puissance) et couleur personnalisable.
Clavier, clic/glisser souris, manette Gamepad API et sept boutons tactiles avec
gestion des pointeurs simultanés.
Atelier d'avatar avec nom, race, coiffure et couleurs de peau, cheveux et tenue;
le choix est conservé dans le stockage local du navigateur.
Les archives Shenron permettent de chercher soit tout le RAG, soit les passages
OCR sourcés du manga Dragon Ball et Dragon Ball Super.

Le prototype s'inspire de conventions générales de jeux d'arène et reste entièrement
original. Aucun graphisme, personnage ou code de jeux commerciaux n'est copié.

Depuis la racine du checkout :

```sh
bun apps/community/crystal-universe/serve.js
```

Pour le mode multijoueur local, démarrer aussi le service Rust dans un autre terminal :

```sh
bun scripts/build/rust/vps-cargo.ts run -- run -p aphrody-web-game-server
```

Construire le cœur de combat WASM avant de lancer le navigateur :

```sh
bun scripts/build/rust/wasm-package.ts --crate aphrody-dragon-pixel-wasm --out target/wasm-package-stage/aphrody-dragon-pixel-wasm --name dragon-pixel-wasm
```

Ouvrir `http://127.0.0.1:4317/`, choisir le style, puis **Jouer / Recommencer**.
Le serveur de jeu écoute par défaut sur `127.0.0.1:4320`, limite les salles à
quatre joueurs et conserve leur état en mémoire. Chaque joueur rejoint le même code
de salle pour voir les avatars des autres. Le cœur de simulation Rust est partagé
entre le client WASM et le service natif; le serveur maintient également un état de
combat de salle à partir des entrées reçues. Le mode reste jouable en solo si Rust
n'est pas démarré. Aucun déploiement public, compte utilisateur ou stockage réseau
n'a été configuré.

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
