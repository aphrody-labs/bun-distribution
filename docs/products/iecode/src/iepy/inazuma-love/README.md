# Inazuma Otome

Visual novel otome construit sur **iepy**, un fork de Ren'Py.

Le dépôt ne contient **aucune histoire écrite en dur** et **aucun asset** : c'est un
moteur. Le contenu narratif vit dans des fichiers de données que l'équipe écrit et
modifie sans toucher au code, et l'habillage (voix, visages, musique, noms) est
chargé depuis l'installation locale de la personne qui joue.

## Ce que l'équipe écrit

| Fichier | Contenu |
|---|---|
| `game/scenario/*.json` | Les chapitres : scènes, répliques, choix, matchs. Format documenté dans `game/scenario/SCHEMA.md` |
| `game/casting.json` | Les rôles : identifiant, nom par langue, couleur, code de voix. Optionnel |
| `game/locales/{fr,en,ja}.json` | Les libellés de l'interface |

`game/scenario/00-gabarit.json` est un fichier vide à dupliquer : il ne raconte rien,
il montre le format.

## Trois langues

Toute l'interface existe en français, anglais et japonais, sur le même modèle que
niers et azalée : un JSON par langue. Chaque texte de scénario accepte aussi la forme
localisée :

```json
"texte": { "fr": "…", "en": "…", "ja": "…" }
```

Une langue absente retombe sur le français puis sur la première disponible : une
réplique non traduite s'affiche quand même, elle ne bloque pas.

Quand un dump local de textes du jeu est présent (`game/nie/textes/<langue>.json`),
`T("0x…")` résout un libellé par hash pour coller à la terminologie d'origine.

## Assets locaux

Depuis le dépôt niers, sur une machine où le jeu est installé :

```bash
niers vn casting --genre f --limit 20          # qui est doublé, et sous quel nom
niers vn export --out <ce-projet>/game/nie \
    --noms "…,…" --voix-max 16                 # voix, expressions, musique
```

L'export écrit `game/nie/catalogue.json` et les fichiers qui vont avec. Ce dossier est
gitignoré : rien de ce qui vient d'une installation ne rentre dans le dépôt.

Sans catalogue, le jeu démarre quand même — décors procéduraux, aucune voix, aucun
médaillon. L'écran **Assets du jeu** dit en une page ce qui est branché.

## Lancer

```bash
# runtime Ren'Py 8.6.0
<sdk>/lib/py3-windows-x86_64/python.exe renpy.py inazuma-otome

# vérification statique
<sdk>/renpy.exe <chemin>/inazuma-otome lint
```

## Le match

Mini-jeu au tour par tour, déclenché par une scène qui porte un champ `match`. Une
décision par tour : passer, dribbler, tirer, technique (coûte de la FP), ou presser
quand l'équipe n'a pas le ballon. Les effectifs viennent du casting et de la scène,
jamais du code.

## Structure

| Fichier | Rôle |
|---|---|
| `game/core.rpy` | Moteur : charge les scénarios, joue les scènes, vérifie les renvois |
| `game/otome.rpy` | Casting, affection, médaillons, écrans « Liens » et « Voix » |
| `game/i18n.rpy` | Trois langues, résolution par hash sur le dump local |
| `game/match.rpy` | Mini-jeu de match |
| `game/nie_pont.rpy` | Lecture du catalogue d'assets locaux |
