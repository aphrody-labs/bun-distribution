---
version: alpha
name: DBFR
description: >-
  Système graphique de dragonballfr.com — encyclopédie Dragon Ball francophone.
  Nuit profonde, or signature, et un contraste serif/sans qui fait lire une
  fiche comme un article plutôt que comme un formulaire.
colors:
  bg: "#0a0a0a"
  surface: "#141410"
  border: "#2a2a26"
  primary: "#ffb200"
  primary-pressed: "#d99700"
  on-primary: "#0a0a0a"
  on-bg: "#ffffff"
  on-bg-muted: "#cdcdcd"
  ember: "#ff6b1a"
  ki: "#4ba8ff"
  amber: "#ffd23f"
  critical: "#ff0000"
  namek: "#16a34a"
  transformation: "#a855f7"
  saiyan: "#ffea00"
  affiliation: "#22d3ee"
  curiosite: "#ec4899"
typography:
  display-hero:
    fontFamily: Newsreader
    fontSize: 3.5rem
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -0.02em
  h1:
    fontFamily: Newsreader
    fontSize: 2.1rem
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: -0.02em
  h2:
    fontFamily: Newsreader
    fontSize: 1.6rem
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: -0.02em
  h3:
    fontFamily: Google Sans Flex
    fontSize: 1.16rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Google Sans Flex
    fontSize: 1.06rem
    fontWeight: 400
    lineHeight: 1.75
  body-md:
    fontFamily: Google Sans Flex
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.6
  quote:
    fontFamily: Newsreader
    fontSize: 1.16rem
    fontWeight: 400
    lineHeight: 1.6
  label-caps:
    fontFamily: Google Sans Flex
    fontSize: 0.82rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0.08em
  meta-mono:
    fontFamily: JetBrains Mono
    fontSize: 0.78rem
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.07em
  jp:
    fontFamily: Noto Sans JP
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  section: 96px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.full}"
    padding: 28px
    height: 48px
  button-primary-hover:
    backgroundColor: "#ffffff"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.on-bg}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.full}"
    height: 48px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-bg}"
    rounded: "{rounded.lg}"
    padding: 20px
  badge:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.meta-mono}"
    rounded: "{rounded.full}"
    padding: 8px
  eyebrow:
    textColor: "{colors.primary}"
    typography: "{typography.meta-mono}"
  article-body:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.on-bg-muted}"
    typography: "{typography.body-lg}"
    width: 72ch
  table-header:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.on-bg-muted}"
    typography: "{typography.meta-mono}"
  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  badge-critical:
    backgroundColor: "{colors.critical}"
    textColor: "{colors.on-primary}"
    typography: "{typography.meta-mono}"
    rounded: "{rounded.sm}"
  hero-aura:
    backgroundColor: "{colors.ember}"
  ki-gauge:
    backgroundColor: "{colors.ki}"
    textColor: "{colors.on-primary}"
  ki-gauge-peak:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.on-primary}"
  pill-rubrique-histoire:
    backgroundColor: "{colors.namek}"
    textColor: "{colors.on-primary}"
    typography: "{typography.meta-mono}"
    rounded: "{rounded.full}"
  pill-rubrique-transformations:
    backgroundColor: "{colors.transformation}"
    textColor: "{colors.on-primary}"
    typography: "{typography.meta-mono}"
    rounded: "{rounded.full}"
  pill-rubrique-anecdotes:
    backgroundColor: "{colors.saiyan}"
    textColor: "{colors.on-primary}"
    typography: "{typography.meta-mono}"
    rounded: "{rounded.full}"
  pill-rubrique-affiliations:
    backgroundColor: "{colors.affiliation}"
    textColor: "{colors.on-primary}"
    typography: "{typography.meta-mono}"
    rounded: "{rounded.full}"
  pill-rubrique-curiosites:
    backgroundColor: "{colors.curiosite}"
    textColor: "{colors.on-primary}"
    typography: "{typography.meta-mono}"
    rounded: "{rounded.full}"
---

# DESIGN.md — DBFR

## Overview

Deux héritages tenus ensemble. Le premier est **Dragon Ball** tel que ses
ayants droit le montrent aujourd'hui (`fr.dragon-ball-official.com`, Toei,
Bandai Namco) : nuit profonde, or saturé, rouge d'alerte, jamais de pastel ni
de synthwave. Le second est la **presse encyclopédique** : ce site est d'abord
un lieu où l'on lit 4 000 signes sur une planète fictive, et cela impose une
mesure, un rythme vertical et un contraste typographique.

D'où le parti pris central : **serif pour la voix, sans pour l'information,
mono pour la mesure**. Les titres sont en Newsreader, le corps en Google Sans
Flex, les métadonnées et les compteurs en JetBrains Mono. Un lecteur distingue
le registre d'un bloc avant même de l'avoir lu.

Le fond noir n'est pas un thème sombre appliqué après coup : c'est la surface
d'origine. Toute couleur posée dessus est une décision, pas une décoration.

## Colors

L'or `#ffb200` est la **seule** couleur de hiérarchie. Il désigne ce sur quoi
on peut agir ou ce qui prime — jamais un ornement. Un bloc ne porte qu'un seul
accent dominant.

- **bg (#0a0a0a)** — noir profond, jamais `#000` : le noir absolu écrase les
  ombres et fait vibrer le texte blanc sur écran OLED.
- **surface (#141410)** — élévation chaude, légèrement tirée vers l'olive.
  C'est ce qui distingue une carte du fond sans recourir à une ombre.
- **border (#2a2a26)** — filet. Sur les surfaces de contenu, on lui préfère
  `rgba(255,255,255,0.08)`, encore plus discret.
- **primary (#ffb200)** — or signature. Liens, CTA, eyebrow, état actif.
- **critical (#ff0000)** — réservé aux états critiques : sanctions, retrait
  DMCA, erreur. Jamais décoratif.
- **ember / ki / amber** — accents d'énergie (halos, dégradés de héros, aura).
  Ils vivent dans les fonds et les FX, jamais dans du texte de corps.
- **namek, transformation, saiyan, affiliation, curiosite** — codage
  sémantique des rubriques de fiche. Un lecteur apprend la correspondance en
  parcourant deux fiches ; la changer par page la détruit.

Le texte de corps est à `rgba(255,255,255,0.82)` et non blanc pur : sur fond
noir, le blanc plein produit un halo qui fatigue au bout d'un paragraphe.

Ces valeurs sont surchargeables au runtime (`/admin/design` injecte les
`--dbz-*`). Un `text-dbz-orange` peut donc sortir bleu en production : lire
les variables servies avant de conclure à un bug de couleur.

## Typography

Trois familles, trois rôles, aucun recouvrement.

| Rôle        | Famille                                                     | Où                                         |
| :---------- | :---------------------------------------------------------- | :----------------------------------------- |
| Voix        | **Newsreader** (serif variable, opsz + wght, italique vrai) | h1, h2, citations, chapeaux                |
| Information | **Google Sans Flex** (variable, wght 1→1000)                | corps, h3, h4, UI, boutons                 |
| Mesure      | **JetBrains Mono**                                          | métadonnées, compteurs, code, libellés HUD |
| Japonais    | **Noto Sans JP**                                            | 孫悟空, noms natifs, titres d'ouvrages     |

- Les titres sont en **600, pas 700**. Le contraste serif/sans porte déjà la
  hiérarchie ; un gras plein par-dessus alourdit sans rien distinguer.
- `letter-spacing: -0.02em` sur les serifs de titre, `-0.015em` sur les titres
  globaux. Une serif de labeur composée large paraît molle en grande taille.
- **h4 est un label**, pas un titre : 0.82rem, capitales, `0.08em` de
  tracking, gris. Empiler quatre tailles de la même police ne se lit pas ;
  alterner les registres se lit d'un coup d'œil.
- **Mesure bornée à 72ch** sur les blocs de texte (`p`, `li`, `blockquote`,
  titres) — jamais sur le conteneur, qui porte aussi des figures pleine
  largeur, des grilles et des tableaux qu'un `max-width` global écraserait.
- Chiffres en `tabular-nums` dès qu'ils s'empilent (classements, compteurs,
  numéros de tome).
- Le japonais ne se met jamais en gras synthétique : Noto Sans JP porte ses
  propres graisses, l'émulation détruit les traits.

Polices écartées : `SaiyanSans` et `DBSScouter` (fan-art) ne sont plus
chargées. Leurs tokens `font-saiyan` / `font-scouter` restent, remappés
respectivement sur Google Sans Flex et JetBrains Mono — le registre « HUD »
vient du tracking et des capitales, pas d'une police à glyphes aliens.

## Layout

- Container principal **1280px**, article **920px**, mesure de texte **72ch**.
- Padding latéral `24px` mobile / `40px` desktop.
- Rythme vertical : `96px` entre sections, `24px` d'un titre à son corps.
- Grilles de cartes : 1 / 2 / 3 / 4 colonnes selon la densité, carte idéale
  320–380px. Portraits de personnage en 3:4, affiches de film en 2:3.
- **Mobile d'abord** : la mise en page se décide à 375px, le desktop est
  l'amélioration. Cibles tactiles 44px, champs de saisie à 16px minimum —
  en dessous, iOS zoome au focus.
- Asymétrie sur les héros : titre et chapeau à gauche, visuel à droite. Le
  centrage par défaut est un aveu d'absence de hiérarchie.

## Elevation & Depth

La profondeur vient de la **surface et du filet**, pas de l'ombre portée.

- Une carte se distingue par `surface` + `1px` de filet, et s'illumine au
  survol par un changement de **couleur de bordure** vers l'or.
- Aucune ombre supérieure à `0 12px 48px` et jamais au-delà de 15 % d'opacité.
- Les seuls halos autorisés sont les auras de ki (`ember`, `ki`, `amber`) en
  `color-mix`, sur des blocs de héros — pas sur du contenu de lecture.
- Barre de navigation : `rgba(10,10,10,0.82)` + `backdrop-blur`. C'est le seul
  usage de flou du site.

## Shapes

- `4px` pour les jetons et le code inline, `8px` pour les champs, `12px` pour
  les cartes, `16px` pour les cartes de héros.
- `9999px` réservé aux CTA et aux pastilles — jamais sur un grand conteneur.
- Les tableaux n'ont **pas de grille** : seuls des filets horizontaux. Une
  bordure sur les quatre côtés de chaque cellule fabrique un damier qui
  concurrence les données.

## Components

- **button-primary** — pastille or, texte noir, capitales espacées. Au survol
  le fond passe au blanc : l'inversion est plus lisible qu'un assombrissement.
- **button-secondary** — filet seul, bordure qui vire à l'or au survol.
- **card** — surface + filet, `20px` de padding (`32px` pour un héros). Pas
  d'ombre.
- **badge** — mono, capitales, fond de surface. Sert aux plateformes, races,
  supports.
- **eyebrow** — micro-label mono or au-dessus d'un h1, qui ancre la page dans
  sa rubrique (« Univers Dragon Ball », « Cinéma »).
- **article-body** (`.wiki-content`) — le composant qui porte le wiki : h1/h2
  en serif, h2 souligné d'un filet de section, liens soulignés en trait fin
  décalé de `0.18em`, citation en serif italique sur un filet gris.
- **table-header** — mono, capitales, gris, sans fond.

Les liens de corps sont **soulignés en permanence** : la couleur seule ne
distingue rien pour un daltonien (WCAG 1.4.1). Le filet est fin et décalé sous
la ligne de base pour ne pas hacher les jambages.

## Do's and Don'ts

### À faire

- Une hiérarchie par page : un titre, un chapeau court, une action visible.
- Poser l'or via `--color-dbz-orange`, jamais `text-yellow-300` ni `#FFD700`.
- Afficher le nom japonais en sous-titre discret quand la fiche en porte un.
- Citer la source sur toute page de contenu — c'est la règle éditoriale du
  wiki, et elle a une conséquence graphique : prévoir la place du crédit.
- Animer par `transform` et `opacity` uniquement, et respecter
  `prefers-reduced-motion`.
- Préférer, dans l'ordre : View Transitions natives, CSS scroll-timeline,
  keyframes CSS, puis seulement `motion/react`.

### À éviter

- L'initiale dans un rond coloré comme avatar de repli, « ??? » ou « Aucun
  résultat » comme valeur par défaut : on masque le champ vide, on ne le
  meuble pas.
- Les emoji décoratifs dans l'interface et les titres.
- Le bleu Discord `#5865F2` sur les pages grand public.
- Les polices fan-art sur du texte de corps.
- Le parallax, les flips 3D, les effets glitch, les chargements infinis.
- Une ombre portée pour signifier l'élévation là où un filet suffit.
- Inventer une déclinaison (« DB vaporwave », « DB glassmorphism ») : l'univers
  est chaud, manga, énergique.

## Implémentation

| Élément                        | Fichier                                           |
| :----------------------------- | :------------------------------------------------ |
| Tokens de palette et de police | `apps/shenron/site/src/app/globals.css` (`@theme inline`) |
| Chargement des polices         | `apps/shenron/site/src/app/layout.tsx` (`next/font`)      |
| Primitives de page partagées   | `apps/shenron/site/src/components/kit/`                   |
| Corps du wiki                  | `.wiki-content` dans `globals.css`                |
| Lecture des actualités         | `apps/site/src/styles/editorial.css` (not in repo)              |
| Surcharge de thème au runtime  | `/admin/design` → `lib/site-theme.ts`             |
| Module d'édition               | `apps/shenron/site/src/components/editor/`                |
| Accents de rubrique            | `apps/shenron/site/src/lib/wiki-section-accents.ts`       |

### Écart connu entre ce document et le code (2026-09-12)

Deux règles de ce document ne sont pas encore tenues partout. Elles sont notées
ici pour qu'on sache ce qui est une dette et ce qui est une décision.

1. **Ombre portée dure.** « La profondeur vient de la surface et du filet » et
   « card : pas d'ombre » (§ Elevation & Depth, § Components). 48 fichiers
   utilisent pourtant une ombre d'encre décalée (`shadow-[3px_3px_0px_#000]`,
   via `.toriyama-card` / `.toriyama-btn`). L'analyse du support officiel
   tranche contre elle — l'ombre au sol de Toriyama est « un lavis bleu très
   pâle, jamais une ombre portée dure ». Le kit (`components/kit/`) suit le
   document : filet de 1 px, rayon 12 px, survol qui passe le filet à l'or. Les
   boutons, eux, continuent d'utiliser `.toriyama-btn` — une alternative locale
   aurait donné deux familles de boutons sur la même page. Le reste est à
   reprendre en une passe dédiée.
2. **Thème clair des actualités.** `styles/editorial.css` posait un papier blanc
   sur les pages d'articles, au milieu d'un site sombre : retiré le 2026-09-12.
   La typographie de lecture (serif, largeur de ligne, filets) est conservée,
   l'accent revient au doré — qui sur cette encre dépasse 9:1 là où il tombait
   à 1,9:1 sur blanc.

Ce fichier suit la spécification [DESIGN.md](https://github.com/google-labs-code/design.md)
(front matter de tokens + prose de justification). Il se vérifie par
`@google/design.md lint DESIGN.md` — le linter contrôle les références de
tokens et le contraste WCAG de chaque composant, et l'état attendu est **0
erreur, 0 avertissement**. C'est ce contrôle qui a signalé les pastilles de
rubrique en texte blanc sur vert, violet, rose et rouge (3,3 à 4,0:1, sous le
seuil AA de 4,5) — passées en texte noir.

## Analyse du support officiel

Mesurée le 2026-08-27 sur nos propres scans (`bot.db_databooks`, 12 047
planches) — 400 planches tirées au sort, la balance des blancs corrigée page
par page avant toute mesure. Sans cette correction la teinte dominante
« mesurée » est le 40-50° : c'est le jaune du **papier scanné**, pas une
décision graphique. Trois chiffres tiennent le reste.

| Corpus                                                     | Encre (part de la surface) | Saturation moyenne de l'encre | Familles dominantes                              |
| :--------------------------------------------------------- | -------------------------: | ----------------------------: | :----------------------------------------------- |
| Artbooks (Daizenshuu 1, Illustration Book, Toriyama World) |                 **16,6 %** |                          0,58 | jaune-or 39 %, orange 21 %, bleu 8 %, rouge 7 %  |
| Guides (Chōzenshū 3-4, Daizenshuu 2, 6, 7)                 |                 **12,9 %** |                          0,59 | rouge 16 %, bleu 11 %, violet 10 %, chaudes 33 % |

1. **La couleur est rare et forte.** 83 à 87 % de chaque page est du fond
   clair ; le peu de couleur qui reste est très saturé. Le contraire du
   dégradé tiède posé partout — c'est la règle « un seul accent par bloc »,
   vérifiée sur le support plutôt que postulée.
2. **Deux registres chromatiques distincts.** L'or et l'orange appartiennent
   aux _illustrations_ (le gi, les auras, les cheveux). Le **rouge** est
   l'accent de la _mise en page_ : titres de rubrique, filets, pastilles,
   bandes-annonces. Notre or d'interface vient donc du registre illustration,
   ce qui est un choix — pas l'accent éditorial officiel.
3. **Une seule encre d'accent par page.** Les pages intérieures des guides
   sont en bichromie (noir + une encre), y compris pour les photos.

Trois motifs de mise en page reviennent d'un ouvrage à l'autre, relevés sur les
planches :

- **Le fil de tête** — une ligne fine tout en haut : l'ouvrage à gauche,
  l'édition à droite. Un fil d'Ariane et une source, en une ligne.
- **La pastille numérotée** — un chiffre en rond plein qui ouvre chaque entrée
  d'une liste ou d'un sommaire (le « ④ » orange de la couverture _World
  Guide_, les ❶…❼ blancs sur rouge de l'obi du volume 5). C'est la signature
  de numérotation de la collection.
- **La référence en fin d'entrée** — chaque définition du _Daijiten_
  (Daizenshuu 7) se termine par sa source entre parenthèses et en petit :
  「(大全集3・P122)」. Un dictionnaire de 313 pages cite au paragraphe, pas en
  bibliographie de fin. C'est le rendu que doit viser la règle « citer ses
  sources » du wiki.
- **Le marqueur de rubrique** — un tag court dans un cadre (【特】 pour les
  caractéristiques) ouvre un segment à l'intérieur d'une entrée. Nos h4 en
  petites capitales grises jouent ce rôle.
- **Le triple niveau de titre serré** — sur-titre minuscule, titre en
  grotesque très gras, sous-titre en **serif capitales** (`WORLD GUIDE` sous
  `DRAGON BALL 大全集`). Le contraste sans/serif de ce document n'est pas une
  importation de la presse occidentale : il est déjà sur la couverture.

### Ce que montre une illustration de Toriyama

Relevé sur les planches de l'_Illustration Book_ et du Daizenshuu 1 (nos scans,
`bot.db_databooks`) plutôt que sur une galerie en ligne — les deux références
d'artwork envoyées le 2026-08-27 sont des galeries sans texte, et X comme
Instagram exigent une session : rien à en tirer d'exploitable.

- **Fond blanc, sujets détourés.** Pas de décor. L'ombre au sol est un lavis
  bleu très pâle sous les pieds, jamais une ombre portée dure. Corollaire pour
  nous : un portrait recadré en `object-cover` sur fond noir trahit le support
  ; un détourage sur fond clair lui est fidèle.
- **Aplats saturés, aucun dégradé.** Le modelé se fait par un **second ton plus
  foncé de la même couleur** (les hachures sur les épaulettes de Piccolo), pas
  par un fondu. C'est l'argument le plus direct contre l'empilement de
  dégradés dans l'interface : le support n'en contient aucun.
- **Contour noir d'épaisseur variable** — épais sur la silhouette extérieure,
  fin à l'intérieur. C'est lui qui porte le relief. Transposé : une bordure
  peut être plus franche sur l'élément actif que sur les autres, au lieu du
  1 px uniforme partout.
- **Composition pyramidale** : le héros au centre en bas, l'antagoniste en
  grand derrière, les secondaires de part et d'autre. L'échelle dit la
  hiérarchie narrative — elle n'est jamais décorative.
- **Le logo est dessiné, pas composé** : lettres à contour épais remplies en
  alternance rouge/bleu, légèrement irrégulières. Ne jamais essayer de le
  reproduire avec une police.
- **La référence est en corps 6, en bas.** « 87-16 1987年 WJ49号 » dans l'angle,
  et le numéro de page en gras dans l'autre. Même discipline que le _Daijiten_ :
  la source accompagne l'image, sans jamais lui disputer la place.

Les pages de dictionnaire, elles, sont en **noir et blanc intégral** : la
densité et les repères font tout le travail, sans une seule couleur. Sur une
page de définitions, la couleur n'apporte rien qu'un filet ne fasse mieux.

Ce qui ne se transpose pas : le fond. Le support officiel est clair, le site
est sombre — cette identité-là vient des vitrines actuelles des ayants droit
(`fr.dragon-ball-official.com`, Bandai Namco) et reste notre base.

## Sources

| Référence                            | Apport                                                      |
| :----------------------------------- | :---------------------------------------------------------- |
| `fr.dragon-ball-official.com`        | Palette noir / or / rouge, structure éditoriale             |
| Toei Animation, Bandai Namco         | Cartes de catalogue, bannières de héros                     |
| `design.google`                      | Rythme vertical, hiérarchie par le poids                    |
| `bot.db_databooks` (12 047 planches) | Mesure directe du support officiel — cf. section précédente |
