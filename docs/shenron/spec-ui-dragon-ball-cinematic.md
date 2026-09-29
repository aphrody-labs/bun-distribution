# Spécifications Stylistiques & Cinématiques Dragon Ball
## Moteur Graphique Shenron : Colorimétrie d'Aura, Lignes d'Impact & UI Cinématique

> **Document de Référence Technique & Artistique**  
> **Auteur :** Lead Développeur Principal & Direction Artistique Shenron (Akihiro Hino x Akira Toriyama Engine)  
> **Périmètre :** `apps/site/src/components/ui/dragon-ball/` & `apps/site/src/app/globals.css`  
> **Mécanisme d'Extraction :** `bxc frames` (MPEG-7 ColorLayout Y/Cb/Cr DCT)  
> **Date de Calibrage :** 2026-09-11  

---

## I. Fondements Mathématiques & Analyse Vidéo via `bxc frames`

L'intégration cinématique de Dragon Ball dans le Web moderne ne doit pas reposer sur des approximations visuelles empiriques. L'écosystème **BXC** dispose du moteur `@aphrody/frames` (`bxc frames`), capable d'indexer et d'analyser image par image les flux vidéo par le descripteur **MPEG-7 ColorLayout (ISO/IEC 15938-3)**.

### 1. Structure du Descripteur ColorLayout (33 Coefficients)

`bxc frames vector <frame>` extrait une signature compacte de 33 entiers projetant l'image dans l'espace fréquentiel de la transformée en cosinus discrète (DCT 8×8) :
- **6 coefficients Y (Luminance) :**
  - $Y_{00}$ (DC) : Luminance moyenne de la frame ($0 \le Y_{00} \le 63$).
  - $Y_{01} \dots Y_{20}$ (AC) : Variations spatiales horizontales, verticales et diagonales.
- **14 coefficients Cb (Chrominance Bleu-Jaune) :**
  - $Cb_{00}$ (DC) : Pondération globale vers le cyan/bleu (SSJ Blue, Ultra Instinct) ou le jaune.
  - $Cb_{AC}$ : Fréquences de micro-détails chromatiques (étincelles de plasma, particules).
- **13 coefficients Cr (Chrominance Rouge-Vert) :**
  - $Cr_{00}$ (DC) : Pondération vers le cramoisi (Kaio-ken, God, Beast) ou le vert (Broly, Shenron).
  - $Cr_{AC}$ : Gradients d'explosion et fractures spatiales.

```json
{
  "hash": "GiyMXvk57HOg-D3ufOSLouZA58Iy",
  "vector": [6,17,12,17,17,15,15,18,14,15,12,14,14,16,15,16,15,15,14,15,19,36,17,14,17,14,12,32,14,15,16,17,18]
}
```

### 2. Détection Algorithmique des Événements Cinématiques

Dans le pipeline cinématique, les scènes clés de l'animé présentent des signatures fréquentielles caractéristiques :

1. **L'Impact Frame (1 à 2 trames d'inversion N&B ou flash blanc) :**
   - Pic brutal de $Y_{00} \to 63$ (saturation totale de luminance) ou inversion instantanée par rapport à la moyenne mobile temporelle ($|Y_{00}(t) - Y_{00}(t-1)| > 35$).
2. **L'Éruption d'Aura (Burst Activation) :**
   - Augmentation abrupte de l'énergie AC ($\sum |Y_{AC}|$) indiquant la formation de speedlines et de flammes déchiquetées.
   - Translation massive de l'axe $Cb_{00}$ ou $Cr_{00}$ selon la forme divine éveillée.
3. **Le Bréchage Dimensionnel (Dimension Shatter - Gogeta vs Broly) :**
   - Dispersion maximale de la matrice de covariance chromatique $(Cb, Cr)$, caractérisant un état de kaléidoscope psychédélique.

---

## II. Analyse Visuelle des Scènes Mythiques de l'Animé & des Films

### 1. L'Éveil Super Saiyan de Goku (Dragon Ball Z — Épisode 95)
*Directeurs d'animation : Yukio Ebisawa, Masaki Sato (1991)*

- **Composition & Tension Dramatique :**
  - **Phase 1 : Stase & Rupture.** La mort de Krillin déclenche un arrêt total de la partition orchestrale. Plan serré extrême sur l'iris tremblant de Goku. La saturation générale de l'environnement namékien s'assombrit (contraste dramatique).
  - **Phase 2 : Lévitation Anti-gravitationnelle.** Des éclats de roche s'élèvent verticalement, rompant la pesanteur terrestre.
  - **Phase 3 : Éclairs Précurseurs & Battement Flou.** Des éclairs bleutés frappent le sol à intervalles syncopés. À chaque flash, les cheveux noirs passent au jaune d'or pendant 1 frame, puis redeviennent noirs, visualisant la lutte intérieure de l'énergie brute.
  - **Phase 4 : Éruption Pyramide.** Une gerbe de flammes dorées monte en continu avec une traînée ascendante à haute vélocité.
- **Colorimétrie Référente :**
  - Cœur de l'éruption : `#FFFDE7` (Blanc ivoire solaire)
  - Flamme principale : `#FFD700` (Or pur)
  - Traînée extérieure : `#FF9E00` (Ambre flamboyant)
  - Éclairs de foudre : `#00F0FF` (Cyan électrique)

### 2. Gohan Super Saiyan 2 contre Cell (Dragon Ball Z — Épisode 185)
*Directeurs d'animation : Minoru Maeda, Katsuyoshi Nakatsuru (1993)*

- **Composition & Rupture Mentale :**
  - **Le Filet Rouge de la Rage (Horizontal Slit Cut-in) :** Après la destruction de C-16, un trait rouge sangilant traverse l'écran à l'horizontale sur fond noir absolu, accompagné du tintement métallique de la « rupture de la raison ».
  - **Le Sanglot Volcanique :** Les larmes de Gohan sont balayées par la déflagration. Le décor disparaît au profit de speedlines violet sombre.
  - **La Décharge Plasma (Bio-Lightning) :** Pour la première fois dans l'histoire de l'œuvre, l'aura ne se contente pas de brûler : elle crépite d'arcs électriques à angles vifs (30° à 90°), persistant 1 à 3 frames, traduisant une densité d'énergie inaccessible au SSJ standard.
- **Colorimétrie Référente :**
  - Aura de base : `#FFE500` (Jaune néon incandescent)
  - Décharges bio-électriques : `#00FFFF` (Cyan glacé) alterné avec `#9D4EDD` (Violet sombre)
  - Trait de rupture psychologique : `#FF0033` (Rouge cramoisi pur)

### 3. Gogeta Blue vs Broly (Film *Dragon Ball Super: Broly* — 2018)
*Réalisateur : Tatsuya Nagamine, Superviseur de l'animation : Naohiro Shintani*

- **Esthétique Shintani & Révolution Numérique :**
  - Shintani bannit les ombres dures complexes et les reflets plastifiés des années 2000 pour revenir au trait organique, souple et vibrant de Toriyama.
  - **Dimension Shatter (La Brèche Dimensionnelle) :** La collision des poings de Gogeta et Broly dépasse la résistance de la réalité tridimensionnelle. L'espace se fend comme un miroir de verre trempé, projetant les combattants dans un continuum nébulaire prismatique.
  - **Contraste Chromatique Extrême :** Oppose la sérénité céleste du divin SSGSS (Cyan, Azur, Poussière d'étoiles scintillante) à la fureur primitive incontrôlable de Broly Full Power (Vert émeraude radioactif, Phosphore de lave).
- **Colorimétrie Référente :**
  - Gogeta Blue - Cœur : `#F0FDFF` (Glace pure luminescente)
  - Gogeta Blue - Flamme : `#00E5FF` (Cyan vibrant)
  - Gogeta Blue - Profondeur : `#003B94` (Bleu cobalt abyssal)
  - Broly - Flamme émeraude : `#00FF66` (Vert radioactif)
  - Broly - Halos de choc : `#76FF03` (Lime fluorescent)

### 4. L'Apparition de Gohan Beast (Film *Dragon Ball Super: Super Hero* — 2022)
*Réalisateur : Tetsuro Kodama, Direction Artistique 3D CGI*

- **Évolution de la Démesure :**
  - Clin d'œil direct au déblocage du SSJ2 de 1993, mais porté à l'échelle divine/démoniaque.
  - **La Chevelure Argentée Céleste :** Les cheveux s'étirent démesurément vers le zénith, adoptant une teinte blanc platine minérale.
  - **L'Iris Rouge Rubis :** Le regard perd toute innocence pour arborer une pupille noire enserrée dans un rouge rubis ardent.
  - **L'Aura Hybride Blanc/Pourpre :** Deux couches antinomiques fusionnent : un noyau blanc incassable entouré d'une nappe magmatique pourpre/magenta d'où jaillissent des éclairs rouge sang et des ombres d'encre noire.
- **Colorimétrie Référente :**
  - Cœur de l'aura : `#F8F9FA` (Blanc platine dense)
  - Manteau d'énergie destructrice : `#9B00E8` (Pourpre royal saturé)
  - Halo externe : `#5B0099` (Abysse violet)
  - Arcs électriques destructeurs : `#FF0055` (Éclair cramoisi) et `#1A0022` (Contre-ombre noire)

### 5. Dragon Ball Daima (2024–2025)
*Œuvre testamentaire d'Akira Toriyama*

- **Retour à l'Aventure et à la Rondeur Tactile :**
  - Contrastes adoucis, lignes de contour d'encre expressives, réduction de la surabondance de particules numériques au profit d'un timing d'impacts précis.
  - Les effets de souffle et d'énergie adoptent des formes de volutes et d'impacts ronds typiques de l'époque *Dragon Ball* original (Ruban Rouge, 21e Tenkaichi Budokai).

---

## III. Matrice Colorimétrique Dynamique des 6 Grandes Auras

| Aura | Forme Canonique | Cœur (Core) | Flamme (Body) | Halo (Corona) | Étincelles / Particules | Ambiance Lumineuse |
|---|---|---|---|---|---|---|
| **Ki Jaune** | SSJ 1 / 2 / 3 | `#FFFDE7` (Ivoire) | `#FFD700` (Or) | `#FFA800` (Ambre) | `#00F0FF` (Cyan) | `drop-shadow(0 0 24px #ffd70088)` |
| **Kaio-ken** | Kaio-ken x3..x20 | `#FFCCD5` (Rose chair) | `#E60039` (Cramoisi) | `#800015` (Grenat) | Nappe thermique ondulée | `drop-shadow(0 0 28px #e60039aa)` |
| **God** | SSJ God | `#FFF0F3` (Blanc rosé) | `#E0115F` (Rubis magenta) | `#FF4500` (Vermillon) | Escarbilles d'étoiles flottantes | `drop-shadow(0 0 30px #ff2a0099)` |
| **Blue** | SSGSS / Blue Evolved | `#E1F5FE` (Glace) | `#00E5FF` (Cyan néon) | `#0D47A1` (Cobalt profond) | Poussière stéthoscopique et arcs bleus | `drop-shadow(0 0 32px #00e5ffbb)` |
| **Ultra Instinct** | Signe / Maîtrisé | `#FFFFFF` (Omni-blanc) | `#E0E6ED` (Argent liquide)| `#4A90E2` (Bleu brume) | Ondulation d'onde thermique et perles de lumière | `drop-shadow(0 0 35px #e0e6edaa)` |
| **Beast** | Gohan Beast | `#F8F9FA` (Platine pur) | `#9B00E8` (Pourpre astral) | `#5B0099` (Abysse violet) | Éclairs cramoisis `#FF0055` + contours noirs | `drop-shadow(0 0 40px #9b00e8cc)` |

---

## IV. Lignes d'Impact Toriyama & Grammaire de Case (Koma-wari)

Akira Toriyama possédait la science inégalée du dynamisme sur papier. Pour transposer cette force brute dans notre interface utilisateur Web :

1. **Lignes de Vitesse Asymétriques (Kinetic Speedlines) :**
   - Rayonnement depuis le point focal d'action (souvent décentré à 30% ou 70% pour un effet cinématique).
   - Alternance d'angles asymétriques avec une largeur de trait variable (1.5px à 3.5px) pour simuler la plume G-Pen du mangaka.
2. **Anneaux d'Onde de Choc (Shockwave Rings) :**
   - Anneaux d'expansion elliptiques simulant le franchissement du mur du son ou la pression du Ki au sol.
   - Atténuation de l'opacité ($1.0 \to 0.0$) et agrandissement du rayon ($0.8 \to 2.2$) en 350ms.
3. **Le Koma-wari Biseauté (Kinetic Panel Slant) :**
   - Les cartes d'action et bandeaux utilisent une inclinaison subtile de `-2deg` à `-3deg` (`skewX(-3deg)`), créant une tension directionnelle vers l'avant.
   - Les bordures utilisent l'encre pleine Toriyama : `border: 3px solid #000000; box-shadow: 4px 4px 0px #000000;`.
4. **L'Impact Frame Inversé (Inversion Stroboscopique) :**
   - Lors d'une validation critique (ex: achat, invocation Shenron, soumission de vote), l'écran subit une micro-inversion de 60ms (bicolore négatif noir/blanc ou rouge/noir).

---

## V. Architecture des Nouveaux Composants UI (`apps/site/src/components/ui/dragon-ball/`)

Pour enrichir notre suite de composants spécialisés, nous implémentons les briques suivantes :

1. **`<AuraContainer>` (`AuraContainer.tsx`) :**
   - Enveloppe visuelle dynamique dotée des 6 configurations d'auras (SSJ, Kaio-ken, God, Blue, Ultra Instinct, Beast).
   - Multi-couches : lueur diffuse floutée, flammes rayonnantes SVG, étincelles bio-électriques et distorsion thermique.
   - Respect strict de `prefers-reduced-motion` : bascule en aura statique élégante sans saccade.
2. **`<KineticSpeedlines>` (`KineticSpeedlines.tsx`) :**
   - Composant SVG performant générant des lignes d'impact radiales ou directionnelles avec contrôle du point focal $(cx, cy)$, de la densité et de la couleur.
3. **`<ImpactCutIn>` (`ImpactCutIn.tsx`) :**
   - Bandeau cinématique cinégénique (effet « fêlure mentale » de Gohan ou focus sur le regard), avec le trait rouge vif traversant l'écran.
4. **`<KiChargeButton>` (`KiChargeButton.tsx`) :**
   - Bouton d'action à charge progressive : un appui prolongé charge le Ki (effet de tremblement, amplification du halo, son ou vibration haptique, passage de SSJ1 à Beast).

---

## VI. Spécification des Tokens CSS dans `apps/site/src/app/globals.css`

Les déclarations s'intègrent dans le système Tailwind v4 du site :

```css
/* ==========================================================================
   Dragon Ball Kinetic & Aura Design Tokens
   ========================================================================== */

@theme inline {
  --color-aura-ssj-core: #fffde7;
  --color-aura-ssj-flare: #ffd700;
  --color-aura-ssj-outer: #ffa800;
  --color-aura-ssj-spark: #00f0ff;

  --color-aura-kaioken-core: #ffccd5;
  --color-aura-kaioken-flare: #e60039;
  --color-aura-kaioken-outer: #800015;

  --color-aura-god-core: #fff0f3;
  --color-aura-god-flare: #e0115f;
  --color-aura-god-outer: #ff4500;

  --color-aura-blue-core: #e1f5fe;
  --color-aura-blue-flare: #00e5ff;
  --color-aura-blue-outer: #0d47a1;

  --color-aura-ui-core: #ffffff;
  --color-aura-ui-flare: #e0e6ed;
  --color-aura-ui-outer: #4a90e2;

  --color-aura-beast-core: #f8f9fa;
  --color-aura-beast-flare: #9b00e8;
  --color-aura-beast-outer: #5b0099;
  --color-aura-beast-spark: #ff0055;
}

/* Animations d'Aura et d'Énergie */
@keyframes aura-pulse-divine {
  0%, 100% {
    transform: scale(1);
    opacity: 0.85;
    filter: blur(10px) brightness(1);
  }
  50% {
    transform: scale(1.05);
    opacity: 1;
    filter: blur(14px) brightness(1.25);
  }
}

@keyframes spark-flicker {
  0%, 100% { opacity: 0; transform: scale(0.9) rotate(0deg); }
  25% { opacity: 1; transform: scale(1.1) rotate(4deg); }
  50% { opacity: 0.2; transform: scale(0.95) rotate(-3deg); }
  75% { opacity: 0.9; transform: scale(1.05) rotate(2deg); }
}

@keyframes rage-slit-sweep {
  0% {
    transform: scaleX(0);
    opacity: 0;
  }
  30% {
    transform: scaleX(1);
    opacity: 1;
  }
  80% {
    transform: scaleX(1);
    opacity: 0.9;
  }
  100% {
    transform: scaleX(1);
    opacity: 0;
  }
}

@keyframes impact-camera-shake {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-3px, 2px) rotate(-0.5deg); }
  40% { transform: translate(3px, -2px) rotate(0.5deg); }
  60% { transform: translate(-2px, -1px) rotate(-0.3deg); }
  80% { transform: translate(2px, 1px) rotate(0.2deg); }
}
```

---

## VII. Conclusion & Déploiement

Cette architecture comble le fossé entre la rigueur d'un design system de production Web (AA/AAA WCAG, fluidité 60fps, bundle optimisé) et l'énergie sensationnelle, spectaculaire et passionnée d'Akira Toriyama et de l'animation Toei. L'exploitation de `bxc frames` pour objectiver les signatures visuelles confère à l'écosystème Shenron une fidélité d'adaptation unique au monde.
