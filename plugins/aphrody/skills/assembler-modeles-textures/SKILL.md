---
name: assembler-modeles-textures
description: "Assemble NIE (IEVR) 3D parts and textures (materials, UV, skeleton, GLB export) with the existing parsers: body/face/outfit seams, atlases, missing parts. Use when parts must be combined; not for writing a new parser."
---

# Assembler modèles et textures

> **S'applique quand :** la copie IECODE (racine contenant le dossier crates/nie) est le répertoire de travail et les fichiers du jeu sont disponibles ; les chemins préfixés `iecode:` sont relatifs à cette racine. **Sinon :** travailler uniquement à partir des fichiers fournis, dire quelle vérification (parseur, VFS, rendu) n'a pas pu être exécutée, ne pas deviner d'identifiant.

Lire `../ievr-terminologie/SKILL.md`, les fiches modèles et textures de `../formats-level5/SKILL.md`, puis [les points d’entrée locaux](../creer-assets-3d/references/outils-locaux.md). Ancrer chaque association dans les données et préserver les sources.

## Construire l’assemblage

1. Identifier la cible exacte et ses pièces via les outils VFS/catalogue existants. Relever pour chaque pièce le chemin, l’empreinte, le rôle attendu et la preuve de l’association. Un préfixe de nom ou une ressemblance visuelle constitue une hypothèse jusqu’à vérification ; ne pas substituer silencieusement une pièce voisine.
2. Lire géométrie et métadonnées ensemble ; relever matériaux, indices, UV, squelette, pondérations et transformations disponibles. Pour les assets Level-5, conserver la distinction G4MD/G4MG et vérifier leurs chemins. Une pièce absente doit apparaître comme telle dans le bilan.
3. Réutiliser `iecode:crates/nie/aphrody-nie-formats/src/assemble.rs` pour l’assemblage, `aphrody-nie-wasm` pour le décodage navigateur, et les importeurs Blender existants pour la retouche. Examiner leurs signatures et capacités réelles ; ne pas réécrire le parseur en TypeScript ou dans un script Blender pour contourner une donnée non comprise.
4. Établir la chaîne primitive → matériau → texture → image. Vérifier l’atlas, la région UV, les dimensions, le canal alpha et le rôle de chaque image. Ne pas déduire qu’une texture de masque est une texture de couleur. Toute interprétation d’un canal doit venir du code, de l’asset ou d’une comparaison discriminante.
5. Contrôler les espaces de coordonnées, la pose de repos et les rattachements avant de fusionner les pièces. Vérifier unités, échelle, axes, matrices et compatibilité des os. Une translation esthétique qui masque un défaut de pose de repos ne démontre pas sa correction.
6. Exporter un candidat distinct. Vérifier les fichiers référencés, les dimensions et bornes géométriques, les indices de matériaux et la présence des textures réellement nécessaires. Conserver la table d’association et les transformations avec l’export.

## Prouver l’intégration

Ouvrir le candidat dans le consommateur demandé : Blender, éditeur NIE ou explorateur. Observer au minimum les raccords concernés, la face et une autre orientation révélant les occlusions. Pour un asset animé, vérifier une pose ou animation pertinente dans un consommateur qui la prend effectivement en charge.

Utiliser `../peaufiner-rendu-3d/SKILL.md` pour les défauts restants. Si seul le parseur ou un rendu statique a été exécuté, le dire ; ne pas annoncer une animation, une réimportation dans le jeu ou une fidélité pixel à pixel sans preuve correspondante.

Livrer les chemins des sorties, les associations confirmées et incertaines, les captures et les éléments manquants. Ne pas empaqueter ni publier les données originales du jeu dans le plugin.
