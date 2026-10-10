// SPDX-License-Identifier: Apache-2.0
//! Le contrat « pet » de Codex : manifeste `pet.json`, pistes d'animation, minutage, états.
//!
//! ## Provenance
//!
//! Ce module est une **réimplémentation dérivée** du sous-système `pets` de
//! [`openai/codex`](https://github.com/openai/codex) (`codex-rs/tui/src/pets/`), sous licence
//! **Apache-2.0** — voir le fichier `NOTICE` à la racine de la crate. Ce qui en est repris : le
//! schéma du manifeste, les pistes par défaut, les bornes de validation, la sémantique
//! `loop_start` / `fallback`, l'algorithme de choix de frame par accumulation de durées, et le
//! modèle d'état à durée de vie. Source relue le 2026-10-09 sur `main` (`c63929af5051`) :
//! `model.rs` et `ambient.rs` sont inchangés depuis `10fbb61838` (2026-08-17).
//!
//! ## Un écart assumé, et pourquoi
//!
//! Le TUI de Codex exige un atlas de **1536 × 1872** (8 × 9 cellules) et rejette toute autre
//! taille ; Aphrody v2 est un 8 × **11** (1536 × 2288, seize directions de regard en plus), le
//! format de l'app Codex. Ce module lit donc la géométrie dans le **manifeste** et applique la
//! validation stricte à la géométrie déclarée. La contrainte 1536 × 1872 du TUI est reproduite
//! à part, dans [`crate::codex::valider_tui`], qui sert aussi à vérifier l'artefact
//! d'installation v1 (les neuf premières lignes de l'atlas v2, identiques au gabarit Codex).
//!
//! ## Portabilité — ce module ne lit jamais l'horloge
//!
//! Aucun `Instant`, aucun `SystemTime` : le temps écoulé est **passé en argument**, en
//! millisecondes. C'est ce qui rend le module utilisable tel quel dans un navigateur
//! (`performance.now()`), sur mobile, dans un terminal ou dans un test déterministe. La
//! résolution est la milliseconde là où Codex compte en nanosecondes : seules les cadences qui
//! ne divisent pas 1000 (7 fps → 142,857 ms) diffèrent, d'au plus une demi-milliseconde.

use std::collections::BTreeMap;

use crate::{AnimationsManifest, Error};

/// Largeur d'une cellule, en pixels. Commune à Codex et à Aphrody v2.
pub const CELLULE_LARGEUR: u32 = 192;
/// Hauteur d'une cellule, en pixels. Commune à Codex et à Aphrody v2.
pub const CELLULE_HAUTEUR: u32 = 208;
/// Nombre de colonnes par défaut. Commun aux deux contrats.
pub const COLONNES_DEFAUT: u32 = 8;
/// Nombre de lignes par défaut, **côté Codex** (Aphrody v2 en a 11).
pub const LIGNES_DEFAUT: u32 = 9;
/// Plafond de frames d'un pet, repris de Codex.
pub const MAX_FRAMES: usize = 256;
/// Plafond de cadence, repris de Codex : une piste au-delà est refusée.
pub const FPS_MAX: f64 = 60.0;
/// Cadence par défaut quand le manifeste n'en donne pas.
pub const FPS_DEFAUT: f64 = 8.0;
/// Nom de l'animation de repli par défaut.
pub const REPLI_DEFAUT: &str = "idle";
/// Nom de fichier d'atlas par défaut.
pub const ATLAS_DEFAUT: &str = "spritesheet.webp";
/// Le repos de l'app Codex dure six fois les durées natives de l'atlas (1680 ms = 6 × 280 ms…).
pub const RALENTI_REPOS: u64 = 6;
/// Nombre de passes de la séquence primaire d'un état avant de retomber au repos.
pub const PASSES_ETAT: usize = 3;
/// Alias historiques que Codex garde pour ses pistes d'état.
pub const ALIAS: [(&str, &str); 5] = [
    ("move_right", "running-right"),
    ("move_left", "running-left"),
    ("wave", "waving"),
    ("bounce", "jumping"),
    ("sad", "failed"),
];

/// La grille d'un atlas.
///
/// Comme chez Codex, un bloc `frame` présent doit porter ses **quatre** champs : un manifeste
/// qui n'en donne qu'une partie est refusé au parsing plutôt que complété en silence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Grille {
    /// Largeur d'une cellule.
    pub width: u32,
    /// Hauteur d'une cellule.
    pub height: u32,
    /// Colonnes.
    pub columns: u32,
    /// Lignes.
    pub rows: u32,
}

impl Default for Grille {
    fn default() -> Self {
        Self {
            width: CELLULE_LARGEUR,
            height: CELLULE_HAUTEUR,
            columns: COLONNES_DEFAUT,
            rows: LIGNES_DEFAUT,
        }
    }
}

impl Grille {
    /// Dimensions de l'atlas qu'implique cette grille, ou `None` en cas de débordement.
    #[must_use]
    pub const fn atlas(&self) -> Option<(u32, u32)> {
        match (self.width.checked_mul(self.columns), self.height.checked_mul(self.rows)) {
            (Some(l), Some(h)) => Some((l, h)),
            _ => None,
        }
    }

    /// Nombre de cellules.
    #[must_use]
    pub const fn cellules(&self) -> usize {
        (self.columns as usize) * (self.rows as usize)
    }

    /// Rectangle `(x, y, largeur, hauteur)` de la cellule d'indice `sprite_index`.
    ///
    /// L'indexation est **ligne par ligne** : `index = ligne * colonnes + colonne`, comme chez
    /// Codex. Rend `None` hors grille plutôt qu'un rectangle plausible qui rognerait le voisin.
    #[must_use]
    pub const fn cellule(&self, sprite_index: usize) -> Option<(u32, u32, u32, u32)> {
        if sprite_index >= self.cellules() {
            return None;
        }
        let colonnes = self.columns as usize;
        let ligne = (sprite_index / colonnes) as u32;
        let colonne = (sprite_index % colonnes) as u32;
        Some((colonne * self.width, ligne * self.height, self.width, self.height))
    }

    /// Vérifie que la grille est cohérente et tient sous les bornes de Codex.
    ///
    /// # Erreurs
    /// Si une dimension est nulle, si la grille déborde, ou si elle dépasse [`MAX_FRAMES`].
    pub fn valider(&self) -> Result<(), Error> {
        if self.width == 0 || self.height == 0 || self.columns == 0 || self.rows == 0 {
            return Err(Error::Invalid("grille : aucune dimension ne peut être nulle".into()));
        }
        if self.atlas().is_none() {
            return Err(Error::Invalid("grille : dimensions d'atlas hors limites".into()));
        }
        if self.cellules() > MAX_FRAMES {
            return Err(Error::Invalid(format!(
                "grille de {} cellules : le plafond est {MAX_FRAMES}",
                self.cellules()
            )));
        }
        Ok(())
    }

    /// Vérifie que l'atlas fourni fait **exactement** la taille qu'implique la grille.
    ///
    /// Codex refuse un atlas d'une autre taille plutôt que de le recadrer : un atlas décalé d'un
    /// pixel produirait des frames qui mordent sur leurs voisines, défaut qui ne se voit qu'une
    /// fois l'animation en marche. Même choix ici.
    ///
    /// # Erreurs
    /// Si les dimensions ne correspondent pas.
    pub fn valider_atlas(&self, largeur: u32, hauteur: u32) -> Result<(), Error> {
        let Some((al, ah)) = self.atlas() else {
            return Err(Error::Invalid("grille : dimensions d'atlas hors limites".into()));
        };
        if largeur != al || hauteur != ah {
            return Err(Error::Invalid(format!(
                "la grille doit couvrir exactement l'atlas : atlas {largeur}x{hauteur}, grille \
                 {al}x{ah} ({}x{} cellules de {}x{})",
                self.columns, self.rows, self.width, self.height
            )));
        }
        Ok(())
    }
}

/// Une frame d'une piste : quelle cellule, et combien de temps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct FrameTemps {
    /// Indice de la cellule dans la grille.
    pub sprite_index: usize,
    /// Durée d'affichage, en millisecondes.
    pub duree_ms: u64,
}

/// Une piste d'animation nommée.
///
/// `loop_start == None` veut dire **une seule passe** : la piste ne boucle pas, et la dernière
/// frame passe la main à `repli`. Ne pas supposer qu'une piste boucle parce qu'elle a plusieurs
/// frames — c'est l'avertissement explicite du contrat amont, et la source d'erreur la plus
/// courante en le lisant.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Piste {
    /// Les frames, dans l'ordre.
    pub frames: Vec<FrameTemps>,
    /// Indice de la frame où reboucler, ou `None` pour une piste à passe unique.
    pub loop_start: Option<usize>,
    /// Animation qui prend le relais quand une piste à passe unique se termine.
    pub repli: String,
}

impl Piste {
    /// Durée totale de la piste, en millisecondes.
    #[must_use]
    pub fn duree_totale_ms(&self) -> u64 {
        self.frames.iter().map(|f| f.duree_ms).sum()
    }
}

/// Ce qu'une frame courante apprend à l'appelant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tick {
    /// Cellule à afficher.
    pub sprite_index: usize,
    /// Millisecondes avant le prochain changement, ou `None` quand l'image est figée.
    ///
    /// C'est ce délai qu'il faut planifier — **pas** une cadence fixe. Une piste dont les
    /// frames durent 1680, 660 puis 1920 ms redessinée à 8 fps gaspillerait 20 réveils sur 21.
    pub delai_ms: Option<u64>,
}

/// Frame à afficher après `ecoule_ms` passées dans la piste.
///
/// Reprend `current_animation_frame` de Codex :
/// - une piste d'une seule frame est figée (aucun réveil planifié) ;
/// - avec `loop_start`, le temps au-delà de la durée totale reboucle **sur le seul segment de
///   boucle**, le préfixe n'étant joué qu'une fois — c'est ce qui permet à une animation
///   d'avoir une amorce puis un cycle ;
/// - sans `loop_start`, une fois la durée écoulée la dernière frame reste affichée, à charge de
///   l'appelant de basculer sur [`Piste::repli`].
#[must_use]
pub fn frame_courante(piste: &Piste, ecoule_ms: u64) -> Option<Tick> {
    if piste.frames.len() <= 1 {
        return piste.frames.first().map(|f| Tick { sprite_index: f.sprite_index, delai_ms: None });
    }
    let total = piste.duree_totale_ms();
    let effectif = match piste.loop_start.filter(|i| *i < piste.frames.len()) {
        Some(depart) => {
            let prefixe: u64 = piste.frames[..depart].iter().map(|f| f.duree_ms).sum();
            let boucle: u64 = piste.frames[depart..].iter().map(|f| f.duree_ms).sum();
            if ecoule_ms >= total && boucle > 0 {
                prefixe + (ecoule_ms.saturating_sub(prefixe)) % boucle
            } else {
                ecoule_ms
            }
        },
        None => {
            if ecoule_ms >= total {
                return piste
                    .frames
                    .last()
                    .map(|f| Tick { sprite_index: f.sprite_index, delai_ms: None });
            }
            ecoule_ms
        },
    };
    frame_a(piste, effectif)
}

fn frame_a(piste: &Piste, ecoule_ms: u64) -> Option<Tick> {
    let mut restant = ecoule_ms;
    for f in &piste.frames {
        // Codex compte une frame de durée nulle pour une unité : sans ce plancher, elle serait
        // sautée et le délai rendu pourrait valoir zéro, ce qui réveillerait l'appelant en boucle.
        let duree = f.duree_ms.max(1);
        if restant < duree {
            return Some(Tick { sprite_index: f.sprite_index, delai_ms: Some(duree - restant) });
        }
        restant -= duree;
    }
    piste.frames.last().map(|f| Tick { sprite_index: f.sprite_index, delai_ms: None })
}

// ---------------------------------------------------------------------------------------------
// Les pistes par défaut de Codex
// ---------------------------------------------------------------------------------------------

fn piste_repos(durees: [(usize, u64); 6]) -> Piste {
    Piste {
        frames: durees
            .into_iter()
            .map(|(sprite_index, duree_ms)| FrameTemps { sprite_index, duree_ms })
            .collect(),
        loop_start: Some(0),
        repli: REPLI_DEFAUT.to_string(),
    }
}

/// Piste d'état à la manière de Codex : la séquence primaire jouée [`PASSES_ETAT`] fois, puis
/// le repos en boucle (`loop_start` pointe sur le début du repos). L'état reste donc lisible
/// quelques secondes, puis le pet se calme sans que l'appelant ait à intervenir.
fn piste_etat(primaire: Vec<FrameTemps>, repos: &Piste) -> Piste {
    let n = primaire.len() * PASSES_ETAT;
    let frames =
        primaire.iter().cycle().take(n).copied().chain(repos.frames.iter().copied()).collect();
    Piste { frames, loop_start: Some(n), repli: REPLI_DEFAUT.to_string() }
}

/// Les pistes que Codex fournit à tout pet, recopiées de `default_animations()` (`model.rs`).
///
/// Un manifeste sans `animations` reçoit exactement celles-ci ; un manifeste qui en déclare
/// remplace les pistes de même nom et garde les autres.
#[must_use]
pub fn pistes_par_defaut() -> BTreeMap<String, Piste> {
    let repos = piste_repos([(0, 1680), (1, 660), (2, 660), (3, 840), (4, 840), (5, 1920)]);
    let colonnes = COLONNES_DEFAUT as usize;
    let etat = |ligne: usize, n: usize, duree: u64, derniere: u64| {
        let primaire = (0..n)
            .map(|c| FrameTemps {
                sprite_index: ligne * colonnes + c,
                duree_ms: if c == n - 1 { derniere } else { duree },
            })
            .collect();
        piste_etat(primaire, &repos)
    };
    let mut pistes = BTreeMap::from([
        ("running-right".to_string(), etat(1, 8, 120, 220)),
        ("running-left".to_string(), etat(2, 8, 120, 220)),
        ("waving".to_string(), etat(3, 4, 140, 280)),
        ("jumping".to_string(), etat(4, 5, 140, 280)),
        ("failed".to_string(), etat(5, 8, 140, 240)),
        ("waiting".to_string(), etat(6, 6, 150, 260)),
        ("running".to_string(), etat(7, 6, 120, 220)),
        ("review".to_string(), etat(8, 6, 150, 280)),
    ]);
    ajouter_alias(&mut pistes);
    pistes.insert(REPLI_DEFAUT.to_string(), repos);
    pistes
}

fn ajouter_alias(pistes: &mut BTreeMap<String, Piste>) {
    for (alias, cible) in ALIAS {
        if let Some(p) = pistes.get(cible).cloned() {
            pistes.insert(alias.to_string(), p);
        }
    }
}

/// Les pistes d'un paquet exporté (`animations.json`), composées selon la règle de Codex.
///
/// Les **valeurs** viennent du manifeste (lignes, colonnes, durées par frame) ; la **règle** est
/// celle de l'app Codex : repos = ligne `idle` ralentie de [`RALENTI_REPOS`] et bouclée, chaque
/// autre piste minutée = sa séquence jouée [`PASSES_ETAT`] fois puis le repos, une pose fixe =
/// une piste d'une frame. La ligne de regard (`directional-pose-set`) n'est pas une piste : voir
/// [`directions`]. Appliquée au paquet d'Aphrody, cette composition rend **exactement**
/// [`pistes_par_defaut`] sur les neuf lignes communes (vérifié par les tests).
///
/// # Erreurs
/// Sans piste `idle`, ou si une frame minutée n'a pas de durée.
pub fn pistes_depuis_animations(m: &AnimationsManifest) -> Result<BTreeMap<String, Piste>, Error> {
    let colonnes = m.atlas.columns as usize;
    let index = |f: &crate::Frame| f.row as usize * colonnes + f.column as usize;
    let duree = |nom: &str, f: &crate::Frame| {
        f.duration_ms.map(u64::from).ok_or_else(|| {
            Error::Invalid(format!("animation « {nom} » : frame {} sans durationMs", f.image))
        })
    };
    let idle = m
        .animations
        .get(REPLI_DEFAUT)
        .ok_or_else(|| Error::Invalid("paquet sans animation « idle »".into()))?;
    let repos = Piste {
        frames: idle
            .frames
            .iter()
            .map(|f| {
                Ok(FrameTemps {
                    sprite_index: index(f),
                    duree_ms: duree(REPLI_DEFAUT, f)? * RALENTI_REPOS,
                })
            })
            .collect::<Result<_, Error>>()?,
        loop_start: Some(0),
        repli: REPLI_DEFAUT.to_string(),
    };

    let mut pistes = BTreeMap::new();
    for (nom, a) in &m.animations {
        let piste = match a.kind.as_str() {
            "timed-animation" if nom != REPLI_DEFAUT => {
                let primaire = a
                    .frames
                    .iter()
                    .map(|f| Ok(FrameTemps { sprite_index: index(f), duree_ms: duree(nom, f)? }))
                    .collect::<Result<Vec<_>, Error>>()?;
                piste_etat(primaire, &repos)
            },
            "still" => Piste {
                frames: a
                    .frames
                    .iter()
                    .map(|f| FrameTemps { sprite_index: index(f), duree_ms: 0 })
                    .collect(),
                loop_start: Some(0),
                repli: REPLI_DEFAUT.to_string(),
            },
            _ => continue,
        };
        pistes.insert(nom.clone(), piste);
    }
    ajouter_alias(&mut pistes);
    pistes.insert(REPLI_DEFAUT.to_string(), repos);
    Ok(pistes)
}

/// Cellules de la ligne de regard, dans l'ordre de l'atlas : indice 0 vers le haut, puis dans
/// le sens horaire, `360 / n` degrés d'écart.
#[must_use]
pub fn directions(m: &AnimationsManifest) -> Vec<usize> {
    let colonnes = m.atlas.columns as usize;
    m.animations
        .values()
        .find(|a| a.kind == "directional-pose-set")
        .map(|a| a.frames.iter().map(|f| f.row as usize * colonnes + f.column as usize).collect())
        .unwrap_or_default()
}

/// Indice dans la ligne de regard d'un pointeur situé à `(dx, dy)` des yeux (axes de l'écran :
/// `y` croît vers le bas), ou `None` dans la zone morte.
///
/// Même arithmétique, dans le même ordre d'opérations, que `gaze()` côté web : c'est ce qui
/// permet de comparer les deux implémentations au bit près sur une même suite de points.
#[must_use]
pub fn regard(dx: f64, dy: f64, zone_morte: f64, n: usize) -> Option<usize> {
    if n == 0 || dx.hypot(dy) < zone_morte {
        return None;
    }
    let degres = dx.atan2(-dy) * 180.0 / std::f64::consts::PI;
    #[expect(clippy::cast_precision_loss, reason = "n est un nombre de poses (16)")]
    let pas = 360.0 / n as f64;
    let normalise = ((degres % 360.0) + 360.0) % 360.0;
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "normalise / pas est dans [0, n]"
    )]
    let i = (normalise / pas).round() as usize;
    Some(i % n)
}

// ---------------------------------------------------------------------------------------------
// Le manifeste `pet.json`
// ---------------------------------------------------------------------------------------------

/// Une piste telle qu'elle est écrite dans le manifeste.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PisteManifeste {
    /// Indices de cellules, dans l'ordre.
    #[serde(default)]
    pub frames: Vec<usize>,
    /// Cadence, en images par seconde.
    #[serde(default)]
    pub fps: Option<f64>,
    /// La piste boucle-t-elle ? Défaut : oui.
    #[serde(rename = "loop", default)]
    pub boucle: Option<bool>,
    /// Animation de repli pour une piste à passe unique (vide ⇒ `idle`).
    #[serde(default)]
    pub fallback: Option<String>,
}

/// Le manifeste `pet.json` — clés en `camelCase`, comme chez Codex.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifeste {
    /// Identifiant du pet (défaut : le nom du dossier).
    #[serde(default)]
    pub id: Option<String>,
    /// Nom affichable.
    #[serde(default)]
    pub display_name: Option<String>,
    /// Description libre.
    #[serde(default)]
    pub description: Option<String>,
    /// Chemin de l'atlas, **relatif au dossier du pet**.
    #[serde(default)]
    pub spritesheet_path: Option<String>,
    /// Géométrie de la grille (défaut : 8 × 9 cellules de 192 × 208).
    #[serde(default)]
    pub frame: Option<Grille>,
    /// Pistes, par nom.
    #[serde(default)]
    pub animations: BTreeMap<String, PisteManifeste>,
}

/// Un pet chargé et validé : géométrie, pistes minutées, identité.
#[derive(Debug, Clone)]
pub struct PetCodex {
    /// Identifiant.
    pub id: String,
    /// Nom affichable (défaut : l'identifiant).
    pub nom: String,
    /// Description.
    pub description: String,
    /// Chemin relatif de l'atlas.
    pub atlas: String,
    /// Géométrie.
    pub grille: Grille,
    /// Pistes minutées, par nom (pistes par défaut de Codex comprises).
    pub pistes: BTreeMap<String, Piste>,
}

/// Un chemin d'atlas doit rester **relatif et interne** au dossier du pet.
///
/// Un manifeste est une donnée, éventuellement téléchargée : accepter `../..` ou `/etc/passwd`
/// y ferait lire un fichier arbitraire. Refuser ici est la seule barrière — l'appelant qui
/// concatène ensuite n'a plus aucun moyen de savoir d'où le chemin vient.
fn valider_chemin_atlas(chemin: &str) -> Result<(), Error> {
    if chemin.is_empty() {
        return Err(Error::Invalid("chemin d'atlas vide".into()));
    }
    if chemin.starts_with('/') || chemin.starts_with('\\') || chemin.contains(':') {
        return Err(Error::Invalid(format!("chemin d'atlas non relatif : « {chemin} »")));
    }
    if chemin.split(['/', '\\']).any(|s| s == "..") {
        return Err(Error::Invalid(format!("chemin d'atlas sortant du dossier : « {chemin} »")));
    }
    Ok(())
}

fn non_vide(s: Option<&str>) -> Option<&str> {
    s.map(str::trim).filter(|s| !s.is_empty())
}

impl Manifeste {
    /// Parse un `pet.json`.
    ///
    /// # Erreurs
    /// Si le JSON est invalide ou si le manifeste ne passe pas [`Manifeste::valider`].
    pub fn depuis_json(json: &str) -> Result<PetCodex, Error> {
        let m: Self = serde_json::from_str(json)?;
        m.valider()
    }

    /// [`Manifeste::valider_dans`] avec `pet` pour identifiant de repli.
    ///
    /// # Erreurs
    /// Voir [`Manifeste::valider_dans`].
    pub fn valider(self) -> Result<PetCodex, Error> {
        self.valider_dans("pet")
    }

    /// Valide le manifeste et rend le pet minuté ; `repli_id` (le nom du dossier, chez Codex)
    /// sert d'identifiant quand le manifeste n'en donne pas.
    ///
    /// Contrôles repris de `load_pet_manifest` / `load_animations` : grille cohérente et sous le
    /// plafond de frames, chemin d'atlas relatif interne, pistes non vides, indices dans la
    /// grille, cadence finie dans `]0, 60]`, repli existant. Les pistes déclarées remplacent
    /// celles de [`pistes_par_defaut`] de même nom ; les autres restent.
    ///
    /// # Erreurs
    /// Au premier contrôle qui échoue, avec la raison — jamais un repli silencieux.
    pub fn valider_dans(self, repli_id: &str) -> Result<PetCodex, Error> {
        let grille = self.frame.unwrap_or_default();
        grille.valider()?;
        let atlas = non_vide(self.spritesheet_path.as_deref()).unwrap_or(ATLAS_DEFAUT).to_string();
        valider_chemin_atlas(&atlas)?;

        let cellules = grille.cellules();
        let mut pistes = pistes_par_defaut();
        for (nom, p) in self.animations {
            if p.frames.is_empty() {
                return Err(Error::Invalid(format!("animation « {nom} » sans aucune frame")));
            }
            if let Some(hors) = p.frames.iter().find(|i| **i >= cellules) {
                return Err(Error::Invalid(format!(
                    "animation « {nom} » : cellule {hors} hors d'une grille de {cellules} cellules"
                )));
            }
            let fps = p.fps.unwrap_or(FPS_DEFAUT);
            if !(fps.is_finite() && fps > 0.0 && fps <= FPS_MAX) {
                return Err(Error::Invalid(format!(
                    "animation « {nom} » : fps {fps} hors de ]0, {FPS_MAX}]"
                )));
            }
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "fps borné à ]0,60]"
            )]
            let duree_ms = (1000.0 / fps).round().max(1.0) as u64;
            let repli = non_vide(p.fallback.as_deref()).unwrap_or(REPLI_DEFAUT).to_string();
            pistes.insert(
                nom,
                Piste {
                    frames: p
                        .frames
                        .into_iter()
                        .map(|sprite_index| FrameTemps { sprite_index, duree_ms })
                        .collect(),
                    loop_start: p.boucle.unwrap_or(true).then_some(0),
                    repli,
                },
            );
        }
        for (nom, piste) in &pistes {
            if let Some(hors) = piste.frames.iter().find(|f| f.sprite_index >= cellules) {
                return Err(Error::Invalid(format!(
                    "animation « {nom} » : cellule {} hors d'une grille de {cellules} cellules",
                    hors.sprite_index
                )));
            }
            if !pistes.contains_key(&piste.repli) {
                return Err(Error::Invalid(format!(
                    "animation « {nom} » : le repli « {} » n'existe pas",
                    piste.repli
                )));
            }
        }

        let id = non_vide(self.id.as_deref()).unwrap_or(repli_id).to_string();
        Ok(PetCodex {
            nom: non_vide(self.display_name.as_deref()).unwrap_or(&id).to_string(),
            description: self.description.as_deref().map(str::trim).unwrap_or_default().into(),
            id,
            atlas,
            grille,
            pistes,
        })
    }
}

impl PetCodex {
    /// La piste nommée.
    #[must_use]
    pub fn piste(&self, nom: &str) -> Option<&Piste> {
        self.pistes.get(nom)
    }

    /// La piste à jouer après `ecoule_ms` dans `nom`, et sa frame.
    ///
    /// Reprend `current_animation` de Codex : un nom inconnu joue `idle` ; une piste à passe
    /// unique arrivée à son terme passe la main à son repli **une fois**, joué avec le même
    /// temps écoulé (Codex ne remet pas l'horloge à zéro au changement de piste).
    #[must_use]
    pub fn resoudre(&self, nom: &str, ecoule_ms: u64) -> Option<(&str, Tick)> {
        // Le nom rendu est emprunté à la CLÉ de la table, jamais à l'argument : sa durée de vie
        // est alors celle de `self` dans tous les cas.
        let (mut courant, mut piste) =
            self.pistes.get_key_value(nom).or_else(|| self.pistes.get_key_value(REPLI_DEFAUT))?;
        if piste.loop_start.is_none()
            && ecoule_ms >= piste.duree_totale_ms()
            && let Some((n, p)) = self.pistes.get_key_value(piste.repli.as_str())
        {
            (courant, piste) = (n, p);
        }
        frame_courante(piste, ecoule_ms).map(|t| (courant.as_str(), t))
    }
}

// ---------------------------------------------------------------------------------------------
// L'état ambiant
// ---------------------------------------------------------------------------------------------

/// Ce que le pet raconte de la session, et pour combien de temps.
///
/// Les durées de vie viennent de Codex : passé ce délai, l'état ne veut plus rien dire et le pet
/// retombe au repos plutôt que d'afficher indéfiniment un « en cours » vieux d'une journée.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Etat {
    /// Une tâche tourne.
    EnCours,
    /// Le pet attend une saisie.
    Attente,
    /// Un résultat est prêt à relire.
    Relecture,
    /// Quelque chose a échoué.
    Echec,
}

impl Etat {
    /// Les quatre états, dans l'ordre de Codex.
    pub const TOUS: [Self; 4] = [Self::EnCours, Self::Attente, Self::Relecture, Self::Echec];

    /// Nom de l'animation associée — c'est aussi le nom de l'état côté web.
    #[must_use]
    pub const fn animation(self) -> &'static str {
        match self {
            Self::EnCours => "running",
            Self::Attente => "waiting",
            Self::Relecture => "review",
            Self::Echec => "failed",
        }
    }

    /// Libellé affiché par Codex (vocabulaire de l'app, en anglais).
    #[must_use]
    pub const fn libelle(self) -> &'static str {
        match self {
            Self::EnCours => "Running",
            Self::Attente => "Needs input",
            Self::Relecture => "Ready",
            Self::Echec => "Blocked",
        }
    }

    /// Durée de vie de l'état, en millisecondes.
    #[must_use]
    pub const fn duree_vie_ms(self) -> u64 {
        match self {
            Self::EnCours => 3 * 60 * 1000,
            Self::Echec => 60 * 60 * 1000,
            Self::Attente => 24 * 60 * 60 * 1000,
            Self::Relecture => 7 * 24 * 60 * 60 * 1000,
        }
    }
}

/// L'état ambiant du pet : un état daté, ou rien, et l'instant où l'animation courante a démarré.
#[derive(Debug, Clone, Copy, Default)]
pub struct Ambiance {
    etat: Option<(Etat, u64)>,
    depart_ms: u64,
}

impl Ambiance {
    /// Une ambiance au repos dont l'horloge d'animation part de `maintenant_ms`.
    #[must_use]
    pub const fn depuis(maintenant_ms: u64) -> Self {
        Self { etat: None, depart_ms: maintenant_ms }
    }

    /// Pose un état, daté de `maintenant_ms`, et redémarre l'animation (comme
    /// `set_notification` chez Codex).
    pub const fn poser(&mut self, etat: Etat, maintenant_ms: u64) {
        self.etat = Some((etat, maintenant_ms));
        self.depart_ms = maintenant_ms;
    }

    /// Retire l'état courant ; l'horloge d'animation n'est pas remise à zéro, comme à
    /// l'expiration d'un état chez Codex.
    pub const fn effacer(&mut self) {
        self.etat = None;
    }

    /// L'état encore valide à `maintenant_ms`, et depuis combien de temps il dure.
    #[must_use]
    pub fn etat(&self, maintenant_ms: u64) -> Option<(Etat, u64)> {
        let (etat, pose) = self.etat?;
        let age = maintenant_ms.saturating_sub(pose);
        (age < etat.duree_vie_ms()).then_some((etat, age))
    }

    /// Nom de l'animation à jouer et temps écoulé dedans.
    ///
    /// Sans état valide, c'est [`REPLI_DEFAUT`] — le repos est l'état par défaut, pas une
    /// absence d'animation — joué depuis le dernier départ.
    #[must_use]
    pub fn animation(&self, maintenant_ms: u64) -> (&'static str, u64) {
        let ecoule = maintenant_ms.saturating_sub(self.depart_ms);
        self.etat(maintenant_ms).map_or((REPLI_DEFAUT, ecoule), |(e, _)| (e.animation(), ecoule))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn piste(frames: &[usize], duree_ms: u64, loop_start: Option<usize>) -> Piste {
        Piste {
            frames: frames.iter().map(|i| FrameTemps { sprite_index: *i, duree_ms }).collect(),
            loop_start,
            repli: "idle".into(),
        }
    }

    fn indices(p: &Piste) -> Vec<usize> {
        p.frames.iter().map(|f| f.sprite_index).collect()
    }

    fn durees(p: &Piste) -> Vec<u64> {
        p.frames.iter().map(|f| f.duree_ms).collect()
    }

    #[test]
    fn la_grille_par_defaut_est_celle_de_codex() {
        let g = Grille::default();
        assert_eq!(g.atlas(), Some((1536, 1872)), "8x9 cellules de 192x208");
        assert_eq!(g.cellules(), 72);
        assert_eq!((g.width, g.height, g.columns), (192, 208, 8));
    }

    #[test]
    fn la_grille_aphrody_v2_est_acceptee_par_le_manifeste() {
        let g = Grille { rows: 11, ..Grille::default() };
        g.valider().expect("11 lignes reste sous le plafond de 256 cellules");
        assert_eq!(g.atlas(), Some((1536, 2288)));
        assert_eq!(g.cellules(), 88);
        g.valider_atlas(1536, 2288).expect("atlas conforme");
        assert!(g.valider_atlas(1536, 1872).is_err(), "un atlas 8x9 ne remplit pas 8x11");
    }

    #[test]
    fn l_indexation_des_cellules_est_ligne_par_ligne() {
        let g = Grille::default();
        assert_eq!(g.cellule(0), Some((0, 0, 192, 208)));
        assert_eq!(g.cellule(8), Some((0, 208, 192, 208)), "index 8 = début de la ligne 1");
        assert_eq!(g.cellule(9), Some((192, 208, 192, 208)));
        assert_eq!(g.cellule(72), None, "hors grille rend None, pas un rectangle plausible");
    }

    #[test]
    fn une_piste_figee_ne_planifie_aucun_reveil() {
        let t = frame_courante(&piste(&[3], 100, Some(0)), 10_000).expect("tick");
        assert_eq!(t, Tick { sprite_index: 3, delai_ms: None });
    }

    #[test]
    fn le_delai_rendu_est_celui_de_la_frame_pas_une_cadence() {
        let p = Piste {
            frames: vec![
                FrameTemps { sprite_index: 0, duree_ms: 1680 },
                FrameTemps { sprite_index: 1, duree_ms: 660 },
            ],
            loop_start: Some(0),
            repli: "idle".into(),
        };
        assert_eq!(frame_courante(&p, 0).expect("tick").delai_ms, Some(1680));
        assert_eq!(frame_courante(&p, 1679).expect("tick").delai_ms, Some(1));
        let t = frame_courante(&p, 1680).expect("tick");
        assert_eq!((t.sprite_index, t.delai_ms), (1, Some(660)));
    }

    #[test]
    fn la_boucle_ne_rejoue_pas_le_prefixe() {
        let p = piste(&[0, 1, 2], 100, Some(1));
        assert_eq!(frame_courante(&p, 0).expect("t").sprite_index, 0);
        assert_eq!(frame_courante(&p, 300).expect("t").sprite_index, 1);
        assert_eq!(frame_courante(&p, 400).expect("t").sprite_index, 2);
        assert_eq!(frame_courante(&p, 500).expect("t").sprite_index, 1);
    }

    #[test]
    fn une_passe_unique_se_fige_sur_sa_derniere_frame() {
        let p = piste(&[4, 5, 6], 100, None);
        let t = frame_courante(&p, 10_000).expect("t");
        assert_eq!((t.sprite_index, t.delai_ms), (6, None));
    }

    #[test]
    fn une_frame_de_duree_nulle_compte_pour_une_milliseconde() {
        let p = piste(&[1, 2], 0, Some(0));
        assert_eq!(frame_courante(&p, 0), Some(Tick { sprite_index: 1, delai_ms: Some(1) }));
    }

    #[test]
    fn une_passe_unique_finie_passe_la_main_a_son_repli() {
        let json = r#"{
            "id": "aphrody",
            "frame": { "width": 192, "height": 208, "columns": 8, "rows": 11 },
            "animations": {
                "idle":   { "frames": [0, 1], "fps": 10 },
                "waving": { "frames": [24, 25], "fps": 10, "loop": false, "fallback": "idle" }
            }
        }"#;
        let pet = Manifeste::depuis_json(json).expect("manifeste");
        let (nom, _) = pet.resoudre("waving", 0).expect("tick");
        assert_eq!(nom, "waving");
        let (nom, t) = pet.resoudre("waving", 5_000).expect("tick");
        assert_eq!(nom, "idle");
        assert!(t.delai_ms.is_some(), "idle boucle, donc un réveil est planifié");
        assert_eq!(pet.resoudre("inconnue", 0).expect("tick").0, "idle", "nom inconnu ⇒ idle");
    }

    #[test]
    fn le_manifeste_refuse_ce_que_codex_refuse() {
        let cas = [
            (r#"{"id":"a","animations":{"idle":{"frames":[]}}}"#, "sans aucune frame"),
            (r#"{"id":"a","animations":{"x":{"frames":[0],"fps":0}}}"#, "hors de"),
            (r#"{"id":"a","animations":{"x":{"frames":[0],"fps":120.0}}}"#, "hors de"),
            (r#"{"id":"a","animations":{"idle":{"frames":[72]}}}"#, "cellule 72"),
            (
                r#"{"id":"a","animations":{"wave":{"frames":[1],"loop":false,"fallback":"missing"}}}"#,
                "« missing » n'existe pas",
            ),
            (r#"{"id":"a","spritesheetPath":"../evade.webp"}"#, "sortant du dossier"),
            (r#"{"id":"a","spritesheetPath":"/etc/passwd"}"#, "non relatif"),
            (r#"{"id":"a","frame":{"width":0,"height":208,"columns":8,"rows":9}}"#, "nulle"),
            (r#"{"id":"a","frame":{"width":8,"height":8,"columns":192,"rows":234}}"#, "plafond"),
            (r#"{"id":"a","frame":{"rows":11}}"#, "missing field"),
        ];
        for (json, attendu) in cas {
            let err = Manifeste::depuis_json(json).expect_err(json);
            let msg = format!("{err}");
            assert!(msg.contains(attendu), "attendu « {attendu} », obtenu « {msg} » pour {json}");
        }
    }

    #[test]
    fn les_defauts_du_manifeste_sont_ceux_de_codex() {
        let pet = Manifeste::depuis_json(r#"{"id":"a","animations":{"idle":{"frames":[0,1]}}}"#)
            .expect("manifeste");
        assert_eq!(pet.atlas, "spritesheet.webp");
        assert_eq!(pet.nom, "a", "sans displayName, le nom est l'identifiant");
        let idle = pet.piste("idle").expect("idle");
        assert_eq!(idle.frames[0].duree_ms, 125, "8 fps par défaut → 125 ms");
        assert_eq!(idle.loop_start, Some(0), "une piste boucle par défaut");
        assert_eq!(idle.repli, "idle");
        assert!(pet.piste("running").is_some(), "les pistes par défaut restent");
    }

    #[test]
    fn un_manifeste_sans_animation_recoit_les_pistes_de_codex() {
        let pet = Manifeste::depuis_json(r#"{"displayName":"  Chefito "}"#).expect("manifeste");
        assert_eq!((pet.id.as_str(), pet.nom.as_str()), ("pet", "Chefito"));
        let p = pet.pistes;
        assert_eq!(indices(&p["idle"]), vec![0, 1, 2, 3, 4, 5]);
        assert_eq!(durees(&p["idle"]), vec![1680, 660, 660, 840, 840, 1920]);
        let running = &p["running"];
        let primaire = vec![56, 57, 58, 59, 60, 61];
        assert_eq!(indices(running)[0..6], primaire);
        assert_eq!(indices(running)[12..18], primaire);
        assert_eq!(indices(running)[18..], indices(&p["idle"]));
        assert_eq!(durees(running)[0..6], vec![120, 120, 120, 120, 120, 220]);
        assert_eq!(running.loop_start, Some(18));
        assert_eq!(indices(&p["waiting"])[0..6], vec![48, 49, 50, 51, 52, 53]);
        assert_eq!(indices(&p["review"])[0..6], vec![64, 65, 66, 67, 68, 69]);
        assert_eq!(indices(&p["failed"])[0..8], vec![40, 41, 42, 43, 44, 45, 46, 47]);
        assert_eq!(p["sad"], p["failed"]);
        assert_eq!(p.len(), 14, "9 pistes + 5 alias");
    }

    #[test]
    fn une_piste_declaree_garde_sa_cadence_et_sa_forme() {
        let pet = Manifeste::depuis_json(
            r#"{"animations":{"custom":{"frames":[1,2],"fps":2.0,"loop":false,"fallback":"idle"}}}"#,
        )
        .expect("manifeste");
        let custom = pet.piste("custom").expect("custom");
        assert_eq!((indices(custom), durees(custom)), (vec![1, 2], vec![500, 500]));
        assert_eq!(custom.loop_start, None);
    }

    #[test]
    fn le_paquet_aphrody_compose_exactement_les_pistes_de_codex() {
        let m = AnimationsManifest::from_json(crate::BUNDLED_ANIMATIONS_JSON).expect("manifeste");
        let aphrody = pistes_depuis_animations(&m).expect("pistes");
        for (nom, attendue) in pistes_par_defaut() {
            assert_eq!(aphrody.get(&nom), Some(&attendue), "piste {nom}");
        }
        assert_eq!(indices(&aphrody["look-neutral"]), vec![6]);
        assert_eq!(directions(&m).len(), 16);
        assert_eq!(directions(&m)[0], 72, "regard vers le haut = ligne 9, colonne 0");
    }

    #[test]
    fn le_regard_suit_le_sens_horaire_depuis_le_haut() {
        assert_eq!(regard(1.0, 1.0, 24.0, 16), None, "zone morte");
        assert_eq!(regard(0.0, -100.0, 24.0, 16), Some(0));
        assert_eq!(regard(100.0, 0.0, 24.0, 16), Some(4));
        assert_eq!(regard(0.0, 100.0, 24.0, 16), Some(8));
        assert_eq!(regard(-100.0, 0.0, 24.0, 16), Some(12));
        assert_eq!(regard(-100.0, -30.0, 24.0, 16), Some(13), "-73,3° → 286,7° → pose 13");
    }

    #[test]
    fn un_etat_expire_et_le_pet_retombe_au_repos() {
        let mut a = Ambiance::default();
        a.poser(Etat::EnCours, 1_000);
        assert_eq!(a.animation(1_500), ("running", 500));
        assert_eq!(a.etat(1_000 + Etat::EnCours.duree_vie_ms()), None);
        let fin = 1_000 + Etat::EnCours.duree_vie_ms();
        assert_eq!(a.animation(fin), ("idle", Etat::EnCours.duree_vie_ms()));
    }

    #[test]
    fn les_durees_de_vie_sont_celles_du_contrat_amont() {
        assert_eq!(Etat::EnCours.duree_vie_ms(), 3 * 60 * 1000);
        assert_eq!(Etat::Echec.duree_vie_ms(), 60 * 60 * 1000);
        assert_eq!(Etat::Attente.duree_vie_ms(), 24 * 60 * 60 * 1000);
        assert_eq!(Etat::Relecture.duree_vie_ms(), 7 * 24 * 60 * 60 * 1000);
        let libelles = Etat::TOUS.map(Etat::libelle);
        assert_eq!(libelles, ["Running", "Needs input", "Ready", "Blocked"]);
    }

    #[test]
    fn un_repli_circulaire_ne_fait_pas_tourner_en_rond() {
        let json = r#"{
            "id": "a",
            "animations": {
                "x": { "frames": [0], "loop": false, "fallback": "y" },
                "y": { "frames": [1], "loop": false, "fallback": "x" }
            }
        }"#;
        let pet = Manifeste::depuis_json(json).expect("manifeste");
        assert!(pet.resoudre("x", 10_000).is_some());
    }
}
