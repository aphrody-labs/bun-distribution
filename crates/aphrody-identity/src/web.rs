// SPDX-License-Identifier: Apache-2.0
//! Le pet sur le web : les données que `@aphrody/identity` génère depuis cette crate.
//!
//! Le runtime web (`m3/packages/identity/src/runtime.ts`, élément `<aphrody-pet>`) ne recopie
//! aucune valeur : pistes composées, directions, états et feuille CSS sortent d'ici, en un seul
//! JSON (`assets/aphrody/web.json`). Il reprend l'**algorithme** de [`crate::pets`] —
//! `frame_courante`, `resoudre`, `Ambiance`, `regard` — et la suite de ticks de
//! [`fixture_parite`] (`tests/fixtures/parite-web.json`) vérifie, des deux côtés, que les deux
//! implémentations rendent la même frame et le même délai au tick près.

use std::collections::BTreeMap;

use aphrody_sprite_sheet::{Sprite, SpriteSheet, assainir_nom};
use serde::Serialize;

use crate::pets::{self, Ambiance, Etat, Manifeste, PetCodex, Piste, Tick};
use crate::{AnimationsManifest, Error, PetManifest};

/// Zone morte du regard, en pixels CSS à l'échelle 1 (le rayon autour des yeux où le pet garde
/// la pose neutre).
pub const ZONE_MORTE: f64 = 24.0;

/// Géométrie de l'atlas, en pixels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtlasWeb {
    /// Largeur de l'atlas.
    pub width: u32,
    /// Hauteur de l'atlas.
    pub height: u32,
    /// Largeur d'une cellule.
    pub cell_width: u32,
    /// Hauteur d'une cellule.
    pub cell_height: u32,
    /// Colonnes.
    pub columns: u32,
    /// Lignes.
    pub rows: u32,
}

/// Une piste sous sa forme compacte : `[cellule, durée en ms]` par frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PisteWeb {
    /// Frames.
    pub frames: Vec<[u64; 2]>,
    /// Indice de reprise de la boucle, ou `null` pour une passe unique.
    pub loop_start: Option<usize>,
    /// Piste de repli.
    pub fallback: String,
}

impl From<&Piste> for PisteWeb {
    fn from(p: &Piste) -> Self {
        Self {
            frames: p
                .frames
                .iter()
                .map(|f| [f.sprite_index as u64, f.duree_ms])
                .collect(),
            loop_start: p.loop_start,
            fallback: p.repli.clone(),
        }
    }
}

/// Un état ambiant : durée de vie et libellé Codex.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EtatWeb {
    /// Durée de vie, en millisecondes.
    pub lifetime_ms: u64,
    /// Libellé affiché.
    pub label: &'static str,
}

/// Tout ce que le runtime web lit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DonneesWeb {
    /// Identifiant.
    pub id: String,
    /// Nom affiché.
    pub display_name: String,
    /// `spriteVersionNumber`.
    pub version: u32,
    /// Géométrie de l'atlas.
    pub atlas: AtlasWeb,
    /// Pistes composées selon la règle de Codex (alias compris).
    pub tracks: BTreeMap<String, PisteWeb>,
    /// Ligne de regard, sens horaire depuis le haut.
    pub directions: Vec<usize>,
    /// Cellule de la pose neutre.
    pub neutral: usize,
    /// États, par nom d'animation.
    pub states: BTreeMap<&'static str, EtatWeb>,
    /// Zone morte du regard, en pixels CSS à l'échelle 1.
    pub gaze_deadzone: f64,
    /// Feuille CSS des cellules (`.nie-sprite`, `.nie-c<i>`), produite par
    /// `aphrody-sprite-sheet`.
    pub css: String,
}

/// La feuille de sprites des cellules : une classe `nie-c<i>` par cellule de la grille.
///
/// L'URL de l'atlas écrite dans la feuille est relative (`spritesheet.webp`) ; l'élément web la
/// remplace par son attribut `src`.
#[must_use]
pub fn feuille(m: &AnimationsManifest) -> SpriteSheet {
    let a = &m.atlas;
    let cellules = (a.columns * a.rows) as usize;
    let sprites = (0..cellules)
        .map(|i| {
            let (x, y) = (
                i as u32 % a.columns * a.cell_width,
                i as u32 / a.columns * a.cell_height,
            );
            let nom = format!("c{i}");
            #[expect(
                clippy::cast_possible_wrap,
                reason = "atlas de quelques milliers de pixels"
            )]
            Sprite {
                classe: assainir_nom(&nom),
                nom,
                x: x as i32,
                y: y as i32,
                largeur: a.cell_width as i32,
                hauteur: a.cell_height as i32,
            }
        })
        .collect();
    #[expect(
        clippy::cast_possible_wrap,
        reason = "atlas de quelques milliers de pixels"
    )]
    SpriteSheet {
        nom: m.pet.id.clone(),
        largeur: a.width as i32,
        hauteur: a.height as i32,
        sprites,
    }
}

/// Les données web d'un paquet.
///
/// # Errors
/// Si le manifeste d'animations est incomplet (pas d'`idle`, pas de pose neutre).
pub fn donnees_web(pet: &PetManifest, m: &AnimationsManifest) -> Result<DonneesWeb, Error> {
    let pistes = pets::pistes_depuis_animations(m)?;
    let neutral = pistes
        .get("look-neutral")
        .or_else(|| pistes.get(pets::REPLI_DEFAUT))
        .and_then(|p| p.frames.first())
        .map(|f| f.sprite_index)
        .ok_or_else(|| Error::Invalid("paquet sans pose neutre".into()))?;
    let a = &m.atlas;
    Ok(DonneesWeb {
        id: pet.id.clone(),
        display_name: pet.display_name.clone(),
        version: pet.sprite_version_number,
        atlas: AtlasWeb {
            width: a.width,
            height: a.height,
            cell_width: a.cell_width,
            cell_height: a.cell_height,
            columns: a.columns,
            rows: a.rows,
        },
        tracks: pistes.iter().map(|(n, p)| (n.clone(), p.into())).collect(),
        directions: pets::directions(m),
        neutral,
        states: Etat::TOUS
            .iter()
            .map(|e| {
                (
                    e.animation(),
                    EtatWeb {
                        lifetime_ms: e.duree_vie_ms(),
                        label: e.libelle(),
                    },
                )
            })
            .collect(),
        gaze_deadzone: ZONE_MORTE,
        css: feuille(m).vers_css("spritesheet.webp"),
    })
}

/// Les données web du paquet embarqué, sérialisées comme `assets/aphrody/web.json`.
///
/// # Errors
/// Si le paquet embarqué ne se lit pas.
pub fn web_json_embarque() -> Result<String, Error> {
    let pet: PetManifest = serde_json::from_str(crate::BUNDLED_PET_JSON)?;
    let m = AnimationsManifest::from_json(crate::BUNDLED_ANIMATIONS_JSON)?;
    Ok(json_lisible(&serde_json::to_value(donnees_web(&pet, &m)?)?))
}

/// JSON indenté de deux espaces, sauf les tableaux de scalaires, écrits sur une ligne : une frame
/// `[cellule, durée]` ou un tick reste lisible et un diff ne touche que la ligne concernée.
#[must_use]
pub fn json_lisible(v: &serde_json::Value) -> String {
    let mut s = String::new();
    ecrire_json(v, 0, &mut s);
    s.push('\n');
    s
}

fn ecrire_json(v: &serde_json::Value, niveau: usize, s: &mut String) {
    use serde_json::Value;
    let marge = |n: usize| "  ".repeat(n);
    match v {
        Value::Array(a) if a.is_empty() || a.iter().all(|x| !x.is_array() && !x.is_object()) => {
            s.push_str(&v.to_string());
        }
        Value::Array(a) => {
            s.push_str("[\n");
            for (i, x) in a.iter().enumerate() {
                s.push_str(&marge(niveau + 1));
                ecrire_json(x, niveau + 1, s);
                s.push_str(if i + 1 < a.len() { ",\n" } else { "\n" });
            }
            s.push_str(&marge(niveau));
            s.push(']');
        }
        Value::Object(o) if o.is_empty() => s.push_str("{}"),
        Value::Object(o) => {
            s.push_str("{\n");
            for (i, (k, x)) in o.iter().enumerate() {
                s.push_str(&marge(niveau + 1));
                s.push_str(&Value::String(k.clone()).to_string());
                s.push_str(": ");
                ecrire_json(x, niveau + 1, s);
                s.push_str(if i + 1 < o.len() { ",\n" } else { "\n" });
            }
            s.push_str(&marge(niveau));
            s.push('}');
        }
        _ => s.push_str(&v.to_string()),
    }
}

// ---------------------------------------------------------------------------------------------
// Parité Rust ↔ web
// ---------------------------------------------------------------------------------------------

/// Les temps de test d'une piste : chaque frontière de frame ±1 ms sur un passage complet puis
/// un second tour du segment de boucle, et des temps pseudo-aléatoires jusqu'à dix millions de
/// millisecondes.
fn temps_de_test(piste: &Piste, graine: &mut u64) -> Vec<u64> {
    let mut temps = vec![0, 1];
    let mut t = 0u64;
    let boucle = piste
        .loop_start
        .and_then(|i| piste.frames.get(i..))
        .unwrap_or_default();
    for f in piste.frames.iter().chain(boucle) {
        t += f.duree_ms.max(1);
        temps.extend([t - 1, t, t + 1]);
    }
    for _ in 0..16 {
        // LCG de Knuth : déterministe, identique d'une machine à l'autre.
        *graine = graine
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        temps.push((*graine >> 33) % 10_000_000);
    }
    temps.sort_unstable();
    temps.dedup();
    temps
}

fn tick_json(nom: &str, ecoule: u64, t: Option<(&str, Tick)>) -> serde_json::Value {
    match t {
        Some((piste, t)) => serde_json::json!([ecoule, nom, piste, t.sprite_index, t.delai_ms]),
        None => serde_json::json!([ecoule, nom, null, null, null]),
    }
}

fn sequences(pet: &PetCodex, noms: &[&str], graine: &mut u64) -> Vec<serde_json::Value> {
    let mut lignes = Vec::new();
    for (nom, piste) in pet
        .pistes
        .iter()
        .filter(|(n, _)| noms.contains(&n.as_str()))
    {
        for t in temps_de_test(piste, graine) {
            lignes.push(tick_json(nom, t, pet.resoudre(nom, t)));
        }
    }
    lignes.push(tick_json("inconnue", 777, pet.resoudre("inconnue", 777)));
    lignes
}

/// La suite de parité : pour chaque pet de test, ses pistes, les ticks attendus de
/// `resoudre`, un scénario d'ambiance et une rose de points pour le regard.
///
/// # Errors
/// Si le paquet embarqué ne se lit pas.
pub fn fixture_parite() -> Result<serde_json::Value, Error> {
    let pet: PetManifest = serde_json::from_str(crate::BUNDLED_PET_JSON)?;
    let m = AnimationsManifest::from_json(crate::BUNDLED_ANIMATIONS_JSON)?;
    let aphrody = PetCodex {
        id: pet.id.clone(),
        nom: pet.display_name.clone(),
        description: String::new(),
        atlas: pet.spritesheet_path.clone(),
        grille: pets::Grille::default(),
        pistes: pets::pistes_depuis_animations(&m)?,
    };
    // Un manifeste à pistes à passe unique : Aphrody n'en a pas, il faut pourtant éprouver le
    // repli et le gel sur la dernière frame.
    let synthetique = Manifeste::depuis_json(
        r#"{"id":"synthetique","animations":{
            "wave":{"frames":[24,25,26],"fps":7,"loop":false,"fallback":"blink"},
            "blink":{"frames":[1,2],"fps":3,"loop":false},
            "still":{"frames":[9]},
            "spin":{"frames":[3,4,5,6],"fps":60}
        }}"#,
    )?;

    let mut graine = 0x00C0_FFEE_u64;
    let mut cas = Vec::new();
    // Les alias sont des copies : les rejouer n'éprouverait rien de plus.
    let propres: Vec<&str> = aphrody
        .pistes
        .keys()
        .map(String::as_str)
        .filter(|n| !pets::ALIAS.iter().any(|(a, _)| a == n))
        .collect();
    let declares = ["wave", "blink", "still", "spin", "idle"];
    for (p, noms) in [
        (&aphrody, propres.as_slice()),
        (&synthetique, declares.as_slice()),
    ] {
        let pistes: BTreeMap<&str, PisteWeb> = p
            .pistes
            .iter()
            .map(|(n, piste)| (n.as_str(), piste.into()))
            .collect();
        cas.push(serde_json::json!({
            "id": p.id,
            "tracks": pistes,
            "ticks": sequences(p, noms, &mut graine),
        }));
    }

    // Ambiance : une suite d'opérations datées, et ce que le pet joue à chaque instant.
    let mut a = Ambiance::depuis(100);
    let mut ambiance = Vec::new();
    let ops: [(&str, Option<Etat>, u64); 9] = [
        ("voir", None, 100),
        ("voir", None, 5_000),
        ("poser", Some(Etat::EnCours), 6_000),
        ("voir", None, 6_000),
        ("voir", None, 6_000 + Etat::EnCours.duree_vie_ms() - 1),
        ("voir", None, 6_000 + Etat::EnCours.duree_vie_ms()),
        ("poser", Some(Etat::Echec), 200_000),
        ("effacer", None, 200_500),
        ("voir", None, 201_000),
    ];
    for (op, etat, t) in ops {
        match (op, etat) {
            ("poser", Some(e)) => a.poser(e, t),
            ("effacer", _) => a.effacer(),
            _ => {}
        }
        let (nom, ecoule) = a.animation(t);
        let tick = aphrody.resoudre(nom, ecoule);
        ambiance.push(serde_json::json!({
            "op": op,
            "state": etat.map(Etat::animation),
            "now": t,
            "animation": nom,
            "elapsed": ecoule,
            "sprite": tick.map(|(_, t)| t.sprite_index),
            "delay": tick.and_then(|(_, t)| t.delai_ms),
        }));
    }

    let n = pets::directions(&m).len();
    let mut regard = Vec::new();
    for i in 0..48 {
        let angle = f64::from(i) * 7.5 + 1.25;
        for rayon in [10.0, 23.9, 24.0, 160.0] {
            let (dx, dy) = (
                rayon * angle.to_radians().sin(),
                -rayon * angle.to_radians().cos(),
            );
            regard.push(serde_json::json!([
                dx,
                dy,
                pets::regard(dx, dy, ZONE_MORTE, n)
            ]));
        }
    }

    Ok(serde_json::json!({
        "schema": 1,
        "gazeDeadzone": ZONE_MORTE,
        "cases": cas,
        "ambient": ambiance,
        "gaze": regard,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_feuille_couvre_chaque_cellule_de_l_atlas() {
        let m = AnimationsManifest::from_json(crate::BUNDLED_ANIMATIONS_JSON).expect("manifeste");
        let f = feuille(&m);
        assert_eq!(f.len(), 88);
        let css = f.vers_css("spritesheet.webp");
        assert!(
            css.contains(".nie-c0 { width: 192px; height: 208px; background-position: 0px 0px; }")
        );
        assert!(css.contains(
            ".nie-c87 { width: 192px; height: 208px; background-position: -1344px -2080px; }"
        ));
    }

    #[test]
    fn les_donnees_web_portent_les_pistes_de_codex() {
        let pet: PetManifest = serde_json::from_str(crate::BUNDLED_PET_JSON).expect("pet");
        let m = AnimationsManifest::from_json(crate::BUNDLED_ANIMATIONS_JSON).expect("manifeste");
        let d = donnees_web(&pet, &m).expect("données");
        assert_eq!(d.directions.len(), 16);
        assert_eq!(d.neutral, 6);
        assert_eq!(d.tracks["running"].loop_start, Some(18));
        assert_eq!(d.tracks["idle"].frames[0], [0, 1680]);
        assert_eq!(d.states["waiting"].label, "Needs input");
    }
}
