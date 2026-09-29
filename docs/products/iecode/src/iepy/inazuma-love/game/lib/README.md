# Bibliothèques tierces

Ren'Py n'a pas de gestionnaire de paquets : une bibliothèque, c'est des `.rpy` (ou
des modules Python) copiés dans `game/`. Ce dossier tient le registre de ce qui a
été copié, d'où, et de ce qui a été modifié — sans quoi une mise à jour amont
devient indevinable.

Rien ici n'est du code du projet. Ne pas y corriger un bug métier : corriger en
amont, ou envelopper côté `inazuma-love`.

## Encyclopaedia — `game/encyclopaedia/`

| | |
|---|---|
| Origine | https://github.com/jsfehler/renpy-encyclopaedia |
| Version | 3.6.0 (`cefdc6b`, branche `master`) |
| Licence | MIT — `game/encyclopaedia/LICENSE.md` |
| Exige | Ren'Py ≥ 8.1 |

**Pas dans `lib/` :** l'amont impose que le dossier `encyclopaedia/` soit
directement sous `game/` — ses modules `*_ren.py` s'importent en relatif et
Ren'Py doit voir le paquet à cette place. Le déplacer casse les imports.

Copié tel quel : aucune modification. Le dossier `docsgame_source/` de l'amont
(projet de démonstration) n'a **pas** été repris — il livre ses propres
`screens.rpy`, `gui.rpy` et `options.rpy`, qui écraseraient ceux du projet.

Utilisé par `game/encyclopedie.rpy`, qui construit les entrées depuis
`casting.json` et le catalogue local — aucun contenu n'est écrit dans le code.

## Kinetic Text Tags — `game/lib/kinetic_text_tags/`

| | |
|---|---|
| Origine | https://github.com/SoDaRa/Kinetic-Text-Tags |
| Version | `e590260` (pas de release taguée en amont) |
| Licence | MIT — `LICENSE` |

Cinq fichiers de bibliothèque repris : `kinetic_text_tags.rpy`,
`atl_text_tag.rpy`, `glitch_tag.rpy`, `gradient_tags.rpy`, `explosion_text.rpy`.
Les `gui.rpy`, `options.rpy`, `screens.rpy` et `script.rpy` de l'amont sont ceux
de sa démo : non repris.

Apporte des balises de texte (`{shake}`, `{bounce}`, `{glitch}`, dégradés…)
utilisables **directement dans les JSON de scénario**, sans passer par le code —
c'est pourquoi cette bibliothèque-là convient au projet.

### Modifications locales

Trois écarts par rapport à l'amont, marqués `ADAPTÉ` dans le code :

1. `ChaosText.font_list` citait les polices de la démo (`TurretRoad-*.ttf`,
   `Pacifico`, …), absentes d'ici : la balise `{chaos}` plantait. Pointée sur les
   polices livrées dans `game/fonts/`.
2. Cinq comparaisons `is` / `is not` contre des littéraux (`0`, `""`) remplacées
   par `==` / `!=`. Bug amont : elles marchent par accident de l'internement
   CPython, et Python émet un `SyntaxWarning` à chaque lancement.
3. Les en-têtes de licence étaient des blocs `"""…"""` en tête de fichier.
   Dans un `.rpy`, Ren'Py lit ça comme une réplique du narrateur : quatre
   « unreachable statements » au lint, et huit fausses répliques dans les
   statistiques et l'extraction des traductions. Convertis en commentaires `#`,
   texte inchangé.

## Lucide — `game/fonts/Lucide.ttf`

| | |
|---|---|
| Origine | https://lucide.dev (paquet `lucide-static`) |
| Version | 1.38.0 |
| Licence | ISC — `game/fonts/LICENSE-Lucide.txt` |

Police d'icônes, rangée avec les autres polices plutôt qu'ici : `theme.rpy` la
monte dans le même `FontGroup` que Geist et Source Han Sans. Détail du découpage
par plage et de la table de points de code dans `game/fonts/README.md`.

Seule la police est reprise ; les SVG, sprites et feuilles de style du paquet ne
servent pas à un jeu Ren'Py.

## Écarté après examen

* **[renpy-achievement](https://github.com/shawna-p/renpy-achievement)** — la
  bulle de succès est en dur aux couleurs Xbox (vert/citron), incompatible avec
  la palette `AZ`, et déclare une dizaine de noms globaux (`circle_size`,
  `green_circle`, `trophy_bg`…). Le module `achievement` du moteur fait déjà tout
  le travail de fond ; la bulle est écrite dans `game/extras.rpy`, au thème du
  projet, en une vingtaine de lignes.
* **[renpy/dse](https://github.com/renpy/dse)** — Dating Sim Engine officiel,
  figé depuis 2019 et écrit pour Ren'Py 6.
* **[renpy-gallery-inject](https://github.com/Numerlor/renpy-gallery-inject)** —
  GPL-3.0, et destiné à modder les jeux des autres, pas à équiper le sien.
