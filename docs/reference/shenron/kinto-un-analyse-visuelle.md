# Kinto-Un — analyse visuelle des sources, dessin du SVG et icônes

Relevé des couleurs et des proportions du nuage magique sur les cels Toei puis sur le
manga (tome 1 ch. 4, édition couleur), et dessin d'un Kinto-Un original — illustration,
icône carrée, favicons de toutes tailles — à partir de ces seules mesures.

- Géométrie (source unique) : [`apps/shenron/site/src/lib/kinto-un.ts`](../../../apps/shenron/site/src/lib/kinto-un.ts)
- Illustration : [`apps/shenron/site/public/dbz/kinto-un.svg`](../../../design/aphrody-m3/packages/shenron-ui/assets/dbz/kinto-un.svg) · icône : [`kinto-un-icone.svg`](../../../design/aphrody-m3/packages/shenron-ui/assets/dbz/kinto-un-icone.svg)
- Composant : [`apps/shenron/site/src/components/KintoUn.tsx`](../../../apps/shenron/site/src/components/KintoUn.tsx) (`<KintoUn>`, `<KintoUnLoader>`)
- Générateurs : [`genere-kinto-un.ts`](../../../apps/shenron/site/scripts/genere-kinto-un.ts) (SVG) et [`genere-icones.ts`](../../../apps/shenron/site/scripts/genere-icones.ts) (favicons site + bot)
- Mesures faites le 2026-09-04.

## Nom et graphie

| Point           | Source                                                                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forme française | **Kinto-Un** — 12 occurrences dans `bot.db_wiki_sections`, glosé « le Nuage Magique ». Le manga FR en volumes dit « nuage magique » (titre du ch. 4, note « "KINTO-UN" EN JAPONAIS », vol. 1 pl. 69) ; l'édition couleur dit « Kinto-Un » (t901 pl. 3 et 81)                                          |
| Japonais        | **筋斗雲** (きんとうん, _Kintōun_) — _Super Exciting Guide Story_, pl. 16 ; confirmé par _DBZ Fact Files_, _Fortune Book_, _Illustration Book_. Zéro occurrence de 觔斗雲 dans les 370 databooks. 筋 = tendon (筋斗 = culbute, la « cloud somersault » de Sun Wukong) : **aucun 金 (or) dans le nom** |
| Slug            | `kinto-un`, repli ASCII de la forme en base                                                                                                                                                                                                                                                           |

Aucune fiche wiki dédiée n'existe (`wiki/search?q=Kinto` vide sur les 5 catégories).

## Outils

| Rôle                                                                   | Outil                                                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Métadonnées, découpe, ré-échantillonnage, rendu SVG → PNG              | `sharp` (déjà dans le monorepo)                                                                                            |
| Masque du nuage, k-means, conversions HSL/OKLCH, profils de silhouette | Pillow 12.1.1 + numpy 2.3.5 (`apt install python3-pil python3-numpy` ; ni `pip` ni `ensurepip` sur ce VPS)                 |
| Segmentation                                                           | masque teinte/saturation/valeur + plus grande composante connexe (BFS), trous rebouchés par remplissage depuis l'extérieur |
| Palette                                                                | k-means écrit à la main (scikit-learn absent), 40 itérations, échantillon de 20–30 k pixels                                |

`node-canvas` n'est pas installé (le bot dessine avec `@napi-rs/canvas` côté runtime uniquement) ;
`sharp` couvrait tout le besoin de rastérisation, il n'a pas été ajouté de dépendance.

## Sources analysées

| #   | Fichier                                              | Dimensions                            | Poids     | Ce qu'elle vaut                                                                                                                                                                              |
| --- | ---------------------------------------------------- | ------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `db-z.com/…/2023/06/Kintoun_debut-1.webp`            | 640 × 480, WebP VP8, sRGB, sans alpha | 30 202 o  | Image demandée. Capture SD (DB ép. 4, plage de Kame House). Couleurs **délavées et décalées vers l'orange** par la chaîne VHS/DVD → inutilisable telle quelle comme référence colorimétrique |
| B   | `db-z.com/…/2023/06/Nuage-Magique-Goku.webp`         | 1600 × 1200                           | 87 426 o  | **Référence retenue.** Cel net, nuage entier, deux aplats francs                                                                                                                             |
| C   | `db-z.com/…/2023/03/Goku-sur-son-nuage-magique.webp` | 1800 × 1170                           | 108 676 o | Artwork de film ; le nuage n'occupe qu'un coin, sert de contrôle de teinte                                                                                                                   |

Toutes récupérées en `curl` avec un UA navigateur : `WebFetch` reçoit un **403** sur db-z.com.

## A — capture d'épisode (640 × 480)

Nuage isolé : boîte `x 196→414`, `y 233→363` → **219 × 131 px**, ratio **1,672**,
18 672 px pleins (65,1 % de la boîte, 6,08 % de l'image).

Palette k-means (k = 6) sur les pixels du nuage :

| Part   | HEX       | RGB           | HSL                 | OKLCH                 |
| ------ | --------- | ------------- | ------------------- | --------------------- |
| 58,7 % | `#F3C566` | 243, 197, 102 | 40,3° 85,1 % 67,6 % | 0,844 / 0,124 / 83,5° |
| 27,4 % | `#F5C669` | 245, 198, 105 | 39,9° 87,2 % 68,6 % | 0,849 / 0,123 / 82,8° |
| 9,0 %  | `#EDBE60` | 237, 190, 96  | 40,0° 79,8 % 65,3 % | 0,826 / 0,124 / 82,9° |
| 2,2 %  | `#DDAD51` | 221, 173, 81  | 39,4° 67,2 % 59,2 % | 0,774 / 0,122 / 81,4° |
| 1,9 %  | `#C8973C` | 200, 151, 60  | 39,1° 55,8 % 51,0 % | 0,706 / 0,121 / 79,9° |
| 0,9 %  | `#E0B76B` | 224, 183, 107 | 39,0° 65,8 % 65,0 % | 0,801 / 0,106 / 81,8° |

Extrêmes : plus clair `#F7CB7F`, plus sombre `#9A701F`, moyenne `#F1C365`, médiane `#F3C567`.
Anneau de contour (2 px autour du masque) : moyenne `#DFAE60`, quart le plus sombre `#C19043`.
Repères de la même image : ciel `#80A7AA`, mer `#25658E`, sable `#BA8C6C`, ombre portée sur le sable `#A67A54`.

**Ce que ça dit :** 86 % des pixels tiennent dans deux teintes séparées de 0,005 en L OKLCH —
l'encodage a fondu la lumière et l'ombre en un aplat unique. L'écart lumière/ombre n'y est que de
**0,09 L** (0,845 → 0,752), contre 0,16 sur le cel HD. La teinte, 40°, est **14° plus orangée**
que sur le cel. Palette non retenue.

## B — cel HD (1600 × 1200), référence retenue

Nuage isolé : boîte `[405, 638] → [1229, 1079]` → **825 × 442 px**, ratio **1,867**,
227 098 px pleins (62,3 % de la boîte, 11,83 % de l'image) — trous des jambes de Goku rebouchés.

Palette k-means (k = 4) :

| Part   | HEX       | RGB           | HSL                 | OKLCH                  | Rôle                       |
| ------ | --------- | ------------- | ------------------- | ---------------------- | -------------------------- |
| 60,1 % | `#F8EB7E` | 248, 235, 126 | 54,0° 89,3 % 73,2 % | 0,929 / 0,132 / 103,0° | **aplat clair**            |
| 23,9 % | `#C5BA30` | 197, 186, 48  | 55,2° 60,9 % 48,1 % | 0,774 / 0,150 / 104,2° | **aplat d'ombre**          |
| 14,4 % | `#EFE77A` | 239, 231, 122 | 56,1° 78,0 % 70,6 % | 0,912 / 0,132 / 105,2° | transition (anti-aliasing) |
| 1,6 %  | `#CAC25E` | 202, 194, 94  | 55,5° 50,6 % 58,0 % | 0,800 / 0,123 / 104,6° | transition                 |

Par déciles de luminance : ombre `#C2B631` · demi-ton `#D7CC4F` · base `#F5EA7D` ·
clair `#F9EC7E` · plus haute lumière `#FAEF80`. Lignes internes (5 % les plus sombres) : `#C2B62E`.

**Deux aplats, pas de dégradé.** Sonde verticale à `x = 520` : `#FAEA79` sur trois pixels puis
`#C7BA2A`, tenu sur 55 px jusqu'au fond. La teinte ne bouge pas entre lumière et ombre (54° → 55°),
seule la clarté chute de **0,929 → 0,765 L** et le chroma monte légèrement (0,132 → 0,147).

**Pas de trait de contour noir** : sur le bord inférieur, l'aplat d'ombre touche directement le
décor. Le `#040102` mesuré dans l'anneau extérieur est la fenêtre sombre du décor, pas un cerne.

Silhouette : creux du bord inférieur à 22,2 %, 40,7 %, 59,3 %, 76,3 % et 93,4 % de la largeur —
soit un lobe tous les ~18 % de la largeur, rayon ≈ 0,09 × largeur. Le profil supérieur n'est pas
exploitable directement (Goku est assis dedans, il coupe la crête entre 25 % et 50 %).

## D — manga, la référence finale

Contrôle de fidélité sur _tome 1, chapitre 4_ : planche 70 (trait original N&B,
`apps/bot/assets/manga/DB/regular/vol1/070.webp` (not in repo)) et planche 81 de l'édition couleur
(`fullcolor/enfance-goku/t901/081.webp`). Le dépôt place le manga au-dessus de l'anime.

**Forme — Toriyama dessine autrement que Toei :**

- **chaque lobe se termine par une volute**, spirale rentrante de 1 à 1,5 tour, au moins 9 sur le
  seul deuxième panneau de la planche 70. C'est le motif du 筋斗雲 du _Xiyouji_ ; sans lui le
  dessin est un cumulus générique ;
- **trait d'encre noir** sur le contour et les divisions internes : 6 px / 806 (0,74 %) et
  4 px / 449 (0,89 %) de la largeur du nuage. Le cel Toei n'en a aucun (confirmé, 0 pixel sombre
  sur 130 lignes de bordure) ;
- ratios de boîte : manga couleur **1,768** et **1,775**, cel **1,889**. La première version du
  SVG mesurait **2,288** d'encre (le viewBox annonçait 1,85 mais gardait 158 px de vide vertical) ;
- la queue effilée n'est **pas un attribut** : c'est un effet de vitesse, orienté à l'opposé du
  déplacement (à gauche sur le nuage B de la pl. 81), et il se termine en crochet, pas en bourrelet ;
- les lobes vont du simple au triple ; remplissage de boîte manga 64–66 %.

**Couleur (édition couleur, deux nuages) :** aplat clair `#FCF03A` (H 56,2° S 98 % L 61 %),
aplat d'ombre `#E4BE05` (H 49,8° S 95 % L 46 %). L'ombre **garde sa saturation et vire vers
l'orange** ; le cel, lui, désature à teinte constante (`#C5BA30`, S 61 %), ce qui donnait au
premier SVG son ombre olive. Le databook _Super Exciting Guide_ pl. 16 contredit tout le monde
(nuage bleu `#5DACD0` dans l'illustration centrale, blanc à ombre lavande dans l'en-tête) ; la
couleur voulue par Toriyama lui-même n'est pas vérifiable en base (manga d'origine en N&B).
Ce qui tient sans risque : _si_ jaune, c'est un citron saturé (H 50–56°), jamais orangé.

## Ce qui a été retenu pour le dessin

| Décision                                                                                                                                           | Mesure d'origine                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Illustration viewBox 1200 × 676, encre ≈ 1100 × 630, ratio **1,75**                                                                                | manga 1,77, cel 1,89                                          |
| **Une volute par creux** (10 sur le contour + 1 en bout de queue + 4 sur les lobes intérieurs), rayon 0,55 × rayon du lobe, 1,2 tour, sens alterné | planche 70 : ≥ 9 volutes par nuage, ≈ 0,45 × le rayon du lobe |
| Trait d'encre `#1A1A1A`, **9 px sur 1100 (0,8 %)**, volutes 7 px                                                                                   | 0,74–0,89 % dans le manga                                     |
| Deux **aplats francs**, `#FCF03A` clair / `#E4BE05` ombre, aucun dégradé ni reflet                                                                 | manga couleur ; le cel est lui aussi en deux aplats           |
| Bande d'ombre = le même contour remonté de 168 px (96 px vers la queue), découpé par la silhouette                                                 | la ligne d'ombre suit le bas des bulbes, jamais droite        |
| Queue ramenée à ≈ 8 % de la largeur, fermée par une volute                                                                                         | effet de vitesse, terminé en crochet dans le manga            |
| Titre `Kinto-Un`                                                                                                                                   | forme de la base                                              |

Le dessin est **original** : aucun tracé n'est décalqué. Silhouette = chaîne d'arcs de cercle
tendus entre les creux (`arcs()`), volutes = spirales à rayon décroissant (`volute()`), ombre =
contour remonté et découpé.

## Icône carrée et favicons

Un simple downscale de l'illustration ne tient pas : à 16 px le nuage fait 16 × 7 px, une
lentille jaune sans lobe, et `#F8EB7E` sur chrome blanc donne un contraste de 1,22:1. Une
**variante carrée** est donc dessinée à part (`KINTO_UN_ICONE`, viewBox 512) :

- 5 gros lobes en haut, 4 petits en bas, boîte 432 × 322 (ratio 1,34) ;
- trait d'encre 12 px (2,3 %), volutes 9 px — **coupées sous 64 px**, où elles ne sont plus que du bruit ;
- pastille `#0a0a0a` (fond du site) à coins arrondis 22 % : c'est elle qui donne le contraste
  sur un onglet clair ; la variante « maskable » réduit le nuage à 0,8 dans une pastille pleine.

Chaîne de fabrication mesurée par l'étude favicon : `sharp` seul (déjà à la racine, libvips
8.17.3, rendu de ce SVG indiscernable de Chromium) + un encodeur ICO de quinze lignes
(conteneur de PNG). Toutes les autres bibliothèques du registre ajoutaient une dépendance
redondante (`favicons` exige un second `sharp` ; `to-ico` abandonné en 2017 ; `cli-real-favicon`
téléverse l'asset chez un tiers), et un `bun add` côté site a déjà cassé le déploiement.

Fichiers produits, identiques pour le site (`apps/shenron/site/public/`) et le dashboard du bot
(`apps/shenron/bot/public/`) :

| Fichier                        | Taille              | Fond                | Corrige                                                                   |
| ------------------------------ | ------------------- | ------------------- | ------------------------------------------------------------------------- |
| `favicon.ico`                  | 16 + 32 + 48        | transparent         | l'ancien `.ico` était un PNG 32 déguisé                                   |
| `favicon-16/32/48/96.png`      | —                   | transparent         | —                                                                         |
| `apple-touch-icon.png`         | 180                 | **opaque**          | l'ancien était transparent (iOS compose sur noir)                         |
| `icon-192.png`, `icon-512.png` | `purpose: any`      | transparent         | —                                                                         |
| `icon-maskable-512.png`        | `purpose: maskable` | opaque, nuage à 0,8 | l'ancien 512 déclaré `any maskable` perdait 27 % de ses pixels au rognage |
| `mstile-150.png`               | 150                 | opaque              | + meta `msapplication-*`, pas de `browserconfig.xml`                      |
| `safari-pinned-tab.svg`        | vectoriel           | silhouette noire    | nouveau (`mask-icon`)                                                     |
| `apps/shenron/bot/assets/logo.webp`    | 1024                | pastille            | logo du dashboard bot                                                     |

OG / Twitter : rien à faire, `app/opengraph-image.tsx` couvre les deux.

## Où le nuage est utilisé

| Surface                                                              | Fichier                                                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Favicons, manifest, `mask-icon`, tuile Windows                       | `apps/shenron/site/src/app/layout.tsx`, `public/manifest.webmanifest`                            |
| Wordmark du header (s'envole au survol)                              | `apps/shenron/site/src/components/SiteNav.tsx`                                                   |
| Chargement de page et barre de navigation                            | `apps/shenron/site/src/app/loading.tsx`, `components/NavigationProgress.tsx` (`<KintoUnLoader>`) |
| Dashboard bot : favicons, manifest, logo (`Layout.tsx`, `Login.tsx`) | `apps/shenron/bot/public/`, `apps/shenron/bot/assets/logo.webp`                                          |
| JSON-LD `Organization.logo`                                          | `apple-touch-icon.png`                                                                   |

## Reproduire

```bash
bun apps/site/scripts/genere-kinto-un.ts --rendu   # SVG + PNG de contrôle dans /tmp
bun apps/site/scripts/genere-icones.ts             # favicons site + bot, logo du bot
```
