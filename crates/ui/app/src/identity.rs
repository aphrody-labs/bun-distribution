// SPDX-License-Identifier: Apache-2.0
//! Aphrody pet and pixel-perfect pipeline, exposed to the desktop webview.
//!
//! Moved from the retired Inacord desktop host (nie `apps/inacord/src-tauri/src/aphrody.rs`)
//! when Inacord merged into this app: the pet is the Aphrody identity
//! ([`aphrody_identity`], Apache-2.0), not a game asset, so it belongs to the super app.
//!
//! This module is only a facade. Measurement, comparison, vectorisation and sheet assembly
//! live in [`aphrody_identity::pixel`]; the CSS/SVG/JSON of a sprite sheet is written by
//! [`aphrody_sprite_sheet`]. The DTOs are local on purpose: the engine crates carry no IPC
//! derive. Their field names are the wire contract inherited from Inacord and stay unchanged.
//! Every command is `async` because it reads the disk, and a synchronous Tauri command runs on
//! the main thread, where a slow read would freeze the window.

use base64::Engine as _;
use serde::Serialize;

use aphrody_identity::pixel::{
    Boite, Image, Masque, Reglages, ReglagesVecteur, comparer, mesurer, planche, tokens_css,
    vectoriser,
};
use aphrody_identity::{Pet, assets};

/// Returns the domain error verbatim: the UI shows the real message, not a generic failure.
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn charger(chemin: &str) -> Result<Image, String> {
    Image::charger(std::path::Path::new(chemin)).map_err(err)
}

/// Maps the front-end mask settings to the domain mask.
///
/// `mode` is `alpha`, `sombre` or `teinte`. An unknown mode is an **error**, not a silent
/// fallback to `alpha`: a mask other than the requested one yields plausible but wrong
/// measurements.
fn masque_depuis(
    mode: &str,
    seuil: Option<u32>,
    teinte_min: Option<f64>,
    teinte_max: Option<f64>,
    saturation: Option<f64>,
) -> Result<Masque, String> {
    let seuil_u8 = || u8::try_from(seuil.unwrap_or(8).min(255)).unwrap_or(255);
    match mode {
        "alpha" => Ok(Masque::Alpha(seuil_u8())),
        "sombre" => Ok(Masque::Sombre(seuil_u8())),
        "teinte" => Ok(Masque::Teinte {
            min: teinte_min.unwrap_or(0.0),
            max: teinte_max.unwrap_or(360.0),
            sat: saturation.unwrap_or(0.25),
        }),
        autre => Err(format!("unknown mask \"{autre}\" (alpha, sombre or teinte)")),
    }
}

/// One colour of the measured palette (IPC mirror of `aphrody_identity::pixel::Couleur`).
#[derive(Debug, Serialize)]
pub struct CouleurDto {
    /// Share of the retained pixels, in percent.
    pub part_pct: f64,
    /// `#RRGGBB` form.
    pub hex: String,
    /// `oklch(L C h)`, ready to paste into a stylesheet.
    pub oklch: String,
    /// HSL hue in degrees, used to sort a palette for display.
    pub teinte_deg: f64,
}

/// What a measurement returns to the front end (IPC mirror of `aphrody_identity::pixel::Mesure`).
///
/// Silhouette profiles and per-row edges are **not exposed**: they are thousands of values per
/// measurement that the UI cannot display and that the IPC would pay for on every call.
#[derive(Debug, Serialize)]
pub struct MesureDto {
    /// Source image width.
    pub source_largeur: u32,
    /// Source image height.
    pub source_hauteur: u32,
    /// Subject bounding box `[x0, y0, x1, y1]`, inclusive.
    pub boite: [u32; 4],
    /// Box width.
    pub largeur: u32,
    /// Box height.
    pub hauteur: u32,
    /// Width / height.
    pub ratio: f64,
    /// Filled share of the box, in percent (78.54 % is a full disc).
    pub remplissage_pct: f64,
    /// Filled share of the whole image.
    pub part_image_pct: f64,
    /// Median stroke thickness, in percent of the width.
    pub trait_pct: f64,
    /// Angle of the left edge against the vertical, in degrees.
    pub angle_gauche_deg: f64,
    /// Angle of the right edge.
    pub angle_droit_deg: f64,
    /// The worse of the two edge-fit R² values.
    pub bord_droiture: f64,
    /// False when `bord_droiture` is below 0.95: the angles above then **mean nothing** and the
    /// UI must not offer them as `skewX`. The threshold is computed here so no front end has to
    /// reinvent it, or forget it.
    pub angles_exploitables: bool,
    /// Palette, sorted by decreasing share.
    pub palette: Vec<CouleurDto>,
}

/// The verdict of a comparison (IPC mirror of `aphrody_identity::pixel::Comparaison`).
#[derive(Debug, Serialize)]
pub struct ComparaisonDto {
    /// Hybrid RGB structural similarity, 0 to 1.
    pub ssim: f64,
    /// Share of pixels whose every channel is within the tolerance.
    pub pixels_dans_tolerance_pct: f64,
    /// Applied per-channel tolerance.
    pub tolerance: u32,
    /// True when both images are strictly equal.
    pub identique: bool,
}

/// An assembled sheet and the three forms the web expects.
#[derive(Debug, Serialize)]
pub struct PlancheDto {
    /// Sheet width.
    pub largeur: u32,
    /// Sheet height.
    pub hauteur: u32,
    /// Number of sprites.
    pub sprites: u32,
    /// Sheet PNG in base64, displayable directly as `data:`.
    pub png_b64: String,
    /// CSS sheet, as written by `aphrody_sprite_sheet`.
    pub css: String,
    /// Standalone `<symbol>` SVG with the image embedded as `data:`.
    pub svg: String,
    /// Regions JSON.
    pub json: String,
}

/// State of the bundled pet.
#[derive(Debug, Serialize)]
pub struct PetEtatDto {
    /// Display name of the pet.
    pub nom: String,
    /// Atlas dimensions.
    pub atlas: [u32; 2],
    /// Atlas grid: columns, rows.
    pub grille: [u32; 2],
    /// Names of the available animations.
    pub animations: Vec<String>,
    /// Number of frames checked by the diagnostic.
    pub frames_verifiees: u32,
    /// True when the diagnostic reports no error.
    pub ok: bool,
    /// Reported errors, empty when `ok`.
    pub erreurs: Vec<String>,
}

fn mesure_dto(m: &aphrody_identity::pixel::Mesure) -> MesureDto {
    MesureDto {
        source_largeur: m.source[0],
        source_hauteur: m.source[1],
        boite: [m.boite.x0, m.boite.y0, m.boite.x1, m.boite.y1],
        largeur: m.boite.largeur(),
        hauteur: m.boite.hauteur(),
        ratio: m.ratio,
        remplissage_pct: m.remplissage_pct,
        part_image_pct: m.part_image_pct,
        trait_pct: m.trait_pct,
        angle_gauche_deg: m.angle_gauche_deg,
        angle_droit_deg: m.angle_droit_deg,
        bord_droiture: m.bord_droiture,
        angles_exploitables: m.bord_droiture >= 0.95,
        palette: m
            .palette
            .iter()
            .map(|c| CouleurDto {
                part_pct: c.part_pct,
                hex: c.hex.clone(),
                oklch: format!("oklch({:.4} {:.4} {:.2})", c.oklch[0], c.oklch[1], c.oklch[2]),
                teinte_deg: c.hsl[0],
            })
            .collect(),
    }
}

/// Builds measurement settings from the IPC parameters.
fn reglages_depuis(
    k: Option<u32>,
    boite: Option<Vec<u32>>,
    masque: Masque,
) -> Result<Reglages, String> {
    let boite = match boite {
        Some(b) if b.len() == 4 => Some(Boite { x0: b[0], y0: b[1], x1: b[2], y1: b[3] }),
        Some(_) => return Err("the box takes exactly 4 values: x0 y0 x1 y1".into()),
        None => None,
    };
    let mut r = Reglages { masque, boite, ..Reglages::default() };
    if let Some(k) = k {
        r.k = k.max(1) as usize;
    }
    Ok(r)
}

/// Measurement options; the IPC command keeps its flattened arguments.
pub struct ImageMeasureOptions<'a> {
    pub palette_size: Option<u32>,
    pub bounds: Option<Vec<u32>>,
    pub mode: &'a str,
    pub threshold: Option<u32>,
    pub hue_min: Option<f64>,
    pub hue_max: Option<f64>,
    pub saturation: Option<f64>,
}

/// Measures an image from disk.
pub fn mesurer_fichier(
    chemin: &str,
    options: ImageMeasureOptions<'_>,
) -> Result<MesureDto, String> {
    let masque = masque_depuis(
        options.mode,
        options.threshold,
        options.hue_min,
        options.hue_max,
        options.saturation,
    )?;
    let reglages = reglages_depuis(options.palette_size, options.bounds, masque)?;
    let m = mesurer(&charger(chemin)?, reglages).map_err(err)?;
    Ok(mesure_dto(&m))
}

/// Palette of an image as CSS custom properties.
pub fn tokens_css_fichier(chemin: &str, prefixe: &str, k: Option<u32>) -> Result<String, String> {
    let reglages = reglages_depuis(k, None, Masque::Alpha(8))?;
    let m = mesurer(&charger(chemin)?, reglages).map_err(err)?;
    Ok(tokens_css(&m, prefixe))
}

/// Compares two images from disk.
pub fn comparer_fichiers(
    a: &str,
    b: &str,
    tolerance: Option<u32>,
) -> Result<ComparaisonDto, String> {
    let tol = u8::try_from(tolerance.unwrap_or(0).min(255)).unwrap_or(255);
    let c = comparer(&charger(a)?, &charger(b)?, tol).map_err(err)?;
    Ok(ComparaisonDto {
        ssim: c.ssim,
        pixels_dans_tolerance_pct: c.pixels_dans_tolerance_pct,
        tolerance: u32::from(c.tolerance),
        identique: c.identique,
    })
}

/// Vectorises an image from disk to SVG.
pub fn vectoriser_fichier(
    chemin: &str,
    k: Option<u32>,
    tolerance: Option<f64>,
    mode: &str,
    seuil: Option<u32>,
) -> Result<String, String> {
    let mut r = ReglagesVecteur {
        masque: masque_depuis(mode, seuil, None, None, None)?,
        ..ReglagesVecteur::default()
    };
    if let Some(k) = k {
        r.k = k.max(1) as usize;
    }
    if let Some(t) = tolerance {
        r.tolerance = t;
    }
    vectoriser(&charger(chemin)?, r).map_err(err)
}

/// Assembles images into a sheet and returns PNG + CSS + SVG + JSON.
///
/// Each sprite is named after its **file**, never its rank: a rank shifts on the first
/// insertion and every CSS selector already written would then point elsewhere.
pub fn planche_fichiers(
    chemins: &[String],
    colonnes: Option<u32>,
    nom: &str,
) -> Result<PlancheDto, String> {
    let mut images = Vec::with_capacity(chemins.len());
    for chemin in chemins {
        let p = std::path::Path::new(chemin);
        let nom_sprite =
            p.file_stem().map_or_else(|| chemin.clone(), |s| s.to_string_lossy().into_owned());
        images.push((nom_sprite, charger(chemin)?));
    }
    let (img, feuille) = planche(&images, colonnes.map(|c| c.max(1) as usize), nom).map_err(err)?;
    let png = assets::encoder_png(&img.rgba, img.largeur, img.hauteur).map_err(err)?;
    let png_b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(PlancheDto {
        largeur: img.largeur,
        hauteur: img.hauteur,
        sprites: u32::try_from(feuille.sprites.len()).unwrap_or(u32::MAX),
        css: feuille.vers_css(&format!("{nom}.png")),
        svg: feuille.vers_svg(&aphrody_sprite_sheet::data_uri(&png, "image/png")),
        json: feuille.vers_json(),
        png_b64,
    })
}

/// State of the bundled pet, diagnostic included.
pub fn pet_etat() -> Result<PetEtatDto, String> {
    let pet = Pet::bundled().map_err(err)?;
    let rapport = pet.diagnose();
    let atlas = &pet.manifest.atlas;
    Ok(PetEtatDto {
        nom: pet.manifest.pet.display_name.clone(),
        atlas: [atlas.width, atlas.height],
        grille: [atlas.columns, atlas.rows],
        animations: pet.manifest.animations.keys().cloned().collect(),
        frames_verifiees: u32::try_from(rapport.checked_frames).unwrap_or(u32::MAX),
        ok: rapport.ok(),
        erreurs: rapport.errors.clone(),
    })
}

/// One pet frame, extracted without resampling, as base64 PNG.
///
/// `index` is the index **within the animation**, not within the atlas.
pub fn pet_frame_png_b64(animation: &str, index: u32) -> Result<String, String> {
    let pet = Pet::bundled().map_err(err)?;
    let anim = pet
        .animation(animation)
        .ok_or_else(|| format!("animation \"{animation}\" is not part of the pet"))?;
    let frame = anim.frames.get(index as usize).ok_or_else(|| {
        format!("frame {index} is missing: the animation has {}", anim.frames.len())
    })?;
    let rgba = pet.extract(frame).map_err(err)?;
    let (w, h) = (frame.atlas_rect.width, frame.atlas_rect.height);
    let png = assets::encoder_png(&rgba, w, h).map_err(err)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(png))
}

// ─── Tauri commands (moved from the Inacord invoke handler) ────────────────────────────────

/// Bundled pet state: atlas, grid, animations, integrity diagnostic.
#[tauri::command]
pub async fn aphrody_pet_etat() -> Result<PetEtatDto, String> {
    pet_etat()
}

/// One animation frame of the pet, extracted without resampling, as base64 PNG.
#[tauri::command]
pub async fn aphrody_pet_frame_png_b64(animation: String, index: u32) -> Result<String, String> {
    pet_frame_png_b64(&animation, index)
}

/// Measures an image from disk: box, ratio, fill, palette, stroke thickness, edge slope.
/// `angles_exploitables` says whether the returned angles mean anything.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn aphrody_pixel_mesurer(
    chemin: String,
    k: Option<u32>,
    boite: Option<Vec<u32>>,
    mode: String,
    seuil: Option<u32>,
    teinte_min: Option<f64>,
    teinte_max: Option<f64>,
    saturation: Option<f64>,
) -> Result<MesureDto, String> {
    mesurer_fichier(
        &chemin,
        ImageMeasureOptions {
            palette_size: k,
            bounds: boite,
            mode: &mode,
            threshold: seuil,
            hue_min: teinte_min,
            hue_max: teinte_max,
            saturation,
        },
    )
}

/// Palette of an image as `oklch()` CSS custom properties, measured HEX in comments.
#[tauri::command]
pub async fn aphrody_pixel_tokens_css(
    chemin: String,
    prefixe: String,
    k: Option<u32>,
) -> Result<String, String> {
    tokens_css_fichier(&chemin, &prefixe, k)
}

/// Compares two images: SSIM and share of pixels within tolerance. These are different
/// criteria: the first judges a reproduction, the second a render that must be identical.
#[tauri::command]
pub async fn aphrody_pixel_comparer(
    a: String,
    b: String,
    tolerance: Option<u32>,
) -> Result<ComparaisonDto, String> {
    comparer_fichiers(&a, &b, tolerance)
}

/// Vectorises an image to SVG. This is a trace: fine for a flat logo, never a claim to
/// produce a drawing designed as vector art.
#[tauri::command]
pub async fn aphrody_pixel_vectoriser(
    chemin: String,
    k: Option<u32>,
    tolerance: Option<f64>,
    mode: String,
    seuil: Option<u32>,
) -> Result<String, String> {
    vectoriser_fichier(&chemin, k, tolerance, &mode, seuil)
}

/// Assembles images into a sprite sheet and returns PNG + CSS + SVG + JSON.
#[tauri::command]
pub async fn aphrody_pixel_planche(
    chemins: Vec<String>,
    colonnes: Option<u32>,
    nom: String,
) -> Result<PlancheDto, String> {
    planche_fichiers(&chemins, colonnes, &nom)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

    #[test]
    fn bundled_pet_passes_its_diagnostic() {
        let etat = pet_etat().expect("bundled pet loads");
        assert!(etat.ok, "diagnostic errors: {:?}", etat.erreurs);
        assert!(!etat.animations.is_empty());
        assert!(etat.frames_verifiees > 0);
    }

    #[test]
    fn first_frame_of_every_animation_encodes_to_png() {
        let etat = pet_etat().expect("bundled pet loads");
        for animation in &etat.animations {
            let b64 = pet_frame_png_b64(animation, 0).expect("frame 0 extracts");
            let png = base64::engine::general_purpose::STANDARD.decode(b64).expect("valid base64");
            assert_eq!(&png[..8], PNG_SIGNATURE);
        }
    }

    #[test]
    fn unknown_mask_mode_is_an_error() {
        assert!(masque_depuis("inconnu", None, None, None, None).is_err());
        assert!(masque_depuis("alpha", Some(300), None, None, None).is_ok());
    }

    #[test]
    fn missing_animation_is_reported() {
        assert!(pet_frame_png_b64("__absente__", 0).is_err());
    }

    #[test]
    fn box_needs_four_values() {
        assert!(reglages_depuis(None, Some(vec![1, 2, 3]), Masque::Alpha(8)).is_err());
        assert!(reglages_depuis(Some(0), Some(vec![0, 0, 4, 4]), Masque::Alpha(8)).is_ok());
    }
}
