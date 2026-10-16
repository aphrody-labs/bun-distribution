# PNGTuber-Plus : raccourcis en combinaison (Ctrl / Maj / Alt + touche)

Patch source pour [PNGTuber-Plus](https://github.com/kaiakairos/PNGTuber-Plus) : les raccourcis
de costumes et les toggles de sprites acceptent une touche plus des modificateurs, par exemple
`Ctrl+Shift+P`. Les raccourcis simples et les sauvegardes existantes continuent de fonctionner.

## Base et licence

- Dépôt : `kaiakairos/PNGTuber-Plus`, branche `master`, commit
  `3173b213681152eb7fca55c63e757cfc42d2eb44` ("1.4.5", 2024-03-26, tête de `master` au 2026-10-06).
- Moteur : Godot 4.1 (`config/features = "4.1", "GL Compatibility"` dans `project.godot`).
  Testé avec Godot 4.1.4-stable. Godot 3.x est inadapté ; 4.2 et plus non testé.
- Licence : Unlicense (domaine public), fichier `LICENSE` d'upstream, non modifié. Le patch est un
  dérivé de trois fichiers upstream : `main_scenes/main.gd`, `ui_scenes/settings/settings_menu.gd`,
  `ui_scenes/spriteEditMenu/sprite_viewer.gd`. Aucune scène `.tscn` ni binaire n'est modifié.

## Ce qui change

Les raccourcis ne passent pas par les évènements Godot (`InputEventKey`) : upstream lit le clavier
globalement (fenêtre en arrière-plan) via l'extension native `BackgroundInputCapture`, qui envoie
le signal `bg_key_pressed(node, keys_pressed)` avec un dictionnaire `{code touche Godot: bool}` à
chaque changement d'état. Dans la DLL Windows livrée (lecture du désassemblage, non exécutée) : un
`GetAsyncKeyState` par touche, Ctrl/Maj/Alt = `KEY_CTRL`/`KEY_SHIFT`/`KEY_ALT`, touche Windows =
`KEY_MASK_META`.

Le patch construit depuis ce dictionnaire une chaîne `Ctrl+Shift+P` (modificateurs tenus dans l'ordre
Ctrl, Shift, Alt, Meta, puis la touche) et la compare à la chaîne enregistrée. Un raccourci reste donc
une chaîne, comme avant. API vérifiées dans la doc Godot 4.1 : `OS.get_keycode_string(Key)`,
`KEY_CTRL = 4194326`, `KEY_SHIFT = 4194325`, `KEY_ALT = 4194328`, `KEY_META = 4194327`,
`Dictionary.get/has/values`, `Array.is_empty`, `String.ends_with/strip_edges`.

## Appliquer

```
git clone https://github.com/kaiakairos/PNGTuber-Plus && cd PNGTuber-Plus
git checkout 3173b213681152eb7fca55c63e757cfc42d2eb44
git apply --check --whitespace=nowarn /chemin/hotkey-combos.patch
git apply --whitespace=nowarn /chemin/hotkey-combos.patch      # annuler : git apply -R ...
```

`--whitespace=nowarn` : l'indentation d'upstream contient des lignes blanches faites de tabulations.
Lancer : ouvrir `project.godot` avec Godot 4.1.x, F5. Exporter : Projet > Exporter avec les presets
d'upstream (`export_presets.cfg`) et les modèles d'export 4.1.x correspondants (non testé).
L'extension native `bin/*` est celle d'upstream, inchangée.

## Utilisation

- Costumes : menu des réglages (mode vue), clic sur "costume N key", maintenir Ctrl/Maj/Alt puis presser
  la touche. Libellé : `costume 3: "Ctrl+Shift+P"` (le mot "key" est omis au-delà de 10 caractères
  pour ne pas déborder du bouton). La croix remet `null`.
- Toggle d'un sprite : mode édition, sprite sélectionné, bouton "toggle", même geste.
- Un clic souris hors du menu annule la saisie (comportement upstream conservé).

## Comportement

| Raccourci enregistré                         | Touches tenues                     | Déclenche                |
| -------------------------------------------- | ---------------------------------- | ------------------------ |
| `P`                                          | `P`                                | oui                      |
| `P`                                          | `Ctrl+P`                           | non (upstream : oui)     |
| `Ctrl+P`                                     | `Ctrl+P`                           | oui                      |
| `Ctrl+P`                                     | `Ctrl+Shift+P`                     | non                      |
| `Ctrl+Shift+P`                               | `Ctrl+P`                           | non                      |
| `Ctrl+Shift+P`                               | Shift, Ctrl puis P (ordre libre)   | oui                      |
| `Ctrl` (ancienne liaison, modificateur seul) | `Ctrl` seul                        | oui (conservé)           |
| saisie en cours                              | `Ctrl` seul, ou `Ctrl+Shift` seuls | ignoré, attend la touche |
| saisie en cours                              | `P` seul                           | enregistre `P`           |

Autres points : après une saisie, la liaison est figée jusqu'au relâchement de toutes les touches
(lâcher Ctrl avant P ne l'écrase pas) ; les noms de touches sont ceux de Godot (`Space`, `F1`, `Plus`,
`Keycode1` pour le clic gauche) ; plusieurs touches non modificatrices tenues déclenchent chacune leur
liaison, comme avant.

## Format de sauvegarde

Inchangé, aucun champ ajouté ni renommé : `costumeKeys` dans `user://settings.pngtp` (liste de chaînes)
et `toggle` de chaque sprite dans l'avatar (chaîne). Une combinaison est simplement la chaîne
`"Ctrl+Shift+P"`. Les anciens fichiers se chargent tels quels. Lu dans le code, non testé : un fichier
avec combinaison ouvert dans un upstream non patché ne déclenche rien, sans erreur.

## Limites

- Changement de comportement : une liaison simple (`P`) ne se déclenche plus quand Ctrl/Maj/Alt/Windows
  est tenu. Exception : l'ancienne liaison `Meta+` (touche Windows seule) n'est plus déclenchée ni saisissable.
- Capture clavier globale : seule la DLL Windows a été lue. Pas de distinction gauche/droite
  (Ctrl/Maj/Alt génériques). Dans la bibliothèque Linux, seul `/dev/input/mice` (souris) apparaît dans les chaînes : capture
  clavier hors Windows non vérifiée.
- Une liaison = une touche + modificateurs (pas de séquence).
- Fenêtre au premier plan, les actions internes d'upstream ignorent les modificateurs : `P` (lier, mode
  édition avec sprite), `Q`, `E`, `R`, `U`, `W/A/S/D`, `O`, Échap, `Ctrl+L`. Éviter ces touches finales.
- Largeur des libellés non vérifiée à l'écran (police par défaut, bouton de 195 px).

## Testé / Non testé

Testé :

- `git apply --check`, `git apply` et `git apply -R` sur les fichiers upstream au SHA ci-dessus ; résultat
  identique octet pour octet au projet utilisé pour les tests.
- Syntaxe : `gdparse` de gdtoolkit 4.5.0 (syntaxe Godot 4) OK avant et après ; `gdlint` n'ajoute que des
  catégories déjà présentes partout dans upstream (noms camelCase, ordre des définitions, espaces de fin).
- Godot 4.1.4-stable (binaire officiel, sha512 vérifié), headless, sur le projet upstream complet patché :
  chargement des trois scripts avec leurs autoloads, 56 assertions (`test/run.gd`) sur la construction des
  chaînes, la correspondance exacte, la saisie des costumes (modificateur d'abord, relâchement dans le
  désordre, annulation par clic), la saisie du toggle via le vrai `_on_set_toggle_pressed`, l'identité
  des chaînes de touches simples avec l'ancienne expression (60 codes), les libellés. Lancer :
  copier `test/` à la racine du projet, `godot --headless --path . res://test/run.tscn`. Des erreurs
  d'import de textures et de micro apparaissent en headless sans rapport ; seuls `TOTAL n FAILS 0` et le
  code de sortie 0 comptent.

Non testé :

- L'application complète avec l'extension native et de vraies frappes (pas de session graphique ni de
  Windows ici) : les états de touches sont simulés d'après la lecture de la DLL, pas capturés.
- `Ctrl+Shift+P` tapé sur un clavier réel, AZERTY/AltGr, touche Windows, Linux/macOS, export, capture OBS.
- Rendu des libellés, débordement éventuel.
- Godot 4.2 et plus.

`test/` : harnais écrit pour ce patch, hors upstream.
