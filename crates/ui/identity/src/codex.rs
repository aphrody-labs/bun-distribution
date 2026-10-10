// SPDX-License-Identifier: Apache-2.0
//! Conformité au format **Codex Pet**, artefacts d'installation et installation native.
//!
//! ## Spécification vérifiée le 2026-10-09
//!
//! - `openai/codex`, `main` à `c63929af5051` (2026-10-09) : `codex-rs/tui/src/pets/model.rs`
//!   et `catalog.rs` sont inchangés depuis `10fbb61838` (2026-08-17) ; depuis la vérification
//!   précédente (2026-09-05), seuls des commits de présentation du sélecteur (`79d2144ec6`,
//!   `5ee2bdf1e0`) ont touché le dossier. Le format n'a pas bougé.
//! - Galerie `legeling/awesome-codex-pet` (code MIT ; assets CC BY-NC 4.0, ni copiés ni
//!   redistribués ici) : installeur `scripts/install.mjs`, gabarits v1 et v2.
//!
//! | Version | Atlas | Colonnes × lignes | `spriteVersionNumber` | Lu par |
//! |---|---|---|---|---|
//! | v1 | 1536 × 1872 | 8 × 9  | absent ou `1` | TUI Codex **et** app Codex |
//! | v2 | 1536 × 2288 | 8 × 11 | `2` (+ 16 directions de regard) | app Codex (`hatch-pet-v2`) |
//!
//! Le TUI refuse tout atlas qui n'est pas exactement 1536 × 1872 (« spritesheet must be
//! 1536x1872 pixels ») : le paquet v2 d'Aphrody y serait rejeté. L'installation native produit
//! donc par défaut un **artefact v1** — les neuf premières lignes de l'atlas v2, qui suivent déjà
//! le gabarit Codex ligne pour ligne — et la v2 complète sur demande, pour l'app.
//!
//! Emplacement attendu : `$CODEX_HOME/pets/<id>/pet.json` + `spritesheet.webp`
//! (`CODEX_HOME` vaut `~/.codex` par défaut) ; sélection par `[tui] pet = "<id>"` dans
//! `config.toml` ou par le sélecteur `/pets`.

use crate::pets::{self, Grille, Manifeste, PetCodex};
use crate::{AnimationsManifest, Error, Pet, PetManifest, sha256_hex};
use serde::Serialize;

/// Dimensions attendues d'un atlas, par version de la spécification.
const V1: (u32, u32, u32, u32) = (1536, 1872, 8, 9);
/// Idem pour la v2, qui ajoute les seize directions de regard.
const V2: (u32, u32, u32, u32) = (1536, 2288, 8, 11);
/// Nombre de poses attendues dans `look-directions` pour un pet v2.
const DIRECTIONS_V2: usize = 16;
/// Plafond de `pet.json` de l'installeur de la galerie (64 Kio).
pub const MAX_PET_JSON: usize = 64 * 1024;
/// Plafond de l'atlas de l'installeur de la galerie (5 Mo).
pub const MAX_ATLAS: usize = 5_000_000;
/// Les deux seuls fichiers d'un paquet installé.
pub const FICHIERS: [&str; 2] = ["pet.json", "spritesheet.webp"];

/// Version de la spécification à laquelle un paquet se conforme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Version {
    /// 8 × 9, sans directions de regard.
    V1,
    /// 8 × 11, avec seize directions de regard.
    V2,
}

/// Verdict de conformité, avec le détail de ce qui cloche le cas échéant.
#[derive(Debug, Clone, Serialize)]
pub struct Conformite {
    /// Version déduite des dimensions de l'atlas.
    pub version: Option<Version>,
    /// Écarts constatés. Vide ⇒ le paquet est installable tel quel.
    pub ecarts: Vec<String>,
}

impl Conformite {
    /// Le paquet est-il conforme ?
    #[must_use]
    pub fn ok(&self) -> bool {
        self.version.is_some() && self.ecarts.is_empty()
    }
}

/// Entrée d'`install-manifest.json` décrivant un pet installable.
///
/// C'est ce que la galerie publie pour permettre l'installation sans cloner : chaque fichier
/// y est décrit par sa taille **et** son empreinte, de sorte qu'un téléchargement tronqué ou
/// substitué se voie avant d'être écrit sur le disque de quelqu'un.
#[derive(Debug, Clone, Serialize)]
pub struct EntreeInstallation {
    /// Nom affiché du pet.
    pub name: String,
    /// `2` pour la v2 ; omis ou `1` pour la v1.
    #[serde(rename = "spriteVersionNumber")]
    pub sprite_version_number: u32,
    /// SHA-256 de `pet.json`.
    #[serde(rename = "petJsonSha256")]
    pub pet_json_sha256: String,
    /// Taille de `pet.json`, en octets.
    #[serde(rename = "petJsonBytes")]
    pub pet_json_bytes: usize,
    /// SHA-256 de la feuille de sprites servie au runtime (le WebP).
    #[serde(rename = "spritesheetSha256")]
    pub spritesheet_sha256: String,
    /// Taille de cette feuille, en octets.
    #[serde(rename = "spritesheetBytes")]
    pub spritesheet_bytes: usize,
    /// Largeur de l'atlas.
    #[serde(rename = "spritesheetWidth")]
    pub spritesheet_width: u32,
    /// Hauteur de l'atlas.
    #[serde(rename = "spritesheetHeight")]
    pub spritesheet_height: u32,
}

/// Vérifie qu'un paquet respecte la spécification Codex Pet.
#[must_use]
pub fn conformite(pet: &PetManifest, manifest: &AnimationsManifest) -> Conformite {
    let (l, h, c, r) =
        (manifest.atlas.width, manifest.atlas.height, manifest.atlas.columns, manifest.atlas.rows);
    let mut ecarts = Vec::new();

    let version = if (l, h, c, r) == V2 {
        Some(Version::V2)
    } else if (l, h, c, r) == V1 {
        Some(Version::V1)
    } else {
        ecarts.push(format!(
            "atlas {l}×{h} en {c}×{r} : ni v1 (1536×1872, 8×9) ni v2 (1536×2288, 8×11)"
        ));
        None
    };

    // La correspondance version ↔ `spriteVersionNumber` est la seule chose qu'un installeur
    // lit avant de décoder l'atlas : si elle ment, il découpe la grille au mauvais pas.
    match (version, pet.sprite_version_number) {
        (Some(Version::V2), n) if n != 2 => {
            ecarts.push(format!("atlas v2 mais spriteVersionNumber = {n} (attendu 2)"));
        },
        (Some(Version::V1), n) if n != 1 => {
            ecarts.push(format!("atlas v1 mais spriteVersionNumber = {n} (attendu 1)"));
        },
        _ => {},
    }

    if version == Some(Version::V2) {
        match manifest.animations.get("look-directions") {
            Some(a) if a.frames.len() != DIRECTIONS_V2 => ecarts.push(format!(
                "look-directions porte {} poses (attendu {DIRECTIONS_V2})",
                a.frames.len()
            )),
            None => ecarts.push("un pet v2 doit porter l'animation look-directions".into()),
            Some(_) => {},
        }
    }

    if pet.spritesheet_path != "spritesheet.webp" {
        ecarts.push(format!(
            "spritesheetPath = {} (l'installeur attend spritesheet.webp)",
            pet.spritesheet_path
        ));
    }

    Conformite { version, ecarts }
}

/// Produit l'entrée d'installation du paquet embarqué.
///
/// # Errors
/// Rend [`Error::Invalid`] si le paquet n'est pas conforme — publier une entrée pour un
/// paquet qu'un installeur refusera n'aide personne.
pub fn entree_installation(
    pet: &PetManifest,
    manifest: &AnimationsManifest,
    pet_json: &[u8],
    spritesheet_webp: &[u8],
) -> Result<EntreeInstallation, Error> {
    let c = conformite(pet, manifest);
    if !c.ok() {
        return Err(Error::Invalid(format!(
            "paquet non conforme au format Codex Pet : {}",
            c.ecarts.join(" ; ")
        )));
    }
    Ok(EntreeInstallation {
        name: pet.display_name.clone(),
        sprite_version_number: pet.sprite_version_number,
        pet_json_sha256: sha256_hex(pet_json),
        pet_json_bytes: pet_json.len(),
        spritesheet_sha256: sha256_hex(spritesheet_webp),
        spritesheet_bytes: spritesheet_webp.len(),
        spritesheet_width: manifest.atlas.width,
        spritesheet_height: manifest.atlas.height,
    })
}

// ---------------------------------------------------------------------------------------------
// Validations reproduites
// ---------------------------------------------------------------------------------------------

/// Dimensions d'une image WebP, lues dans son en-tête (VP8, VP8L ou VP8X), sans décoder.
///
/// # Errors
/// Si les octets ne sont pas un conteneur `RIFF…WEBP` lisible.
pub fn dimensions_webp(octets: &[u8]) -> Result<(u32, u32), Error> {
    if octets.len() < 12 || &octets[0..4] != b"RIFF" || &octets[8..12] != b"WEBP" {
        return Err(Error::Invalid("spritesheet.webp n'est pas une image WebP".into()));
    }
    let lecteur =
        image::ImageReader::with_format(std::io::Cursor::new(octets), image::ImageFormat::WebP);
    lecteur.into_dimensions().map_err(|e| Error::Invalid(format!("en-tête WebP illisible : {e}")))
}

/// Reproduit le chargement d'un pet personnalisé par le **TUI** de Codex
/// (`load_pet_manifest`), sur les octets des deux fichiers.
///
/// Contrôles, dans l'ordre amont : manifeste JSON valide (bloc `frame` complet s'il est
/// présent), chemin d'atlas relatif interne, atlas lisible d'exactement 1536 × 1872, grille qui
/// couvre l'atlas, au plus 256 cellules, pistes valides (voir [`Manifeste::valider_dans`]).
/// `repli_id` est le nom du dossier.
///
/// # Errors
/// Au premier contrôle qui échoue, avec la raison.
pub fn valider_tui(pet_json: &[u8], atlas: &[u8], repli_id: &str) -> Result<PetCodex, Error> {
    let manifeste: Manifeste = serde_json::from_slice(pet_json)?;
    let grille = manifeste.frame.unwrap_or_default();
    let pet = manifeste.valider_dans(repli_id)?;
    let (largeur, hauteur) = dimensions_webp(atlas)?;
    if (largeur, hauteur) != (V1.0, V1.1) {
        return Err(Error::Invalid(format!(
            "le TUI Codex exige un atlas de {}x{} pixels (reçu {largeur}x{hauteur})",
            V1.0, V1.1
        )));
    }
    grille.valider_atlas(largeur, hauteur)?;
    Ok(pet)
}

/// Reproduit les contrôles de l'installeur de la galerie (`scripts/install.mjs`) sur un paquet.
///
/// `pet.json` de 64 Kio au plus, `id` égal à `id_attendu`, `spritesheetPath` exactement
/// `spritesheet.webp`, atlas `RIFF…WEBP` de 5 Mo au plus, dimensions v1 ou v2 cohérentes avec
/// `spriteVersionNumber`. Le motif d'identifiant `pet--auteur` des soumissions de la galerie
/// n'est pas exigé : il régit le dépôt de la galerie, pas ce que Codex charge.
///
/// # Errors
/// Au premier contrôle qui échoue.
pub fn valider_galerie(pet_json: &[u8], atlas: &[u8], id_attendu: &str) -> Result<Version, Error> {
    if pet_json.len() > MAX_PET_JSON {
        return Err(Error::Invalid("pet.json dépasse la limite de 64 Kio".into()));
    }
    let v: serde_json::Value = serde_json::from_slice(pet_json)?;
    if v.get("id").and_then(serde_json::Value::as_str) != Some(id_attendu) {
        return Err(Error::Invalid(format!("l'id de pet.json doit valoir « {id_attendu} »")));
    }
    if v.get("spritesheetPath").and_then(serde_json::Value::as_str) != Some("spritesheet.webp") {
        return Err(Error::Invalid("spritesheetPath doit valoir spritesheet.webp".into()));
    }
    if atlas.len() > MAX_ATLAS {
        return Err(Error::Invalid("spritesheet.webp dépasse la limite de 5 Mo".into()));
    }
    let (l, h) = dimensions_webp(atlas)?;
    let declare = v.get("spriteVersionNumber").and_then(serde_json::Value::as_u64).unwrap_or(1);
    match ((l, h), declare) {
        ((1536, 1872), 1) => Ok(Version::V1),
        ((1536, 2288), 2) => Ok(Version::V2),
        _ => Err(Error::Invalid(format!(
            "atlas {l}x{h} incohérent avec spriteVersionNumber = {declare}"
        ))),
    }
}

// ---------------------------------------------------------------------------------------------
// Artefacts
// ---------------------------------------------------------------------------------------------

/// Un paquet prêt à installer : les octets exacts des deux fichiers.
#[derive(Debug, Clone)]
pub struct Artefact {
    /// Version du gabarit.
    pub version: Version,
    /// Identifiant (nom du dossier sous `pets/`).
    pub id: String,
    /// Contenu de `pet.json`.
    pub pet_json: Vec<u8>,
    /// Contenu de `spritesheet.webp`.
    pub atlas: Vec<u8>,
    /// Dimensions de l'atlas.
    pub dimensions: (u32, u32),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PetJson<'a> {
    id: &'a str,
    display_name: &'a str,
    description: &'a str,
    spritesheet_path: &'a str,
    sprite_version_number: u32,
    frame: Grille,
}

impl Artefact {
    /// L'entrée `install-manifest.json` de cet artefact.
    #[must_use]
    pub fn entree(&self, nom: &str) -> EntreeInstallation {
        EntreeInstallation {
            name: nom.to_string(),
            sprite_version_number: match self.version {
                Version::V1 => 1,
                Version::V2 => 2,
            },
            pet_json_sha256: sha256_hex(&self.pet_json),
            pet_json_bytes: self.pet_json.len(),
            spritesheet_sha256: sha256_hex(&self.atlas),
            spritesheet_bytes: self.atlas.len(),
            spritesheet_width: self.dimensions.0,
            spritesheet_height: self.dimensions.1,
        }
    }
}

fn pet_json(pet: &Pet, version: u32, grille: Grille) -> Result<Vec<u8>, Error> {
    let mut json = serde_json::to_vec_pretty(&PetJson {
        id: &pet.pet.id,
        display_name: &pet.pet.display_name,
        description: &pet.pet.description,
        spritesheet_path: "spritesheet.webp",
        sprite_version_number: version,
        frame: grille,
    })?;
    json.push(b'\n');
    Ok(json)
}

/// Artefact **v1** : les neuf premières lignes de l'atlas (1536 × 1872), réencodées en WebP sans
/// perte, et un `pet.json` sans `animations` — Codex y applique ses pistes par défaut, qui
/// correspondent ligne pour ligne à celles du paquet (voir
/// [`pets::pistes_depuis_animations`]). Accepté par le TUI comme par l'app.
///
/// # Errors
/// Si l'atlas source n'a pas la géométrie v2 attendue ou si l'encodage échoue.
pub fn artefact_v1(pet: &Pet) -> Result<Artefact, Error> {
    let atlas = &pet.manifest.atlas;
    if (atlas.width, atlas.columns) != (V1.0, V1.2) || atlas.rows < V1.3 {
        return Err(Error::Invalid("l'atlas source ne contient pas le gabarit 8 x 9".into()));
    }
    let octets = (V1.0 as usize) * (V1.1 as usize) * 4;
    let rgba = pet
        .rgba
        .get(..octets)
        .ok_or_else(|| Error::Invalid("atlas RGBA plus court que le gabarit 8 x 9".into()))?;
    let mut webp = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut webp)
        .encode(rgba, V1.0, V1.1, image::ExtendedColorType::Rgba8)
        .map_err(|e| Error::Invalid(format!("encodage WebP : {e}")))?;
    Ok(Artefact {
        version: Version::V1,
        id: pet.pet.id.clone(),
        pet_json: pet_json(pet, 1, Grille::default())?,
        atlas: webp,
        dimensions: (V1.0, V1.1),
    })
}

/// Artefact **v2** : l'atlas complet (1536 × 2288) tel qu'embarqué, pour l'app Codex.
///
/// # Errors
/// Si le paquet n'est pas conforme à la v2.
pub fn artefact_v2(pet: &Pet, atlas_webp: &[u8]) -> Result<Artefact, Error> {
    let c = conformite(&pet.pet, &pet.manifest);
    if c.version != Some(Version::V2) || !c.ok() {
        return Err(Error::Invalid(format!("paquet non conforme v2 : {}", c.ecarts.join(" ; "))));
    }
    let grille = Grille { rows: V2.3, ..Grille::default() };
    Ok(Artefact {
        version: Version::V2,
        id: pet.pet.id.clone(),
        pet_json: pet_json(pet, 2, grille)?,
        atlas: atlas_webp.to_vec(),
        dimensions: (V2.0, V2.1),
    })
}

// ---------------------------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------------------------

/// `$CODEX_HOME`, ou `~/.codex` à défaut — la règle de Codex et de l'installeur de la galerie.
#[cfg(feature = "fs")]
#[must_use]
pub fn codex_home() -> Option<std::path::PathBuf> {
    if let Some(h) = std::env::var_os("CODEX_HOME").filter(|h| !h.is_empty()) {
        return Some(h.into());
    }
    let home = std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").filter(|h| !h.is_empty()))?;
    Some(std::path::Path::new(&home).join(".codex"))
}

#[cfg(feature = "fs")]
fn refuser_lien(chemin: &std::path::Path) -> Result<(), Error> {
    match std::fs::symlink_metadata(chemin) {
        Ok(m) if m.file_type().is_symlink() => Err(Error::Invalid(format!(
            "{} est un lien symbolique : installation refusée",
            chemin.display()
        ))),
        _ => Ok(()),
    }
}

/// Installe un artefact sous `codex_home/pets/<id>/`, comme l'installeur de la galerie : aucun
/// lien symbolique, paquet existant remplacé seulement s'il ne contient que `pet.json` et
/// `spritesheet.webp`, écriture dans un dossier temporaire puis renommage, et relecture du
/// résultat **depuis le disque** par [`valider_galerie`] et, pour la v1, [`valider_tui`].
///
/// # Errors
/// Si l'artefact ou la cible est refusé, ou sur erreur d'entrée-sortie.
#[cfg(feature = "fs")]
pub fn installer(
    codex_home: &std::path::Path,
    artefact: &Artefact,
) -> Result<std::path::PathBuf, Error> {
    use std::fs;
    valider_galerie(&artefact.pet_json, &artefact.atlas, &artefact.id)?;
    if artefact.version == Version::V1 {
        valider_tui(&artefact.pet_json, &artefact.atlas, &artefact.id)?;
    }
    let id = &artefact.id;
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(Error::Invalid(format!("identifiant de pet invalide : « {id} »")));
    }

    let racine = codex_home.join("pets");
    refuser_lien(codex_home)?;
    refuser_lien(&racine)?;
    fs::create_dir_all(&racine)?;
    let cible = racine.join(id);
    refuser_lien(&cible)?;
    if cible.exists() {
        for entree in fs::read_dir(&cible)? {
            let entree = entree?;
            let nom = entree.file_name();
            let gere = FICHIERS.iter().any(|f| nom == *f);
            if !gere || !entree.file_type()?.is_file() {
                return Err(Error::Invalid(format!(
                    "{} contient un fichier non géré : remplacement refusé",
                    entree.path().display()
                )));
            }
        }
    }

    let etape = racine.join(format!(".{id}.tmp-{}", std::process::id()));
    if etape.exists() {
        fs::remove_dir_all(&etape)?;
    }
    fs::create_dir(&etape)?;
    let ecrire = || -> Result<(), Error> {
        fs::write(etape.join(FICHIERS[0]), &artefact.pet_json)?;
        fs::write(etape.join(FICHIERS[1]), &artefact.atlas)?;
        let sauvegarde = racine.join(format!(".{id}.backup-{}", std::process::id()));
        if sauvegarde.exists() {
            fs::remove_dir_all(&sauvegarde)?;
        }
        if cible.exists() {
            fs::rename(&cible, &sauvegarde)?;
        }
        if let Err(e) = fs::rename(&etape, &cible) {
            if sauvegarde.exists() {
                fs::rename(&sauvegarde, &cible)?;
            }
            return Err(e.into());
        }
        if sauvegarde.exists() {
            fs::remove_dir_all(&sauvegarde)?;
        }
        Ok(())
    };
    if let Err(e) = ecrire() {
        let _ = fs::remove_dir_all(&etape);
        return Err(e);
    }

    let json = fs::read(cible.join(FICHIERS[0]))?;
    let atlas = fs::read(cible.join(FICHIERS[1]))?;
    valider_galerie(&json, &atlas, id)?;
    if artefact.version == Version::V1 {
        valider_tui(&json, &atlas, id)?;
    }
    Ok(cible)
}

/// Le pet tel que Codex le jouerait, à partir du paquet : sa piste `idle` et ses états
/// viennent des pistes par défaut de Codex, identiques à celles qu'on compose depuis le paquet.
///
/// # Errors
/// Si le manifeste d'animations est incomplet.
pub fn pet_codex(pet: &Pet) -> Result<PetCodex, Error> {
    let atlas = &pet.manifest.atlas;
    Ok(PetCodex {
        id: pet.pet.id.clone(),
        nom: pet.pet.display_name.clone(),
        description: pet.pet.description.clone(),
        atlas: pet.pet.spritesheet_path.clone(),
        grille: Grille {
            width: atlas.cell_width,
            height: atlas.cell_height,
            columns: atlas.columns,
            rows: atlas.rows,
        },
        pistes: pets::pistes_depuis_animations(&pet.manifest)?,
    })
}
