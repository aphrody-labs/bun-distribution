// SPDX-License-Identifier: Apache-2.0
//! Le logo d'Aphrody et toutes ses déclinaisons : `.ico`, PNG transparents, icônes maskable,
//! apple-touch-icon, SVG vectoriel, logo avec wordmark, manifeste web, feuilles CSS et jetons M3.
//!
//! # Source
//!
//! `assets/logo/source/byron_r0.png` (750 × 422) et `byron_r0_fullbody.png` (750 × 750) sont les
//! rendus détourés de face (vue `r0`) du personnage c01001900 « Byron Love » de l'encyclopédie
//! officielle zukan.inazuma.jp (© LEVEL5). [`LOGO_WEBP`] embarque le portrait en WebP sans perte ;
//! le test `le_webp_rend_les_pixels_de_la_source` garantit qu'il rend les mêmes pixels que le PNG.
//!
//! # Cadrage
//!
//! Rien n'est étiré. [`cadrer`] prend la boîte englobante de l'alpha, repère le visage par la
//! teinte de peau, puis taille deux carrés centrés sur le visage, posés sous le haut des cheveux :
//! le cadre large (tête, cheveux, épaules) pour 48 px et plus, le cadre serré (tête seule) pour
//! 16 à 32 px, où les épaules ne seraient que du bruit. Ce qui sort de la source est complété en
//! transparent. Le buste, coupé par la source, s'efface en fondu vers le bas : pas de bord dur,
//! coins transparents.
//!
//! # Couleurs
//!
//! La palette du logo est mesurée par [`crate::pixel::mesurer`] (k-means Oklab) puis classée par le
//! `score` de Material Color Utilities ([`aphrody_m3_tokens::score`]) : la première couleur est la
//! graine M3, dont [`ThemeRequest`] tire les schémas clair et sombre. Les fonds opaques (maskable,
//! apple-touch-icon) et les couleurs du manifeste sont des rôles de ces schémas, jamais `#000` ni
//! `#fff`.
//!
//! # SVG
//!
//! [`svg_vectoriel`] décalque le cadre large avec [`crate::pixel::vectoriser`] (une couche de
//! `path` par couleur) et mesure sa fidélité : SSIM entre le SVG rastérisé et l'icône PNG de même
//! taille, toutes deux posées sur la surface claire du thème. Les chiffres retenus et les
//! réglages écartés sont dans `docs/pipeline-svg.md`.

use aphrody_m3_tokens::{
    color_math::argb_from_hex,
    scheme::Variant,
    score::{ScoreOptions, score},
    theme::{ThemeExport, ThemeRequest},
};
use image::{ImageFormat, Rgba, Rgba32FImage, RgbaImage, imageops::FilterType};

use crate::{
    assets::{Fichier, assembler_ico, encoder_png},
    pixel::{self, Boite, Couleur, Image, Masque, Reglages, ReglagesVecteur},
    sha256_hex,
};

/// Le portrait canonique, en WebP sans perte (copie exacte de `assets/logo/source/byron_r0.png`).
///
/// Il reste dans la crate pour que `cargo package` embarque la source de vérité.
pub static LOGO_WEBP: &[u8] = include_bytes!("../assets/logo/aphrody.webp");

/// Nom du produit, tel qu'il apparaît dans le manifeste et le wordmark.
pub const NOM: &str = "Aphrody";

/// Description factuelle du manifeste web.
pub const DESCRIPTION: &str = "Aphrody, an operating system shipped as a distribution.";

/// Tailles des PNG transparents.
pub const TAILLES_PNG: [u32; 10] = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];

/// Tailles du `favicon.ico`. Windows puise jusqu'à 256 px pour l'Explorateur en haute densité.
pub const TAILLES_ICO: [u32; 7] = [16, 24, 32, 48, 64, 128, 256];

/// Tailles des icônes maskable du manifeste.
pub const TAILLES_MASKABLE: [u32; 2] = [192, 512];

/// Taille de l'`apple-touch-icon`.
pub const TAILLE_APPLE: u32 = 180;

/// Jusqu'à cette taille incluse, les icônes prennent le cadre serré (tête seule).
pub const TAILLE_MAX_SERRE: u32 = 32;

/// Zone sûre d'une icône maskable : le sujet tient dans le disque central de 80 % du côté.
pub const ZONE_SURE: f64 = 0.80;

/// Résolution de décalque de `icon.svg` et taille de sa mesure de fidélité.
pub const SVG_RESOLUTION: u32 = 256;

/// Nombre de couches de couleur de `icon.svg`.
pub const SVG_COUCHES: usize = 24;

/// Seuil de fidélité (SSIM) sous lequel `icon.svg` est refusé.
pub const SVG_SSIM_MIN: f64 = 0.90;

/// Plafond de taille de `icon.svg`, en octets.
pub const SVG_OCTETS_MAX: usize = 150 * 1024;

/// Hauteur de la tête, du haut des cheveux au menton, rapportée au côté du cadre large.
const LARGE_SUR_TETE: f64 = 1.5;
/// Même rapport pour le cadre serré.
const SERRE_SUR_TETE: f64 = 1.2;
/// Marge au-dessus des cheveux, en part du côté.
const MARGE_HAUTE: f64 = 0.04;
/// Hauteur du fondu de bas de buste, en part du côté, cadre large.
const FONDU_LARGE: f64 = 0.14;
/// Même chose pour le cadre serré, qui coupe juste sous le menton.
const FONDU_SERRE: f64 = 0.06;
/// Seuil alpha de la boîte englobante du sujet.
const SEUIL_ALPHA: u8 = 8;
/// Part du côté de l'apple-touch-icon occupée par le buste, posé sur le bord bas.
const APPLE_CONTENU: f64 = 0.92;

/// Erreurs des dérivations du logo.
#[derive(Debug, thiserror::Error)]
pub enum LogoError {
    /// Décodage ou encodage d'image.
    #[error("image : {0}")]
    Image(#[from] image::ImageError),
    /// Lecture ou écriture disque.
    #[error("e/s : {0}")]
    Io(#[from] std::io::Error),
    /// Erreur remontée par un autre module de la crate (mesure, vectorisation, PNG).
    #[error("{0}")]
    Identite(#[from] crate::Error),
    /// Entrée inutilisable.
    #[error("{0}")]
    Invalide(String),
}

impl From<aphrody_svg::Error> for LogoError {
    fn from(e: aphrody_svg::Error) -> Self {
        Self::Invalide(format!("svg : {e}"))
    }
}

/// Décode le portrait embarqué.
///
/// # Errors
/// Si [`LOGO_WEBP`] est corrompu.
pub fn portrait() -> Result<RgbaImage, LogoError> {
    Ok(image::load_from_memory_with_format(LOGO_WEBP, ImageFormat::WebP)?.to_rgba8())
}

/// Encode une image en WebP sans perte, alpha compris : c'est ainsi qu'est produit
/// `assets/logo/aphrody.webp` depuis la source PNG.
///
/// # Errors
/// Si l'encodeur échoue.
pub fn webp_sans_perte(img: &RgbaImage) -> Result<Vec<u8>, LogoError> {
    let mut out = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut out).encode(
        img.as_raw(),
        img.width(),
        img.height(),
        image::ExtendedColorType::Rgba8,
    )?;
    Ok(out)
}

/// Un carré découpé dans la source, en pixels. Peut déborder : le hors-champ est transparent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cadre {
    /// Abscisse du coin haut gauche (peut être négative).
    pub x: i64,
    /// Ordonnée du coin haut gauche (peut être négative).
    pub y: i64,
    /// Côté du carré.
    pub cote: u32,
}

/// Ce que [`cadrer`] a trouvé dans la source.
#[derive(Debug, Clone, Copy)]
pub struct Cadrage {
    /// Boîte englobante de l'alpha.
    pub sujet: Boite,
    /// Boîte du visage (peau), percentiles 1-99 pour écarter les pixels isolés.
    pub visage: Boite,
    /// Cadre large : tête, cheveux, épaules.
    pub large: Cadre,
    /// Cadre serré : la tête seule.
    pub serre: Cadre,
}

/// Teinte de peau du personnage : teinte 15-45°, saturation ≥ 0,45, luminosité ≥ 0,70.
fn est_peau(p: Rgba<u8>) -> bool {
    let [r, g, b] = [p[0], p[1], p[2]].map(|c| f64::from(c) / 255.0);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let d = max - min;
    if d < 1e-9 {
        return false;
    }
    let l = f64::midpoint(max, min);
    let s = d / (1.0 - 2.0f64.mul_add(l, -1.0).abs());
    let h = if (max - r).abs() < 1e-12 {
        60.0 * ((g - b) / d).rem_euclid(6.0)
    } else if (max - g).abs() < 1e-12 {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    (15.0..=45.0).contains(&h) && s >= 0.45 && l >= 0.70
}

/// Trouve le sujet et le visage, et en déduit les deux carrés du logo.
///
/// # Errors
/// Si l'image n'a aucun pixel visible, ou trop peu de peau pour situer un visage.
pub fn cadrer(img: &RgbaImage) -> Result<Cadrage, LogoError> {
    let mut sujet: Option<Boite> = None;
    let (mut xs, mut ys) = (Vec::new(), Vec::new());
    for (x, y, p) in img.enumerate_pixels() {
        if p[3] > SEUIL_ALPHA {
            sujet = Some(match sujet {
                None => Boite { x0: x, y0: y, x1: x, y1: y },
                Some(b) => Boite { x0: b.x0.min(x), y0: b.y0.min(y), x1: b.x1.max(x), y1: b.y1.max(y) },
            });
        }
        if p[3] >= 200 && est_peau(*p) {
            xs.push(x);
            ys.push(y);
        }
    }
    let sujet = sujet.ok_or_else(|| LogoError::Invalide("aucun pixel visible".into()))?;
    if xs.len() < 64 {
        return Err(LogoError::Invalide(format!(
            "{} pixels de peau : pas de visage à cadrer",
            xs.len()
        )));
    }
    xs.sort_unstable();
    ys.sort_unstable();
    let rang = |v: &[u32], q: f64| {
        #[expect(clippy::cast_precision_loss, reason = "nombre de pixels, bien sous 2^53")]
        let i = ((v.len() - 1) as f64 * q).round();
        v[i as usize]
    };
    let visage = Boite { x0: rang(&xs, 0.01), y0: rang(&ys, 0.01), x1: rang(&xs, 0.99), y1: rang(&ys, 0.99) };

    let centre = f64::from(visage.x0 + visage.x1 + 1) / 2.0;
    let haut = f64::from(sujet.y0);
    let tete = f64::from(visage.y1 + 1) - haut;
    let cadre = |rapport: f64| {
        let cote = (tete * rapport).round().max(1.0);
        Cadre {
            x: (centre - cote / 2.0).round() as i64,
            y: cote.mul_add(-MARGE_HAUTE, haut).round() as i64,
            cote: cote as u32,
        }
    };
    Ok(Cadrage { sujet, visage, large: cadre(LARGE_SUR_TETE), serre: cadre(SERRE_SUR_TETE) })
}

/// Découpe `cadre` en RGBA flottant prémultiplié, hors-champ transparent.
fn extraire(img: &RgbaImage, cadre: Cadre) -> Rgba32FImage {
    let (w, h) = (i64::from(img.width()), i64::from(img.height()));
    let mut out = Rgba32FImage::new(cadre.cote, cadre.cote);
    for (x, y, px) in out.enumerate_pixels_mut() {
        let (sx, sy) = (cadre.x + i64::from(x), cadre.y + i64::from(y));
        if sx < 0 || sy < 0 || sx >= w || sy >= h {
            continue;
        }
        let p = img.get_pixel(sx as u32, sy as u32);
        let a = f32::from(p[3]) / 255.0;
        *px = Rgba([
            f32::from(p[0]) / 255.0 * a,
            f32::from(p[1]) / 255.0 * a,
            f32::from(p[2]) / 255.0 * a,
            a,
        ]);
    }
    out
}

/// Repasse du flottant prémultiplié au RGBA8 droit. Un pixel quasi transparent devient (0,0,0,0).
fn vers_rgba8(img: &Rgba32FImage) -> RgbaImage {
    RgbaImage::from_fn(img.width(), img.height(), |x, y| {
        let p = img.get_pixel(x, y);
        let a = p[3].clamp(0.0, 1.0);
        if a < 1.0 / 510.0 {
            return Rgba([0, 0, 0, 0]);
        }
        let c = |v: f32| ((v / a).clamp(0.0, 1.0) * 255.0).round() as u8;
        Rgba([c(p[0]), c(p[1]), c(p[2]), (a * 255.0).round() as u8])
    })
}

/// Rend `cadre` en `taille` × `taille` sans déformation : Lanczos 3 en alpha prémultiplié, qui
/// n'auréole pas le détourage.
#[must_use]
pub fn rendre(img: &RgbaImage, cadre: Cadre, taille: u32) -> RgbaImage {
    let src = extraire(img, cadre);
    if cadre.cote == taille {
        return vers_rgba8(&src);
    }
    vers_rgba8(&image::imageops::resize(&src, taille, taille, FilterType::Lanczos3))
}

/// Efface linéairement le bas de l'image sur `part` de sa hauteur (alpha seulement) ; la
/// dernière ligne est entièrement transparente.
fn fondu(img: &mut RgbaImage, part: f64) {
    let h = f64::from(img.height());
    let bande = (h * part).max(1.0);
    for (_, y, p) in img.enumerate_pixels_mut() {
        let f = ((h - 1.0 - f64::from(y)) / bande).clamp(0.0, 1.0);
        p[3] = (f64::from(p[3]) * f).round() as u8;
    }
}

/// Icône transparente de `taille` px : cadre serré jusqu'à [`TAILLE_MAX_SERRE`], large au-delà,
/// bas du buste en fondu.
#[must_use]
pub fn icone(img: &RgbaImage, cadrage: &Cadrage, taille: u32) -> RgbaImage {
    let (cadre, part) = if taille <= TAILLE_MAX_SERRE {
        (cadrage.serre, FONDU_SERRE)
    } else {
        (cadrage.large, FONDU_LARGE)
    };
    let mut out = rendre(img, cadre, taille);
    fondu(&mut out, part);
    out
}

/// Couleur `#rrggbb` en RGB.
fn rgb(hex: &str) -> Result<[u8; 3], LogoError> {
    let argb = argb_from_hex(hex).ok_or_else(|| LogoError::Invalide(format!("couleur {hex}")))?;
    Ok([(argb >> 16) as u8, (argb >> 8) as u8, argb as u8])
}

/// Pose `sujet` sur un carré opaque `fond` de `taille` px, à la position donnée. Le mélange est
/// fait ici : `imageops::overlay` laisse des pixels d'alpha < 255 sur un fond opaque.
fn poser(sujet: &RgbaImage, taille: u32, fond: [u8; 3], x: i64, y: i64) -> RgbaImage {
    RgbaImage::from_fn(taille, taille, |tx, ty| {
        let (sx, sy) = (i64::from(tx) - x, i64::from(ty) - y);
        let dedans = sx >= 0 && sy >= 0 && sx < i64::from(sujet.width()) && sy < i64::from(sujet.height());
        let p = if dedans { *sujet.get_pixel(sx as u32, sy as u32) } else { Rgba([0, 0, 0, 0]) };
        let a = f64::from(p[3]) / 255.0;
        let c = |k: usize| f64::from(fond[k]).mul_add(1.0 - a, f64::from(p[k]) * a).round() as u8;
        Rgba([c(0), c(1), c(2), 255])
    })
}

/// Efface ce qui sort du disque inscrit dans `img`, avec un liseré adouci vers l'intérieur.
fn disque(img: &mut RgbaImage) {
    let r = f64::from(img.width().min(img.height())) / 2.0;
    let (cx, cy) = (f64::from(img.width()) / 2.0, f64::from(img.height()) / 2.0);
    let lisere = (r * 0.06).max(1.0);
    for (x, y, p) in img.enumerate_pixels_mut() {
        let d = (f64::from(x) + 0.5 - cx).hypot(f64::from(y) + 0.5 - cy);
        p[3] = (f64::from(p[3]) * ((r - d) / lisere).clamp(0.0, 1.0)).round() as u8;
    }
}

/// Icône maskable (M3) : le sujet dans le disque central de 80 % (la zone sûre, que tout masque
/// de lanceur laisse visible), sur un fond opaque.
#[must_use]
pub fn maskable(img: &RgbaImage, cadrage: &Cadrage, taille: u32, fond: [u8; 3]) -> RgbaImage {
    let interieur = ((f64::from(taille) * ZONE_SURE).round() as u32).max(1);
    let mut sujet = rendre(img, cadrage.large, interieur);
    fondu(&mut sujet, FONDU_LARGE);
    disque(&mut sujet);
    let marge = i64::from((taille - interieur) / 2);
    poser(&sujet, taille, fond, marge, marge)
}

/// `apple-touch-icon` : opaque (iOS remplit la transparence de noir), buste posé sur le bord bas.
#[must_use]
pub fn apple_touch(img: &RgbaImage, cadrage: &Cadrage, fond: [u8; 3]) -> RgbaImage {
    let interieur = (f64::from(TAILLE_APPLE) * APPLE_CONTENU).round() as u32;
    let sujet = rendre(img, cadrage.large, interieur);
    let x = i64::from((TAILLE_APPLE - interieur) / 2);
    poser(&sujet, TAILLE_APPLE, fond, x, i64::from(TAILLE_APPLE - interieur))
}

/// Aplatit une image sur un fond opaque, pour comparer ce que l'œil voit.
fn aplatir(img: &RgbaImage, fond: [u8; 3]) -> Result<Image, LogoError> {
    let mut rgba = Vec::with_capacity(img.as_raw().len());
    for p in img.pixels() {
        let a = f64::from(p[3]) / 255.0;
        for c in 0..3 {
            rgba.push(f64::from(fond[c]).mul_add(1.0 - a, f64::from(p[c]) * a).round() as u8);
        }
        rgba.push(255);
    }
    Ok(Image::nouvelle(img.width(), img.height(), rgba)?)
}

/// Le thème M3 tiré du logo.
#[derive(Debug, Clone)]
pub struct Theme {
    /// Palette mesurée sur l'icône de référence (k-means Oklab), part décroissante.
    pub palette: Vec<Couleur>,
    /// Graine M3, ARGB opaque : la première couleur du `score` MCU.
    pub graine: u32,
    /// La requête validée (graine, variante Tonal Spot, contraste standard).
    pub requete: ThemeRequest,
    /// Les 49 rôles clair et sombre.
    pub export: ThemeExport,
}

impl Theme {
    /// Un rôle du schéma clair ou sombre, en `#rrggbb`.
    ///
    /// # Errors
    /// Si le rôle n'existe pas.
    pub fn role(&self, sombre: bool, nom: &str) -> Result<&str, LogoError> {
        let roles = if sombre { &self.export.dark } else { &self.export.light };
        roles
            .get(nom)
            .map(String::as_str)
            .ok_or_else(|| LogoError::Invalide(format!("rôle M3 inconnu : {nom}")))
    }
}

/// Mesure la palette de `reference` et en tire le thème M3.
///
/// # Errors
/// Si la mesure échoue (aucun pixel opaque) ou si la graine est invalide.
pub fn theme(reference: &RgbaImage) -> Result<Theme, LogoError> {
    let img = Image::nouvelle(reference.width(), reference.height(), reference.as_raw().clone())?;
    let mesure =
        pixel::mesurer(&img, Reglages { masque: Masque::Alpha(128), boite: None, k: 8 })?;
    let paires: Vec<(u32, u32)> = mesure
        .palette
        .iter()
        .filter_map(|c| argb_from_hex(&c.hex).map(|argb| (argb, (c.part_pct * 100.0).round() as u32)))
        .collect();
    let graine = score(&paires, ScoreOptions::default())
        .first()
        .copied()
        .ok_or_else(|| LogoError::Invalide("score M3 vide".into()))?;
    let requete = ThemeRequest::new(graine, Variant::TonalSpot, 0.0).map_err(LogoError::Invalide)?;
    Ok(Theme { palette: mesure.palette, graine, requete, export: requete.export() })
}

/// Fond des icônes maskable : rôle `tertiaryContainer` du schéma sombre. Les rôles `primary*` sont
/// de la teinte des cheveux, qui s'y fondraient ; la tertiaire s'en écarte.
pub const ROLE_FOND_MASKABLE: (bool, &str) = (true, "tertiaryContainer");
/// Fond de l'apple-touch-icon : rôle `tertiaryContainer` du schéma clair.
pub const ROLE_FOND_APPLE: (bool, &str) = (false, "tertiaryContainer");
/// Fond sur lequel la fidélité du SVG est mesurée : `surface` claire.
pub const ROLE_FOND_MESURE: (bool, &str) = (false, "surface");

/// Fidélité et poids d'un SVG décalqué.
#[derive(Debug, Clone, Copy)]
pub struct MesureSvg {
    /// Résolution du décalque (côté, px).
    pub resolution: u32,
    /// Couches de couleur.
    pub couches: usize,
    /// Taille du fichier, octets.
    pub octets: usize,
    /// SSIM contre l'icône PNG de même taille, sur la surface claire.
    pub ssim: f64,
    /// Part des pixels à ±16 niveaux par canal.
    pub pixels_proches_pct: f64,
}

/// Réglages du décalque SVG.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReglagesSvg {
    /// Côté du décalque, px.
    pub resolution: u32,
    /// Couches de couleur.
    pub couches: usize,
    /// Tolérance de Douglas-Peucker, px.
    pub tolerance: f64,
    /// Trait de chaque couche, de sa propre couleur, px (0 = aucun).
    pub trait_px: f64,
    /// Silhouette sombre sous les couches : les jours entre couches voisines tombent sur la
    /// couleur des contours au lieu du fond.
    pub silhouette: bool,
}

/// Réglages retenus pour `icon.svg` (mesures dans `docs/pipeline-svg.md`).
pub const SVG: ReglagesSvg =
    ReglagesSvg { resolution: SVG_RESOLUTION, couches: SVG_COUCHES, tolerance: 0.5, trait_px: 0.0, silhouette: true };

/// Les couches `(couleur, d)` d'une sortie de [`pixel::vectoriser`], coordonnées entières sans `.00`.
fn couches_svg(brut: &str) -> Result<Vec<(String, String)>, LogoError> {
    let mut couches = Vec::new();
    for ligne in brut.lines() {
        let Some(reste) = ligne.trim().strip_prefix("<path fill=\"") else { continue };
        let (couleur, reste) =
            reste.split_once('"').ok_or_else(|| LogoError::Invalide("path sans fill".into()))?;
        let d = reste
            .split_once(" d=\"")
            .and_then(|(_, d)| d.strip_suffix("\"/>"))
            .ok_or_else(|| LogoError::Invalide("path sans d".into()))?;
        couches.push((couleur.to_owned(), compacter_d(d)));
    }
    if couches.is_empty() {
        return Err(LogoError::Invalide("décalque vide".into()));
    }
    Ok(couches)
}

/// Réécrit un `d` absolu (`M x y L x y … Z`) en relatif : `h`/`v` pour les segments d'axe,
/// `l` implicite enchaîné, nombres sans zéros inutiles. Même géométrie, environ deux fois moins
/// d'octets sur un décalque de grille.
fn compacter_d(d: &str) -> String {
    let mut out = String::with_capacity(d.len() / 2);
    let mut jetons = d.split_whitespace().flat_map(|t| {
        let (cmd, reste) = match t.chars().next() {
            Some(c @ ('M' | 'L' | 'Z')) => (Some(c), &t[1..]),
            _ => (None, t),
        };
        cmd.map(|c| c.to_string()).into_iter().chain((!reste.is_empty()).then(|| reste.to_owned()))
    });
    let (mut x, mut y) = (0.0f64, 0.0f64);
    let mut dernier = ' ';
    let pousser = |out: &mut String, cmd: char, nombres: &[f64], dernier: &mut char| {
        if cmd != *dernier || cmd == 'M' {
            out.push(cmd);
        } else if !nombres.first().is_some_and(|n| *n < 0.0) {
            out.push(' ');
        }
        for (i, n) in nombres.iter().enumerate() {
            let t = format_nombre(*n);
            if i > 0 && !t.starts_with('-') {
                out.push(' ');
            }
            out.push_str(&t);
        }
        *dernier = cmd;
    };
    let mut cmd = 'M';
    while let Some(j) = jetons.next() {
        match j.as_str() {
            "M" | "L" => cmd = if j == "M" { 'M' } else { 'L' },
            "Z" => {
                out.push('z');
                dernier = 'z';
            },
            nombre => {
                let (Ok(nx), Some(Ok(ny))) = (nombre.parse::<f64>(), jetons.next().map(|n| n.parse::<f64>())) else {
                    break;
                };
                if cmd == 'M' {
                    pousser(&mut out, 'M', &[nx, ny], &mut dernier);
                    cmd = 'L';
                } else if (ny - y).abs() < 1e-9 {
                    pousser(&mut out, 'h', &[nx - x], &mut dernier);
                } else if (nx - x).abs() < 1e-9 {
                    pousser(&mut out, 'v', &[ny - y], &mut dernier);
                } else {
                    pousser(&mut out, 'l', &[nx - x, ny - y], &mut dernier);
                }
                (x, y) = (nx, ny);
            },
        }
    }
    out
}

/// Luminance relative approchée d'un `#rrggbb`, pour choisir la couleur des contours.
fn luminance(hex: &str) -> f64 {
    rgb(hex).map_or(f64::MAX, |[r, g, b]| {
        0.0722f64.mul_add(f64::from(b), 0.2126f64.mul_add(f64::from(r), 0.7152 * f64::from(g)))
    })
}

/// Assemble le SVG : silhouette éventuelle, couches avec leur trait, le tout sous un masque de
/// fondu identique à celui des PNG.
fn habiller_svg(
    couches: &[(String, String)],
    silhouette: Option<&str>,
    cote: u32,
    trait_px: f64,
) -> String {
    let mut corps = String::new();
    if let Some(d) = silhouette {
        let sombre = couches
            .iter()
            .map(|(c, _)| c.as_str())
            .min_by(|a, b| luminance(a).total_cmp(&luminance(b)))
            .unwrap_or("#000000");
        corps.push_str(&format!("<path fill=\"{sombre}\" d=\"{d}\"/>
"));
    }
    for (couleur, d) in couches {
        if trait_px > 0.0 {
            corps.push_str(&format!("<path fill=\"{couleur}\" stroke=\"{couleur}\" d=\"{d}\"/>
"));
        } else {
            corps.push_str(&format!("<path fill=\"{couleur}\" d=\"{d}\"/>
"));
        }
    }
    let debut_fondu = format_nombre(1.0 - FONDU_LARGE);
    let trait_attr = if trait_px > 0.0 {
        format!(" stroke-width=\"{}\" stroke-linejoin=\"round\"", format_nombre(trait_px))
    } else {
        String::new()
    };
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {cote} {cote}\" width=\"{cote}\" height=\"{cote}\" role=\"img\" aria-label=\"{NOM}\">
         <title>{NOM}</title>
         <defs><linearGradient id=\"f\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"{debut_fondu}\" stop-color=\"#fff\"/><stop offset=\"1\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient>         <mask id=\"m\"><rect width=\"{cote}\" height=\"{cote}\" fill=\"url(#f)\"/></mask></defs>
         <g mask=\"url(#m)\"{trait_attr}>
{corps}</g>
</svg>
"
    )
}

/// Nombre court pour un attribut SVG.
fn format_nombre(v: f64) -> String {
    let s = format!("{v:.3}");
    s.trim_end_matches('0').trim_end_matches('.').to_owned()
}

/// Décalque le cadre large en SVG et mesure sa fidélité.
///
/// # Errors
/// Si le décalque ou sa rastérisation échouent.
pub fn svg_vectoriel(
    img: &RgbaImage,
    cadrage: &Cadrage,
    reglages: ReglagesSvg,
    fond_mesure: [u8; 3],
) -> Result<(String, MesureSvg), LogoError> {
    let r = reglages.resolution;
    let sujet = rendre(img, cadrage.large, r);
    let source = Image::nouvelle(r, r, sujet.into_raw())?;
    let vecteur = |k: usize| {
        pixel::vectoriser(
            &source,
            ReglagesVecteur { k, tolerance: reglages.tolerance, aire_min: 4, masque: Masque::Alpha(96) },
        )
    };
    let couches = couches_svg(&vecteur(reglages.couches)?)?;
    let silhouette = if reglages.silhouette {
        couches_svg(&vecteur(1)?)?.into_iter().next().map(|(_, d)| d)
    } else {
        None
    };
    let svg = habiller_svg(&couches, silhouette.as_deref(), r, reglages.trait_px);
    let mesure = mesurer_svg(&svg, &icone(img, cadrage, r), fond_mesure)?;
    Ok((svg, MesureSvg { resolution: r, couches: reglages.couches, ..mesure }))
}

/// SSIM et pixels proches entre un SVG rastérisé et sa référence PNG, aplatis sur `fond`.
fn mesurer_svg(svg: &str, reference: &RgbaImage, fond: [u8; 3]) -> Result<MesureSvg, LogoError> {
    let rendu = pixel::rasteriser_svg(svg, reference.width())?;
    let rendu = RgbaImage::from_raw(rendu.largeur, rendu.hauteur, rendu.rgba)
        .ok_or_else(|| LogoError::Invalide("rendu SVG incohérent".into()))?;
    let cmp = pixel::comparer(&aplatir(&rendu, fond)?, &aplatir(reference, fond)?, 16)?;
    Ok(MesureSvg {
        resolution: reference.width(),
        couches: 0,
        octets: svg.len(),
        ssim: cmp.ssim,
        pixels_proches_pct: cmp.pixels_dans_tolerance_pct,
    })
}

/// Le corps (`<g>…</g>`) d'un SVG produit par [`svg_vectoriel`], pour l'imbriquer ailleurs.
fn corps_svg(svg: &str) -> Result<&str, LogoError> {
    let debut =
        svg.find("<defs>").ok_or_else(|| LogoError::Invalide("SVG sans <defs>".into()))?;
    let fin = svg.rfind("</svg>").ok_or_else(|| LogoError::Invalide("SVG non fermé".into()))?;
    Ok(svg[debut..fin].trim_end())
}

/// Logo avec wordmark : l'icône vectorielle suivie de « Aphrody » vectorisé depuis la police
/// (aucune police requise à l'affichage, ce qui compte pour un `<img>`).
///
/// `police` est un TTF/OTF (Google Sans Flex variable), lu à la graisse 500.
///
/// # Errors
/// Si la police est illisible ou ne couvre pas le nom.
pub fn wordmark_svg(
    icone_svg: &str,
    resolution: u32,
    police: &[u8],
    couleur_texte: &str,
) -> Result<String, LogoError> {
    use aphrody_svg::glyph::{Glyph, GlyphOptions, NumberFormat, glyph_outline};
    const HAUTEUR: f32 = 100.0;
    const CORPS: f32 = 62.0;
    const LIGNE: f32 = 72.0;
    const ECART: f32 = 14.0;
    let options = GlyphOptions {
        axes: vec![("wght".into(), 500.0)],
        units_per_em: Some(CORPS),
        format: NumberFormat::Trimmed(2),
        ..GlyphOptions::default()
    };
    let mut x = HAUTEUR + ECART;
    let mut glyphes = String::new();
    for c in NOM.chars() {
        let g = glyph_outline(police, Glyph::Char(c), &options)?
            .ok_or_else(|| LogoError::Invalide(format!("glyphe « {c} » absent de la police")))?;
        if !g.path.is_empty() {
            glyphes.push_str(&format!(
                "<path transform=\"translate({} {})\" d=\"{}\"/>",
                format_nombre(f64::from(x)),
                format_nombre(f64::from(LIGNE)),
                g.path
            ));
        }
        x += g.advance;
    }
    let largeur = format_nombre(f64::from(x + ECART / 2.0));
    let corps = corps_svg(icone_svg)?;
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {largeur} {HAUTEUR}\" height=\"{HAUTEUR}\" role=\"img\" aria-label=\"{NOM}\">\n\
         <title>{NOM}</title>\n\
         <svg width=\"{HAUTEUR}\" height=\"{HAUTEUR}\" viewBox=\"0 0 {resolution} {resolution}\">\n{corps}\n</svg>\n\
         <g fill=\"{couleur_texte}\">{glyphes}</g>\n</svg>\n"
    ))
}

/// Manifeste web : icônes transparentes, maskable et SVG, couleurs tirées des rôles M3.
///
/// # Errors
/// Si un rôle manque au thème.
pub fn manifeste(theme: &Theme) -> Result<String, LogoError> {
    let mut icones: Vec<serde_json::Value> = [192u32, 512]
        .iter()
        .map(|t| {
            serde_json::json!({
                "src": format!("icon-{t}.png"), "sizes": format!("{t}x{t}"),
                "type": "image/png", "purpose": "any",
            })
        })
        .collect();
    icones.push(serde_json::json!({
        "src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any",
    }));
    icones.extend(TAILLES_MASKABLE.iter().map(|t| {
        serde_json::json!({
            "src": format!("maskable-{t}.png"), "sizes": format!("{t}x{t}"),
            "type": "image/png", "purpose": "maskable",
        })
    }));
    let doc = serde_json::json!({
        "name": NOM,
        "short_name": NOM,
        "description": DESCRIPTION,
        "start_url": "/",
        "display": "standalone",
        "background_color": theme.role(false, "surface")?,
        "theme_color": theme.role(false, "primary")?,
        "icons": icones,
    });
    serde_json::to_string_pretty(&doc)
        .map(|s| s + "\n")
        .map_err(|e| LogoError::Invalide(format!("manifeste : {e}")))
}

/// Base64 standard.
fn base64(octets: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(octets)
}

/// `aphrody-logo.css` : `.aphrody-logo` en fond (URL CDN immuable du SVG) et sa variante
/// `.aphrody-logo--inline` (PNG 128 px en data-URI, sans requête).
#[must_use]
pub fn css_logo(url_svg: &str, png_128: &[u8]) -> String {
    format!(
        "/* Aphrody logo. Generated by aphrody-identity (aphrody identity export-assets). */\n\
         .aphrody-logo {{\n  display: inline-block;\n  inline-size: var(--aphrody-logo-size, 2.5rem);\n  \
         block-size: var(--aphrody-logo-size, 2.5rem);\n  background: url(\"{url_svg}\") center / contain no-repeat;\n}}\n\n\
         /* Same logo, no request: the 128 px PNG inlined. */\n\
         .aphrody-logo.aphrody-logo--inline {{\n  background-image: url(\"data:image/png;base64,{}\");\n}}\n",
        base64(png_128)
    )
}

/// Extrait de `css` le bloc `@font-face` de `famille` et l'URL de son `src`.
///
/// C'est ainsi que `aphrody-fonts.css` reprend les descripteurs (axes, `unicode-range`) du
/// propriétaire M3 (`packages/m3-fonts/src/fonts.css` dans Material) au lieu de les recopier.
#[must_use]
pub fn font_face(css: &str, famille: &str) -> Option<(String, String)> {
    let mut reste = css;
    while let Some(i) = reste.find("@font-face") {
        let bloc = &reste[i..];
        let fin = bloc.find('}')? + 1;
        let bloc = &bloc[..fin];
        if bloc.contains(&format!("font-family: \"{famille}\"")) {
            let url = bloc.split_once("url(\"")?.1.split_once("\")")?.0.to_owned();
            return Some((bloc.to_owned(), url));
        }
        reste = &reste[i + fin..];
    }
    None
}

/// `aphrody-fonts.css` : la police de texte M3 servie par le CDN Aphrody, puis les jetons de
/// typographie M3. Les Material Symbols sont importés depuis leur propre feuille publiée.
#[must_use]
pub fn css_polices(face_m3: &str, url_source: &str, url_woff2: &str, url_symbols: &str) -> String {
    let face = face_m3.replace(url_source, url_woff2);
    format!(
        "/* Aphrody fonts. Text: Google Sans Flex (SIL OFL 1.1), served by cdn.aphrody.com; generated by\n   \
         aphrody-identity from Material packages/m3-fonts/src/fonts.css. Icons: Material Symbols, own stylesheet. */\n\
         @import url(\"{url_symbols}\");\n\n{face}\n\n\
         :root {{\n  --md-ref-typeface-brand: \"Google Sans Flex\", system-ui, sans-serif;\n  \
         --md-ref-typeface-plain: \"Google Sans Flex\", system-ui, sans-serif;\n}}\n"
    )
}

/// Encode une image RGBA8 en PNG.
fn png(img: &RgbaImage) -> Result<Vec<u8>, LogoError> {
    Ok(encoder_png(img.as_raw(), img.width(), img.height())?)
}

/// Les polices et URL dont dépendent le wordmark et `aphrody-fonts.css`.
#[derive(Debug, Clone, Copy)]
pub struct Polices<'a> {
    /// TTF/OTF du wordmark (Google Sans Flex variable de `m3-tokens/fonts`).
    pub wordmark: &'a [u8],
    /// Feuille `fonts.css` du paquet M3 (descripteurs `@font-face`).
    pub css_m3: &'a str,
    /// Le WOFF2 référencé par cette feuille pour Google Sans Flex.
    pub woff2: &'a [u8],
}

/// Ce que [`marque`] produit.
#[derive(Debug, Clone)]
pub struct Marque {
    /// Les fichiers, prêts à écrire.
    pub fichiers: Vec<Fichier>,
    /// Le cadrage retenu.
    pub cadrage: Cadrage,
    /// Le thème M3.
    pub theme: Theme,
    /// Fidélité et poids de `icon.svg`.
    pub svg: MesureSvg,
}

/// Origine du CDN.
pub const CDN: &str = "https://cdn.aphrody.com";

/// Feuille des Material Symbols publiée sur le CDN (chemin stable, release du fork
/// `aphrody-labs/material-design-icons`).
pub const SYMBOLS_CSS: &str = "https://cdn.aphrody.com/s/symbols/material-symbols.css";

/// URL immuable (`/h/<sha256[..16]>.<ext>`) d'un contenu publié sur le CDN.
#[must_use]
pub fn url_cdn(cdn: &str, octets: &[u8], ext: &str) -> String {
    format!("{cdn}/h/{}.{ext}", &sha256_hex(octets)[..16])
}

/// Le jeu complet de la marque, depuis le portrait.
///
/// Sans `polices`, le wordmark et `aphrody-fonts.css` ne sont pas produits.
///
/// # Errors
/// Si le cadrage, la mesure, le décalque ou un encodage échouent, ou si `icon.svg` passe sous
/// [`SVG_SSIM_MIN`] ou au-dessus de [`SVG_OCTETS_MAX`].
pub fn marque(img: &RgbaImage, polices: Option<Polices<'_>>, cdn: &str) -> Result<Marque, LogoError> {
    let cadrage = cadrer(img)?;
    let theme = theme(&icone(img, &cadrage, 256))?;
    let fond = |(sombre, nom): (bool, &str)| theme.role(sombre, nom).and_then(rgb);
    let mut fichiers = Vec::new();
    let mut ajouter = |nom: &str, octets: Vec<u8>| fichiers.push(Fichier { nom: nom.into(), octets });

    let mut png_128 = Vec::new();
    for t in TAILLES_PNG {
        let octets = png(&icone(img, &cadrage, t))?;
        if t == 128 {
            png_128.clone_from(&octets);
        }
        ajouter(&format!("icon-{t}.png"), octets);
    }
    let ico = TAILLES_ICO
        .iter()
        .map(|&t| png(&icone(img, &cadrage, t)).map(|p| (t, p)))
        .collect::<Result<Vec<_>, _>>()?;
    ajouter("favicon.ico", assembler_ico(&ico)?);
    for t in TAILLES_MASKABLE {
        ajouter(&format!("maskable-{t}.png"), png(&maskable(img, &cadrage, t, fond(ROLE_FOND_MASKABLE)?))?);
    }
    ajouter("apple-touch-icon.png", png(&apple_touch(img, &cadrage, fond(ROLE_FOND_APPLE)?))?);

    let (svg, mesure) =
        svg_vectoriel(img, &cadrage, SVG, fond(ROLE_FOND_MESURE)?)?;
    if mesure.ssim < SVG_SSIM_MIN || mesure.octets > SVG_OCTETS_MAX {
        return Err(LogoError::Invalide(format!(
            "icon.svg hors bornes : SSIM {:.3} (min {SVG_SSIM_MIN}), {} o (max {SVG_OCTETS_MAX})",
            mesure.ssim, mesure.octets
        )));
    }
    ajouter("aphrody-logo.css", css_logo(&url_cdn(cdn, svg.as_bytes(), "svg"), &png_128).into_bytes());
    if let Some(p) = polices {
        for (nom, sombre) in [("logo-wordmark-light.svg", false), ("logo-wordmark-dark.svg", true)] {
            let texte = theme.role(sombre, "onSurface")?;
            ajouter(nom, wordmark_svg(&svg, SVG_RESOLUTION, p.wordmark, texte)?.into_bytes());
        }
        let (face, url_source) = font_face(p.css_m3, "Google Sans Flex").ok_or_else(|| {
            LogoError::Invalide("@font-face « Google Sans Flex » absent de la feuille M3".into())
        })?;
        let css = css_polices(&face, &url_source, &url_cdn(cdn, p.woff2, "woff2"), SYMBOLS_CSS);
        ajouter("aphrody-fonts.css", css.into_bytes());
    }
    ajouter("icon.svg", svg.into_bytes());
    ajouter("site.webmanifest", manifeste(&theme)?.into_bytes());
    ajouter("m3-tokens.css", theme.requete.css().into_bytes());
    let json = serde_json::to_string_pretty(&theme.export)
        .map_err(|e| LogoError::Invalide(format!("jetons JSON : {e}")))?;
    ajouter("m3-tokens.json", (json + "\n").into_bytes());
    fichiers.sort_by(|a, b| a.nom.cmp(&b.nom));
    Ok(Marque { fichiers, cadrage, theme, svg: mesure })
}

/// Le jeu d'icônes du bundle Tauri (`tauri.conf.json` `bundle.icon`) tiré du logo :
/// `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png` (512) et `icon.ico` (16 à 256).
///
/// # Errors
/// Si le cadrage ou un encodage échouent.
pub fn icones_tauri(img: &RgbaImage) -> Result<Vec<Fichier>, LogoError> {
    let cadrage = cadrer(img)?;
    let mut fichiers = Vec::new();
    for (t, nom) in [(32, "32x32.png"), (128, "128x128.png"), (256, "128x128@2x.png"), (512, "icon.png")] {
        fichiers.push(Fichier { nom: nom.into(), octets: png(&icone(img, &cadrage, t))? });
    }
    let ico = TAILLES_ICO
        .iter()
        .map(|&t| png(&icone(img, &cadrage, t)).map(|p| (t, p)))
        .collect::<Result<Vec<_>, _>>()?;
    fichiers.push(Fichier { nom: "icon.ico".into(), octets: assembler_ico(&ico)? });
    Ok(fichiers)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> RgbaImage {
        portrait().expect("portrait embarqué")
    }

    /// Opaque et (quasi) noir ou blanc : ce qu'un fond plein laisserait au bord.
    fn noir_ou_blanc(p: Rgba<u8>) -> bool {
        p[3] > 200 && (p.0[..3].iter().all(|&c| c < 16) || p.0[..3].iter().all(|&c| c > 239))
    }

    fn bord(img: &RgbaImage) -> impl Iterator<Item = Rgba<u8>> + '_ {
        let (w, h) = img.dimensions();
        img.enumerate_pixels()
            .filter(move |(x, y, _)| *x == 0 || *y == 0 || *x == w - 1 || *y == h - 1)
            .map(|(_, _, p)| *p)
    }

    #[test]
    fn le_webp_rend_les_pixels_de_la_source() {
        let png = image::load_from_memory(include_bytes!("../assets/logo/source/byron_r0.png"))
            .expect("source PNG")
            .to_rgba8();
        let webp = source();
        assert_eq!(png.dimensions(), webp.dimensions());
        for (a, b) in png.pixels().zip(webp.pixels()) {
            assert_eq!(a[3], b[3], "alpha identique");
            if a[3] > 0 {
                assert_eq!(a.0[..3], b.0[..3], "couleur identique sous un alpha non nul");
            }
        }
    }

    #[test]
    fn le_cadrage_tient_le_visage_sans_deformer() {
        let img = source();
        let c = cadrer(&img).expect("cadrage");
        for cadre in [c.large, c.serre] {
            assert!(cadre.x <= i64::from(c.visage.x0) && cadre.y <= i64::from(c.sujet.y0));
            assert!(cadre.x + i64::from(cadre.cote) > i64::from(c.visage.x1));
            assert!(cadre.y + i64::from(cadre.cote) > i64::from(c.visage.y1), "menton dans le cadre");
        }
        assert!(c.serre.cote < c.large.cote, "16-32 px plus serrés");
        // Ratio conservé : le carré rendu à 1:1 est exactement le cadre, pixel pour pixel.
        let rendu = rendre(&img, c.large, c.large.cote);
        let (x, y) = (c.visage.x0, c.visage.y0);
        let dans = rendu.get_pixel((i64::from(x) - c.large.x) as u32, (i64::from(y) - c.large.y) as u32);
        let orig = img.get_pixel(x, y);
        for k in 0..4 {
            assert!(dans[k].abs_diff(orig[k]) <= 1, "{dans:?} contre {orig:?}");
        }
    }

    #[test]
    fn les_icones_transparentes_n_ont_ni_fond_ni_coin_opaque() {
        let img = source();
        let c = cadrer(&img).expect("cadrage");
        for t in TAILLES_PNG.into_iter().chain(TAILLES_ICO) {
            let ic = icone(&img, &c, t);
            assert_eq!(ic.dimensions(), (t, t), "carré {t}");
            assert!(bord(&ic).all(|p| !noir_ou_blanc(p)), "{t} px : pixel noir/blanc opaque au bord");
            for (x, y) in [(0, 0), (t - 1, 0), (0, t - 1), (t - 1, t - 1)] {
                assert_eq!(ic.get_pixel(x, y)[3], 0, "{t} px : coin ({x},{y}) non transparent");
            }
            assert!(ic.pixels().any(|p| p[3] == 255), "{t} px : sujet absent");
        }
    }

    #[test]
    fn les_fonds_opaques_sont_des_tons_m3_ni_noirs_ni_blancs() {
        let img = source();
        let c = cadrer(&img).expect("cadrage");
        let th = theme(&icone(&img, &c, 256)).expect("thème");
        for role in [ROLE_FOND_MASKABLE, ROLE_FOND_APPLE] {
            let f = th.role(role.0, role.1).and_then(rgb).expect("rôle");
            assert!(f != [0, 0, 0] && f != [255, 255, 255], "{role:?} = {f:?}");
        }
        let fond_role = |(sombre, nom): (bool, &str)| th.role(sombre, nom).and_then(rgb).expect("fond");
        let m = maskable(&img, &c, 192, fond_role(ROLE_FOND_MASKABLE));
        assert!(m.pixels().all(|p| p[3] == 255), "maskable opaque");
        let fond = m.get_pixel(0, 0).0;
        // Zone sûre : rien d'autre que le fond hors du cercle de 40 % de rayon.
        for (x, y, p) in m.enumerate_pixels() {
            let (dx, dy) = (f64::from(x) + 0.5 - 96.0, f64::from(y) + 0.5 - 96.0);
            if dx.hypot(dy) > 96.0 * 0.82 {
                assert_eq!(p.0, fond, "contenu hors zone sûre en ({x},{y})");
            }
        }
        let a = apple_touch(&img, &c, fond_role(ROLE_FOND_APPLE));
        assert_eq!(a.dimensions(), (TAILLE_APPLE, TAILLE_APPLE));
        assert!(a.pixels().all(|p| p[3] == 255), "apple-touch-icon opaque");
    }

    #[test]
    fn le_svg_se_rasterise_fidelement() {
        let img = source();
        let c = cadrer(&img).expect("cadrage");
        let th = theme(&icone(&img, &c, 256)).expect("thème");
        let fond = th.role(false, "surface").and_then(rgb).expect("surface");
        let (svg, m) = svg_vectoriel(&img, &c, SVG, fond).expect("svg");
        assert!(!svg.contains("data:image"), "vrai vecteur, pas de raster embarqué");
        assert!(m.ssim >= SVG_SSIM_MIN, "SSIM {:.3}", m.ssim);
        assert!(m.octets <= SVG_OCTETS_MAX, "{} o", m.octets);
        let r = pixel::rasteriser_svg(&svg, 64).expect("rastérisable à 64 px");
        assert_eq!((r.largeur, r.hauteur), (64, 64));
    }

    #[test]
    fn l_ico_porte_toutes_les_tailles() {
        let marque = marque(&source(), None, CDN).expect("marque");
        let ico = &marque.fichiers.iter().find(|f| f.nom == "favicon.ico").expect("ico").octets;
        let dir = ico::IconDir::read(std::io::Cursor::new(ico)).expect("ICO lisible");
        let mut tailles: Vec<u32> = dir.entries().iter().map(ico::IconDirEntry::width).collect();
        tailles.sort_unstable();
        assert_eq!(tailles, TAILLES_ICO);
        for e in dir.entries() {
            let im = e.decode().expect("entrée décodable");
            assert_eq!(im.width(), e.width());
            assert_eq!(im.rgba_data()[3], 0, "coin transparent dans l'ICO");
        }
    }

    #[test]
    fn le_d_compacte_garde_la_geometrie() {
        assert_eq!(compacter_d("M1.00 2.00 L4.00 2.00 L4.00 6.00 L1.00 5.00 Z M10.00 10.00 L11.00 12.00 Z"), "M1 2h3v4l-3-1zM10 10l1 2z");
        assert_eq!(compacter_d("M0.00 0.00 L1.00 1.00 L3.00 4.00 Z"), "M0 0l1 1 2 3z");
    }

    #[test]
    fn la_feuille_m3_donne_son_font_face() {
        let css = "@font-face {\n  font-family: \"X\";\n  src: url(\"a.woff2\");\n}\n@font-face {\n  font-family: \"Google Sans Flex\";\n  src: url(\"../fonts/web/G.woff2\") format(\"woff2\");\n  font-weight: 1 1000;\n}\n";
        let (bloc, url) = font_face(css, "Google Sans Flex").expect("bloc");
        assert_eq!(url, "../fonts/web/G.woff2");
        let sortie = css_polices(&bloc, &url, "https://cdn.aphrody.com/h/0123456789abcdef.woff2", SYMBOLS_CSS);
        assert!(sortie.starts_with("/*") && sortie.contains("@import url(\""));
        assert!(sortie.contains("https://cdn.aphrody.com/h/0123456789abcdef.woff2"));
        assert!(!sortie.contains("googleapis"));
        assert!(sortie.contains("font-weight: 1 1000"));
    }
}
