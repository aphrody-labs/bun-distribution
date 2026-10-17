// SPDX-License-Identifier: Apache-2.0
//! Chargeur d'images et d'icônes : une seule entrée, [`load`]`(source, &Request)`.
//!
//! - **Sources** : fichier, octets, URL `https://cdn.aphrody.com/…`, glyphe Material Symbols
//!   `symbol:<nom>?style=rounded&fill=1&wght=400&grad=0&opsz=24`.
//! - **Formats** (reconnus aux octets, jamais à l'extension) : PNG, JPEG, WebP (alpha), GIF
//!   (première image), SVG (rastérisé à la taille demandée), ICO (toutes les entrées lues, la
//!   meilleure pour la taille demandée, entrées PNG et BMP 1/4/8/24/32 bits).
//! - **Sortie** : RGBA non prémultiplié ([`crate::pixel::Image`]) et métadonnées, ou SVG pour
//!   les sources vectorielles.
//!
//! Le décodage raster est celui de [`crate::pixel`] ([`Image::depuis_octets`]), la
//! rastérisation et la teinte SVG celles d'`aphrody-svg`, les glyphes viennent
//! d'`aphrody_svg::symbols` (ligatures `GSUB` des polices variables, partagé avec `aphrody-bun`).
//! Glyphe : police du style si le [`Loader`] en a une, sinon le SVG du CDN pour les variantes
//! qu'il publie. Les résultats sont mis en cache par empreinte SHA-256 du contenu source et de la
//! requête : deux chemins vers les mêmes octets partagent l'entrée.

#[cfg(feature = "fs")]
use std::path::{Path, PathBuf};
use std::{
    collections::{HashMap, VecDeque},
    fmt,
    io::Cursor,
    str::FromStr,
    sync::{Arc, LazyLock, Mutex, PoisonError},
};

use aphrody_svg::{
    glyph::NumberFormat,
    raster::RenderOptions,
    sanitize::SanitizeOptions,
    symbols::{self, SymbolAxes, SymbolStyle},
    theme::Theme,
    viewbox::{self, Sizing},
};
use sha2::{Digest, Sha256};

use crate::pixel::Image;

/// Seule origine HTTP acceptée par [`Source::Url`] et par les glyphes servis en SVG.
pub const CDN: &str = "https://cdn.aphrody.com/";
/// Taille maximale d'une source, en octets.
pub const MAX_SOURCE: usize = 64 << 20;
/// Côté maximal d'une image produite, en pixels.
pub const MAX_COTE: u32 = 16_384;
/// Nombre maximal de pixels d'une image produite.
pub const MAX_PIXELS: u64 = 64 << 20;
/// Capacité par défaut du cache d'un [`Loader`], en entrées.
pub const CAPACITE: usize = 256;

/// Erreur de chargement. Aucune entrée utilisateur ne provoque de panique.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("{chemin} : {source}")]
    Io {
        chemin: String,
        source: std::io::Error,
    },
    #[error("source de {0} octets, au-delà de {MAX_SOURCE}")]
    TropGrande(usize),
    #[error("URL refusée : {0} (seule {CDN} est acceptée)")]
    UrlRefusee(String),
    #[error("{0} : aucun moyen de télécharger (Loader::with_fetch, ou la feature `net`)")]
    SansReseau(String),
    #[error("{url} : {message}")]
    Reseau { url: String, message: String },
    #[error("{0} : introuvable")]
    Introuvable(String),
    #[error("format non reconnu (attendu PNG, JPEG, WebP, GIF, SVG ou ICO)")]
    FormatInconnu,
    #[error("{format} illisible : {message}")]
    Decodage { format: Format, message: String },
    #[error("glyphe : {0}")]
    SymboleInvalide(String),
    #[error("le symbole {style}/{nom} n'existe pas")]
    SymboleInconnu { nom: String, style: &'static str },
    #[error(
        "symbole {0} : ni police (APHRODY_SYMBOLS_DIR, Loader::with_symbol_dir) ni variante publiée sur le CDN"
    )]
    SymboleIndisponible(String),
    #[error("une source {0} ne se rend pas en SVG")]
    SortieSvg(Format),
    #[error("requête invalide : {0}")]
    Requete(String),
}

/// Format de la source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Format {
    Png,
    Jpeg,
    WebP,
    Gif,
    Svg,
    Ico,
    /// Glyphe Material Symbols.
    Symbole,
}

impl Format {
    /// Nom court : `png`, `jpeg`, `webp`, `gif`, `svg`, `ico`, `symbol`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpeg",
            Self::WebP => "webp",
            Self::Gif => "gif",
            Self::Svg => "svg",
            Self::Ico => "ico",
            Self::Symbole => "symbol",
        }
    }

    /// Reconnaît le format aux premiers octets ; un SVG est un texte dont la première balise
    /// (après déclaration XML, commentaires ou doctype) est `<svg`.
    #[must_use]
    pub fn detecter(octets: &[u8]) -> Option<Self> {
        match octets {
            [0x89, b'P', b'N', b'G', ..] => Some(Self::Png),
            [0xFF, 0xD8, 0xFF, ..] => Some(Self::Jpeg),
            [
                b'R',
                b'I',
                b'F',
                b'F',
                _,
                _,
                _,
                _,
                b'W',
                b'E',
                b'B',
                b'P',
                ..,
            ] => Some(Self::WebP),
            [b'G', b'I', b'F', b'8', b'7' | b'9', b'a', ..] => Some(Self::Gif),
            [0, 0, 1, 0, n0, n1, ..] if u16::from_le_bytes([*n0, *n1]) > 0 => Some(Self::Ico),
            _ => est_svg(octets).then_some(Self::Svg),
        }
    }
}

impl fmt::Display for Format {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

fn est_svg(octets: &[u8]) -> bool {
    let tete = &octets[..octets.len().min(4096)];
    let Ok(texte) =
        std::str::from_utf8(tete).or_else(|e| std::str::from_utf8(&tete[..e.valid_up_to()]))
    else {
        return false;
    };
    let mut reste = texte.trim_start_matches('\u{feff}').trim_start();
    loop {
        if let Some(r) = reste.strip_prefix("<?").and_then(|r| r.split_once("?>")) {
            reste = r.1.trim_start();
        } else if let Some(r) = reste.strip_prefix("<!--").and_then(|r| r.split_once("-->")) {
            reste = r.1.trim_start();
        } else if let Some(r) = reste
            .strip_prefix("<!DOCTYPE")
            .and_then(|r| r.split_once('>'))
        {
            reste = r.1.trim_start();
        } else {
            break;
        }
    }
    reste.starts_with("<svg")
        && reste[4..].starts_with(|c: char| c.is_whitespace() || c == '>' || c == '/')
}

/// Un glyphe Material Symbols : nom, style, axes.
#[derive(Debug, Clone, PartialEq)]
pub struct SymboleSpec {
    pub nom: String,
    pub style: SymbolStyle,
    pub axes: SymbolAxes,
}

impl SymboleSpec {
    /// Lit `home`, `home?style=rounded&fill=1&wght=300&grad=-25&opsz=48` (préfixe `symbol:`
    /// facultatif). Les axes hors bornes et les paramètres inconnus sont refusés, pas corrigés.
    ///
    /// # Erreurs
    /// [`LoadError::SymboleInvalide`] pour un nom, un style, un paramètre ou une valeur invalide.
    pub fn parse(spec: &str) -> Result<Self, LoadError> {
        let spec = spec.strip_prefix("symbol:").unwrap_or(spec);
        let (nom, requete) = spec.split_once('?').unwrap_or((spec, ""));
        if !symbols::is_symbol_name(nom) {
            return Err(LoadError::SymboleInvalide(format!(
                "nom « {nom} » (attendu [a-z0-9_]+)"
            )));
        }
        let mut style = SymbolStyle::Outlined;
        let mut axes = SymbolAxes::default();
        for paire in requete.split('&').filter(|p| !p.is_empty()) {
            let (cle, valeur) = paire.split_once('=').unwrap_or((paire, ""));
            let nombre = |min: f32, max: f32| -> Result<f32, LoadError> {
                valeur
                    .parse::<f32>()
                    .ok()
                    .filter(|v| v.is_finite() && (min..=max).contains(v))
                    .ok_or_else(|| {
                        LoadError::SymboleInvalide(format!("{cle}={valeur} (attendu {min}..{max})"))
                    })
            };
            match cle {
                "style" => {
                    style = SymbolStyle::parse(valeur).ok_or_else(|| {
                        LoadError::SymboleInvalide(format!(
                            "style={valeur} (attendu outlined, rounded ou sharp)"
                        ))
                    })?;
                }
                "fill" => axes.fill = nombre(0.0, 1.0)?,
                "wght" => axes.weight = nombre(100.0, 700.0)?,
                "grad" => axes.grade = nombre(-25.0, 200.0)?,
                "opsz" => axes.optical_size = nombre(20.0, 48.0)?,
                _ => {
                    return Err(LoadError::SymboleInvalide(format!(
                        "paramètre inconnu « {cle} » (style, fill, wght, grad, opsz)"
                    )));
                }
            }
        }
        Ok(Self {
            nom: nom.to_owned(),
            style,
            axes,
        })
    }

    /// Forme canonique : `symbol:home?style=outlined&fill=0&wght=400&grad=0&opsz=24`.
    #[must_use]
    pub fn canonique(&self) -> String {
        let a = self.axes;
        format!(
            "symbol:{}?style={}&fill={}&wght={}&grad={}&opsz={}",
            self.nom,
            self.style.as_str(),
            a.fill,
            a.weight,
            a.grade,
            a.optical_size
        )
    }
}

/// D'où vient l'image.
#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    #[cfg(feature = "fs")]
    Fichier(PathBuf),
    Octets(Arc<[u8]>),
    /// `https://cdn.aphrody.com/…` uniquement.
    Url(String),
    Symbole(SymboleSpec),
}

impl Source {
    /// `symbol:…` → glyphe, `http(s)://…` → URL (refusée au chargement hors du CDN), sinon un
    /// chemin de fichier.
    ///
    /// # Erreurs
    /// Glyphe mal formé, ou chemin sans la feature `fs`.
    pub fn parse(spec: &str) -> Result<Self, LoadError> {
        if spec.starts_with("symbol:") {
            return SymboleSpec::parse(spec).map(Self::Symbole);
        }
        if spec.starts_with("https://") || spec.starts_with("http://") {
            return Ok(Self::Url(spec.to_owned()));
        }
        #[cfg(feature = "fs")]
        {
            Ok(Self::Fichier(PathBuf::from(spec)))
        }
        #[cfg(not(feature = "fs"))]
        {
            Err(LoadError::Requete(format!(
                "{spec} : pas de système de fichiers dans ce build"
            )))
        }
    }

    /// Source en mémoire.
    #[must_use]
    pub fn octets(octets: impl Into<Arc<[u8]>>) -> Self {
        Self::Octets(octets.into())
    }
}

impl FromStr for Source {
    type Err = LoadError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

/// Mise à la taille demandée.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum Fit {
    /// Tient dans le carré `size`, proportions gardées (l'image peut être plus étroite).
    #[default]
    Contain,
    /// Couvre le carré `size`, proportions gardées, puis recadrée au centre.
    Cover,
    /// Étirée au carré `size`.
    Fill,
    /// Taille intrinsèque (multipliée par `scale`), `size` ignoré.
    None,
}

impl Fit {
    /// `contain`, `cover`, `fill`, `none`.
    #[must_use]
    pub fn parse(valeur: &str) -> Option<Self> {
        match valeur {
            "contain" => Some(Self::Contain),
            "cover" => Some(Self::Cover),
            "fill" => Some(Self::Fill),
            "none" => Some(Self::None),
            _ => None,
        }
    }
}

/// Forme du résultat.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum Output {
    /// Pixels RGBA.
    #[default]
    Rgba,
    /// Document SVG (sources SVG et glyphes seulement).
    Svg,
}

/// Ce que l'appelant veut obtenir.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Request {
    /// Côté du carré cible en pixels CSS ; `None` : taille intrinsèque.
    pub size: Option<u32>,
    /// Densité (pixels physiques par pixel CSS), `]0, 16]`.
    pub scale: f32,
    /// Teinte RGBA : RGB remplacé, alpha multiplié (icônes monochromes) ; en SVG, `fill` et
    /// `currentColor` de la racine.
    pub tint: Option<[u8; 4]>,
    pub fit: Fit,
    pub output: Output,
}

impl Default for Request {
    fn default() -> Self {
        Self {
            size: None,
            scale: 1.0,
            tint: None,
            fit: Fit::Contain,
            output: Output::Rgba,
        }
    }
}

impl Request {
    /// Carré de `size` pixels CSS, le reste par défaut.
    #[must_use]
    pub fn px(size: u32) -> Self {
        Self {
            size: Some(size),
            ..Self::default()
        }
    }

    fn valider(&self) -> Result<(), LoadError> {
        if !(self.scale.is_finite() && self.scale > 0.0 && self.scale <= 16.0) {
            return Err(LoadError::Requete(format!(
                "scale {} hors de ]0, 16]",
                self.scale
            )));
        }
        if self.size == Some(0) {
            return Err(LoadError::Requete("size nulle".into()));
        }
        Ok(())
    }

    fn empreinte(&self, h: &mut Sha256) {
        h.update(self.size.unwrap_or(0).to_le_bytes());
        h.update(self.scale.to_bits().to_le_bytes());
        h.update(self.tint.map_or([0; 5], |[r, g, b, a]| [1, r, g, b, a]));
        h.update([self.fit as u8, self.output as u8]);
    }
}

/// Lit `#rgb`, `#rrggbb` ou `#rrggbbaa`.
#[must_use]
pub fn couleur(hex: &str) -> Option<[u8; 4]> {
    let h = hex.strip_prefix('#')?;
    if !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let octet = |i: usize| u8::from_str_radix(h.get(i..i + 2)?, 16).ok();
    match h.len() {
        3 => {
            let c = |i: usize| u8::from_str_radix(h.get(i..=i)?, 16).ok().map(|v| v * 17);
            Some([c(0)?, c(1)?, c(2)?, 255])
        }
        6 => Some([octet(0)?, octet(2)?, octet(4)?, 255]),
        8 => Some([octet(0)?, octet(2)?, octet(4)?, octet(6)?]),
        _ => None,
    }
}

/// Une entrée d'un fichier ICO.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntreeIco {
    pub largeur: u32,
    pub hauteur: u32,
    pub bits: u16,
    pub png: bool,
}

/// Le contenu produit.
#[derive(Debug, Clone)]
pub enum Contenu {
    Rgba(Image),
    Svg(String),
}

/// Résultat d'un chargement.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub format: Format,
    /// Taille intrinsèque de la source (entrée retenue pour un ICO, `opsz` pour un glyphe).
    pub intrinseque: (u32, u32),
    /// Entrées d'un ICO, dans l'ordre du fichier ; vide pour les autres formats.
    pub entrees: Vec<EntreeIco>,
    /// Indice de l'entrée ICO retenue.
    pub entree: Option<usize>,
    pub contenu: Contenu,
    /// SHA-256 du contenu source (octets, ou forme canonique d'un glyphe).
    pub empreinte: [u8; 32],
}

impl Loaded {
    /// Les pixels, pour une sortie RGBA.
    #[must_use]
    pub fn rgba(&self) -> Option<&Image> {
        match &self.contenu {
            Contenu::Rgba(img) => Some(img),
            Contenu::Svg(_) => None,
        }
    }

    /// Le document, pour une sortie SVG.
    #[must_use]
    pub fn svg(&self) -> Option<&str> {
        match &self.contenu {
            Contenu::Svg(s) => Some(s),
            Contenu::Rgba(_) => None,
        }
    }
}

/// Téléchargement : `Ok(None)` pour un 404.
pub type Fetch = dyn Fn(&str) -> Result<Option<Vec<u8>>, String> + Send + Sync;

struct Cache<V> {
    entrees: HashMap<[u8; 32], V>,
    ordre: VecDeque<[u8; 32]>,
}

impl<V> Default for Cache<V> {
    fn default() -> Self {
        Self {
            entrees: HashMap::new(),
            ordre: VecDeque::new(),
        }
    }
}

impl<V: Clone> Cache<V> {
    fn get(&self, cle: &[u8; 32]) -> Option<V> {
        self.entrees.get(cle).cloned()
    }

    fn put(&mut self, cle: [u8; 32], valeur: V, capacite: usize) {
        if capacite == 0 {
            return;
        }
        if self.entrees.insert(cle, valeur).is_none() {
            self.ordre.push_back(cle);
        }
        while self.ordre.len() > capacite {
            if let Some(vieille) = self.ordre.pop_front() {
                self.entrees.remove(&vieille);
            }
        }
    }
}

fn verrou<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Chargeur configuré : polices Material Symbols, téléchargement, cache.
pub struct Loader {
    polices: Mutex<HashMap<SymbolStyle, Option<Arc<[u8]>>>>,
    #[cfg(feature = "fs")]
    dossier_polices: Option<PathBuf>,
    fetch: Option<Arc<Fetch>>,
    capacite: usize,
    rendus: Mutex<Cache<Arc<Loaded>>>,
    telecharges: Mutex<Cache<Arc<[u8]>>>,
}

impl Default for Loader {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for Loader {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Loader")
            .field("fetch", &self.fetch.is_some())
            .field("capacite", &self.capacite)
            .field("en_cache", &self.en_cache())
            .finish_non_exhaustive()
    }
}

impl Loader {
    /// Sans police, sans réseau, cache de [`CAPACITE`] entrées.
    #[must_use]
    pub fn new() -> Self {
        Self {
            polices: Mutex::default(),
            #[cfg(feature = "fs")]
            dossier_polices: None,
            fetch: None,
            capacite: CAPACITE,
            rendus: Mutex::default(),
            telecharges: Mutex::default(),
        }
    }

    /// Le chargeur de [`load`] : polices dans `APHRODY_SYMBOLS_DIR`, sinon celles synchronisées
    /// dans le dépôt Material (`packages/m3-fonts/fonts/upstream/material-symbols`), et le
    /// téléchargement HTTPS avec la feature `net`.
    #[must_use]
    pub fn from_env() -> Self {
        #[allow(unused_mut)]
        let mut loader = Self::new();
        #[cfg(feature = "fs")]
        {
            let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
                .ancestors()
                .nth(3)
                .expect("identity crate is three directories below its workspace root");
            let material = std::env::var_os("APHRODY_MATERIAL_CHECKOUT")
                .filter(|path| !path.is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    workspace
                        .parent()
                        .expect("Aphrody workspace parent")
                        .join("material")
                });
            let depot = material.join("packages/m3-fonts/fonts/upstream/material-symbols");
            let dossier = std::env::var_os("APHRODY_SYMBOLS_DIR")
                .filter(|d| !d.is_empty())
                .map(PathBuf::from)
                .or_else(|| depot.is_dir().then_some(depot));
            if let Some(d) = dossier {
                loader = loader.with_symbol_dir(d);
            }
        }
        #[cfg(feature = "net")]
        {
            loader = loader.with_fetch(fetch_https);
        }
        loader
    }

    /// Dossier des polices `material-symbols-<style>.woff2` (ou `.ttf`), lues à la demande.
    #[cfg(feature = "fs")]
    #[must_use]
    pub fn with_symbol_dir(mut self, dossier: impl Into<PathBuf>) -> Self {
        self.dossier_polices = Some(dossier.into());
        self
    }

    /// Police d'un style, en WOFF2 ou TTF.
    ///
    /// # Erreurs
    /// [`LoadError::Decodage`] si la police est illisible.
    pub fn with_symbol_font(self, style: SymbolStyle, octets: &[u8]) -> Result<Self, LoadError> {
        let ttf = decoder_police(octets)?;
        verrou(&self.polices).insert(style, Some(ttf));
        Ok(self)
    }

    /// Téléchargement des URL du CDN.
    #[must_use]
    pub fn with_fetch(
        mut self,
        fetch: impl Fn(&str) -> Result<Option<Vec<u8>>, String> + Send + Sync + 'static,
    ) -> Self {
        self.fetch = Some(Arc::new(fetch));
        self
    }

    /// Nombre d'entrées gardées en cache (0 : pas de cache).
    #[must_use]
    pub fn with_capacity(mut self, capacite: usize) -> Self {
        self.capacite = capacite;
        self
    }

    /// Nombre de rendus en cache.
    #[must_use]
    pub fn en_cache(&self) -> usize {
        verrou(&self.rendus).entrees.len()
    }

    /// Vide les caches (rendus et téléchargements).
    pub fn vider(&self) {
        *verrou(&self.rendus) = Cache::default();
        *verrou(&self.telecharges) = Cache::default();
    }

    /// Charge `source` selon `requete`.
    ///
    /// # Erreurs
    /// Voir [`LoadError`] : source illisible ou refusée, format inconnu, données corrompues,
    /// glyphe inconnu, requête invalide, SVG demandé pour une image raster.
    pub fn load(&self, source: &Source, requete: &Request) -> Result<Arc<Loaded>, LoadError> {
        requete.valider()?;
        match source {
            #[cfg(feature = "fs")]
            Source::Fichier(chemin) => {
                let octets = lire(chemin)?;
                self.depuis_octets(&octets, requete)
            }
            Source::Octets(octets) => self.depuis_octets(octets, requete),
            Source::Url(url) => {
                let octets = self.telecharger(url)?;
                self.depuis_octets(&octets, requete)
            }
            Source::Symbole(s) => self.symbole(s, requete),
        }
    }

    fn en_cache_ou(
        &self,
        empreinte: [u8; 32],
        requete: &Request,
        produire: impl FnOnce() -> Result<Loaded, LoadError>,
    ) -> Result<Arc<Loaded>, LoadError> {
        let mut h = Sha256::new();
        h.update(empreinte);
        requete.empreinte(&mut h);
        let cle: [u8; 32] = h.finalize().into();
        if let Some(l) = verrou(&self.rendus).get(&cle) {
            return Ok(l);
        }
        let l = Arc::new(produire()?);
        verrou(&self.rendus).put(cle, Arc::clone(&l), self.capacite);
        Ok(l)
    }

    fn depuis_octets(&self, octets: &[u8], requete: &Request) -> Result<Arc<Loaded>, LoadError> {
        if octets.len() > MAX_SOURCE {
            return Err(LoadError::TropGrande(octets.len()));
        }
        let empreinte: [u8; 32] = Sha256::digest(octets).into();
        self.en_cache_ou(empreinte, requete, || {
            let format = Format::detecter(octets).ok_or(LoadError::FormatInconnu)?;
            match format {
                Format::Svg => {
                    let texte = std::str::from_utf8(octets).map_err(|e| LoadError::Decodage {
                        format,
                        message: format!("UTF-8 invalide : {e}"),
                    })?;
                    let propre = aphrody_svg::sanitize::sanitize(texte, SanitizeOptions::default())
                        .map_err(|e| LoadError::Decodage {
                            format,
                            message: e.to_string(),
                        })?;
                    rendre_svg(&propre, format, None, requete, empreinte)
                }
                Format::Ico => charger_ico(octets, requete, empreinte),
                _ => {
                    if requete.output == Output::Svg {
                        return Err(LoadError::SortieSvg(format));
                    }
                    let img = Image::depuis_octets(octets).map_err(|e| LoadError::Decodage {
                        format,
                        message: e.to_string(),
                    })?;
                    let intrinseque = (img.largeur, img.hauteur);
                    Ok(Loaded {
                        format,
                        intrinseque,
                        entrees: Vec::new(),
                        entree: None,
                        contenu: Contenu::Rgba(ajuster(img, requete)?),
                        empreinte,
                    })
                }
            }
        })
    }

    fn telecharger(&self, url: &str) -> Result<Arc<[u8]>, LoadError> {
        let Some(chemin) = url.strip_prefix(CDN) else {
            return Err(LoadError::UrlRefusee(url.to_owned()));
        };
        if chemin.split(['/', '?', '#']).any(|seg| seg == "..") || chemin.contains('\\') {
            return Err(LoadError::UrlRefusee(url.to_owned()));
        }
        let cle: [u8; 32] = Sha256::digest(url.as_bytes()).into();
        if let Some(o) = verrou(&self.telecharges).get(&cle) {
            return Ok(o);
        }
        let fetch = self
            .fetch
            .as_ref()
            .ok_or_else(|| LoadError::SansReseau(url.to_owned()))?;
        let octets = fetch(url)
            .map_err(|message| LoadError::Reseau {
                url: url.to_owned(),
                message,
            })?
            .ok_or_else(|| LoadError::Introuvable(url.to_owned()))?;
        if octets.len() > MAX_SOURCE {
            return Err(LoadError::TropGrande(octets.len()));
        }
        let octets: Arc<[u8]> = octets.into();
        verrou(&self.telecharges).put(cle, Arc::clone(&octets), self.capacite);
        Ok(octets)
    }

    fn police(&self, style: SymbolStyle) -> Result<Option<Arc<[u8]>>, LoadError> {
        if let Some(p) = verrou(&self.polices).get(&style) {
            return Ok(p.clone());
        }
        #[allow(unused_mut)]
        let mut trouvee = None;
        #[cfg(feature = "fs")]
        if let Some(dossier) = &self.dossier_polices {
            let woff2 = dossier.join(style.font_file());
            let ttf = woff2.with_extension("ttf");
            for chemin in [woff2, ttf] {
                if chemin.is_file() {
                    trouvee = Some(decoder_police(&lire(&chemin)?)?);
                    break;
                }
            }
        }
        verrou(&self.polices).insert(style, trouvee.clone());
        Ok(trouvee)
    }

    fn symbole(&self, s: &SymboleSpec, requete: &Request) -> Result<Arc<Loaded>, LoadError> {
        let police = self.police(s.style)?;
        let canonique = s.canonique();
        let mut h = Sha256::new();
        h.update(canonique.as_bytes());
        h.update(if police.is_some() {
            b"police" as &[u8]
        } else {
            b"cdn"
        });
        let empreinte: [u8; 32] = h.finalize().into();
        self.en_cache_ou(empreinte, requete, || {
            let inconnu = || LoadError::SymboleInconnu {
                nom: s.nom.clone(),
                style: s.style.as_str(),
            };
            let opsz = s.axes.optical_size;
            let svg = if let Some(ttf) = police {
                let chemin = symbols::symbol_path(&ttf, &s.nom, s.axes, NumberFormat::Trimmed(2))
                    .map_err(|e| LoadError::Decodage {
                        format: Format::Symbole,
                        message: e.to_string(),
                    })?
                    .ok_or_else(inconnu)?;
                symbols::symbol_svg(&chemin, opsz, None)
            } else {
                let chemin = symbols::cdn_path(&s.nom, s.style, s.axes)
                    .ok_or_else(|| LoadError::SymboleIndisponible(canonique.clone()))?;
                let octets = match self.telecharger(&format!("{CDN}{chemin}")) {
                    Err(LoadError::Introuvable(_)) => return Err(inconnu()),
                    r => r?,
                };
                if Format::detecter(&octets) != Some(Format::Svg) {
                    return Err(LoadError::Decodage {
                        format: Format::Symbole,
                        message: "le CDN n'a pas rendu un SVG".into(),
                    });
                }
                let texte = String::from_utf8_lossy(&octets);
                aphrody_svg::sanitize::sanitize(&texte, SanitizeOptions::default()).map_err(
                    |e| LoadError::Decodage {
                        format: Format::Symbole,
                        message: e.to_string(),
                    },
                )?
            };
            rendre_svg(&svg, Format::Symbole, Some(opsz), requete, empreinte)
        })
    }
}

#[cfg(feature = "fs")]
fn lire(chemin: &Path) -> Result<Vec<u8>, LoadError> {
    let io = |source| LoadError::Io {
        chemin: chemin.display().to_string(),
        source,
    };
    let taille = std::fs::metadata(chemin).map_err(io)?.len();
    if taille > MAX_SOURCE as u64 {
        return Err(LoadError::TropGrande(
            usize::try_from(taille).unwrap_or(usize::MAX),
        ));
    }
    std::fs::read(chemin).map_err(io)
}

fn decoder_police(octets: &[u8]) -> Result<Arc<[u8]>, LoadError> {
    symbols::decode_font(octets)
        .map(|ttf| Arc::from(ttf.into_owned()))
        .map_err(|e| LoadError::Decodage {
            format: Format::Symbole,
            message: e.to_string(),
        })
}

/// Téléchargement HTTPS bloquant (feature `net`), limité à [`MAX_SOURCE`] octets.
///
/// # Erreurs
/// Message de l'erreur réseau ou du statut HTTP (hors 404, rendu `Ok(None)`).
#[cfg(feature = "net")]
pub fn fetch_https(url: &str) -> Result<Option<Vec<u8>>, String> {
    let reponse = ureq::get(url)
        .config()
        .http_status_as_error(false)
        .timeout_global(Some(std::time::Duration::from_secs(20)))
        .build()
        .call()
        .map_err(|e| e.to_string())?;
    match reponse.status().as_u16() {
        404 => Ok(None),
        200..=299 => reponse
            .into_body()
            .with_config()
            .limit(MAX_SOURCE as u64)
            .read_to_vec()
            .map(Some)
            .map_err(|e| e.to_string()),
        s => Err(format!("HTTP {s}")),
    }
}

fn taille_px(v: f64) -> Result<u32, LoadError> {
    let v = v.round();
    if !v.is_finite() || v < 1.0 || v > f64::from(MAX_COTE) {
        return Err(LoadError::Requete(format!(
            "côté de {v} px hors de 1..={MAX_COTE}"
        )));
    }
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "borné ci-dessus"
    )]
    Ok(v as u32)
}

/// Dimensions de rendu `(largeur, hauteur)` puis recadrage éventuel au carré `(côté, côté)`.
fn dimensions(
    intrinseque: (f64, f64),
    requete: &Request,
) -> Result<((u32, u32), Option<u32>), LoadError> {
    let (w, h) = intrinseque;
    if !(w > 0.0 && h > 0.0) {
        return Err(LoadError::Requete("image de taille nulle".into()));
    }
    let s = f64::from(requete.scale);
    let (dims, recadre) = match (requete.size, requete.fit) {
        (None, _) | (_, Fit::None) => ((taille_px(w * s)?, taille_px(h * s)?), None),
        (Some(c), fit) => {
            let cote = f64::from(c) * s;
            match fit {
                Fit::Fill => ((taille_px(cote)?, taille_px(cote)?), None),
                Fit::Contain => {
                    let r = (cote / w).min(cote / h);
                    ((taille_px(w * r)?, taille_px(h * r)?), None)
                }
                Fit::Cover | Fit::None => {
                    let r = (cote / w).max(cote / h);
                    (
                        (taille_px(w * r)?, taille_px(h * r)?),
                        Some(taille_px(cote)?),
                    )
                }
            }
        }
    };
    if u64::from(dims.0) * u64::from(dims.1) > MAX_PIXELS {
        return Err(LoadError::Requete(format!(
            "{}x{} dépasse {MAX_PIXELS} pixels",
            dims.0, dims.1
        )));
    }
    Ok((dims, recadre))
}

fn recadrer(img: Image, cote: u32) -> Image {
    let (w, h) = (img.largeur, img.hauteur);
    if w <= cote && h <= cote {
        return img;
    }
    let (cw, ch) = (cote.min(w), cote.min(h));
    let (x0, y0) = ((w - cw) / 2, (h - ch) / 2);
    let mut rgba = Vec::with_capacity((cw as usize) * (ch as usize) * 4);
    for y in y0..y0 + ch {
        let debut = ((y as usize) * (w as usize) + x0 as usize) * 4;
        rgba.extend_from_slice(&img.rgba[debut..debut + (cw as usize) * 4]);
    }
    Image {
        largeur: cw,
        hauteur: ch,
        rgba,
    }
}

fn teinter(img: &mut Image, [r, g, b, a]: [u8; 4]) {
    for px in img.rgba.as_chunks_mut::<4>().0 {
        #[allow(
            clippy::cast_possible_truncation,
            reason = "produit de deux octets / 255"
        )]
        let alpha = ((u16::from(px[3]) * u16::from(a) + 127) / 255) as u8;
        *px = [r, g, b, alpha];
    }
}

/// Redimensionne (Lanczos 3) selon `fit`, recadre pour `Cover`, teinte.
fn ajuster(img: Image, requete: &Request) -> Result<Image, LoadError> {
    let ((w, h), recadre) = dimensions((f64::from(img.largeur), f64::from(img.hauteur)), requete)?;
    let mut img = if (w, h) == (img.largeur, img.hauteur) {
        img
    } else {
        let tampon = image::RgbaImage::from_raw(img.largeur, img.hauteur, img.rgba)
            .ok_or_else(|| LoadError::Requete("tampon RGBA incohérent".into()))?;
        let r = image::imageops::resize(&tampon, w, h, image::imageops::FilterType::Lanczos3);
        Image {
            largeur: w,
            hauteur: h,
            rgba: r.into_raw(),
        }
    };
    if let Some(cote) = recadre {
        img = recadrer(img, cote);
    }
    if let Some(t) = requete.tint {
        teinter(&mut img, t);
    }
    Ok(img)
}

fn hex([r, g, b, a]: [u8; 4]) -> String {
    if a == 255 {
        format!("#{r:02x}{g:02x}{b:02x}")
    } else {
        format!("#{r:02x}{g:02x}{b:02x}{a:02x}")
    }
}

/// SVG (déjà assaini) vers la sortie demandée. `cote_glyphe` : taille par défaut d'un glyphe.
fn rendre_svg(
    svg: &str,
    format: Format,
    cote_glyphe: Option<f32>,
    requete: &Request,
    empreinte: [u8; 32],
) -> Result<Loaded, LoadError> {
    let erreur = |e: aphrody_svg::Error| LoadError::Decodage {
        format,
        message: e.to_string(),
    };
    let (iw, ih) = viewbox::geometry(svg)
        .map_err(erreur)?
        .size()
        .ok_or_else(|| LoadError::Decodage {
            format,
            message: "SVG sans taille".into(),
        })?;
    // Un glyphe se rend à `opsz` px par défaut, comme la police à sa taille optique.
    let (iw, ih) = cote_glyphe.map_or((iw, ih), |c| (f64::from(c), f64::from(c)));
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "taille d'affichage"
    )]
    let intrinseque = (iw.round().max(1.0) as u32, ih.round().max(1.0) as u32);
    let base = |contenu| Loaded {
        format,
        intrinseque,
        entrees: Vec::new(),
        entree: None,
        contenu,
        empreinte,
    };
    let ((w, h), recadre) = dimensions((iw, ih), requete)?;
    match requete.output {
        Output::Svg => {
            let mut doc = svg.to_owned();
            if let Some(t) = requete.tint {
                doc =
                    aphrody_svg::theme::apply(&doc, &Theme::new().tint(hex(t))).map_err(erreur)?;
            }
            let (w, h) = recadre.map_or((w, h), |c| (c, c));
            let sizing = Sizing::Fixed {
                width: Some(f64::from(w)),
                height: Some(f64::from(h)),
            };
            let doc = viewbox::normalize(&doc, sizing).map_err(erreur)?;
            Ok(base(Contenu::Svg(doc)))
        }
        Output::Rgba => {
            let rendu = aphrody_svg::raster::render(
                svg,
                RenderOptions {
                    width: Some(w),
                    height: Some(h),
                    ..RenderOptions::default()
                },
            )
            .map_err(erreur)?;
            let mut img = Image {
                largeur: rendu.width,
                hauteur: rendu.height,
                rgba: rendu.rgba,
            };
            if let Some(c) = recadre {
                img = recadrer(img, c);
            }
            if let Some(t) = requete.tint {
                teinter(&mut img, t);
            }
            Ok(base(Contenu::Rgba(img)))
        }
    }
}

/// Indice de la meilleure entrée pour un côté cible : la plus petite qui le couvre, sinon la plus
/// grande ; à côté égal, la plus profonde. Sans cible, la plus grande.
#[must_use]
pub fn meilleure_entree(entrees: &[EntreeIco], cible: Option<u32>) -> Option<usize> {
    let cote = |e: &EntreeIco| e.largeur.max(e.hauteur);
    let plus_grande = |(_, a): &(usize, &EntreeIco), (_, b): &(usize, &EntreeIco)| {
        cote(a).cmp(&cote(b)).then(a.bits.cmp(&b.bits))
    };
    let couvrantes = entrees
        .iter()
        .enumerate()
        .filter(|(_, e)| cible.is_some_and(|c| cote(e) >= c));
    couvrantes
        .min_by(|(_, a), (_, b)| cote(a).cmp(&cote(b)).then(b.bits.cmp(&a.bits)))
        .or_else(|| entrees.iter().enumerate().max_by(plus_grande))
        .map(|(i, _)| i)
}

fn charger_ico(octets: &[u8], requete: &Request, empreinte: [u8; 32]) -> Result<Loaded, LoadError> {
    let format = Format::Ico;
    if requete.output == Output::Svg {
        return Err(LoadError::SortieSvg(format));
    }
    let erreur = |message: String| LoadError::Decodage { format, message };
    let dir = ico::IconDir::read(Cursor::new(octets)).map_err(|e| erreur(e.to_string()))?;
    let entrees: Vec<EntreeIco> = dir
        .entries()
        .iter()
        .map(|e| EntreeIco {
            largeur: e.width(),
            hauteur: e.height(),
            bits: e.bits_per_pixel(),
            png: e.is_png(),
        })
        .collect();
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "borné à MAX_COTE"
    )]
    let cible = requete.size.map(|s| {
        (f64::from(s) * f64::from(requete.scale))
            .round()
            .min(f64::from(MAX_COTE)) as u32
    });
    let i = meilleure_entree(&entrees, cible).ok_or_else(|| erreur("aucune entrée".into()))?;
    let entree = &dir.entries()[i];
    let img = if entree.is_png() {
        Image::depuis_octets(entree.data()).map_err(|e| erreur(format!("entrée {i} : {e}")))?
    } else {
        let d = entree
            .decode()
            .map_err(|e| erreur(format!("entrée {i} : {e}")))?;
        Image::nouvelle(d.width(), d.height(), d.into_rgba_data())
            .map_err(|e| erreur(format!("entrée {i} : {e}")))?
    };
    let intrinseque = (img.largeur, img.hauteur);
    Ok(Loaded {
        format,
        intrinseque,
        entrees,
        entree: Some(i),
        contenu: Contenu::Rgba(ajuster(img, requete)?),
        empreinte,
    })
}

static LOADER: LazyLock<Loader> = LazyLock::new(Loader::from_env);

/// Charge `source` avec le chargeur du processus ([`Loader::from_env`]).
///
/// # Erreurs
/// Voir [`Loader::load`].
pub fn load(source: &Source, requete: &Request) -> Result<Arc<Loaded>, LoadError> {
    LOADER.load(source, requete)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_reconnus_aux_octets() {
        assert_eq!(Format::detecter(b"\x89PNG\r\n"), Some(Format::Png));
        assert_eq!(Format::detecter(b"\xFF\xD8\xFF\xE0"), Some(Format::Jpeg));
        assert_eq!(
            Format::detecter(b"RIFF\0\0\0\0WEBPVP8L"),
            Some(Format::WebP)
        );
        assert_eq!(Format::detecter(b"GIF89a"), Some(Format::Gif));
        assert_eq!(Format::detecter(b"\0\0\x01\0\x02\0"), Some(Format::Ico));
        assert_eq!(Format::detecter(b"\0\0\x01\0\0\0"), None);
        assert_eq!(
            Format::detecter(b"\xEF\xBB\xBF<?xml version=\"1.0\"?>\n<!-- c --><svg xmlns=\"\"/>"),
            Some(Format::Svg)
        );
        assert_eq!(Format::detecter(b"<svgx>"), None);
        assert_eq!(Format::detecter(b"<html><svg>"), None);
        assert_eq!(Format::detecter(b""), None);
    }

    #[test]
    fn specs_de_glyphe() {
        let s = SymboleSpec::parse("symbol:home?style=rounded&fill=1&wght=300&grad=-25&opsz=48")
            .expect("valide");
        assert_eq!(s.nom, "home");
        assert_eq!(s.style, SymbolStyle::Rounded);
        assert_eq!(
            s.axes,
            SymbolAxes {
                fill: 1.0,
                weight: 300.0,
                grade: -25.0,
                optical_size: 48.0
            }
        );
        assert_eq!(
            SymboleSpec::parse("home").expect("défauts").canonique(),
            "symbol:home?style=outlined&fill=0&wght=400&grad=0&opsz=24"
        );
        for faux in [
            "",
            "Home",
            "../x",
            "a?style=bold",
            "a?wght=900",
            "a?fill=x",
            "a?zoom=2",
            "a?opsz=NaN",
        ] {
            assert!(
                matches!(SymboleSpec::parse(faux), Err(LoadError::SymboleInvalide(_))),
                "{faux}"
            );
        }
    }

    #[test]
    fn couleurs() {
        assert_eq!(couleur("#6750a4"), Some([0x67, 0x50, 0xa4, 255]));
        assert_eq!(couleur("#fff"), Some([255, 255, 255, 255]));
        assert_eq!(couleur("#00000080"), Some([0, 0, 0, 0x80]));
        assert_eq!(couleur("6750a4"), None);
        assert_eq!(couleur("#ggg"), None);
        assert_eq!(couleur("#é00"), None);
    }

    #[test]
    fn choix_d_entree() {
        let e = |c: u32, bits: u16| EntreeIco {
            largeur: c,
            hauteur: c,
            bits,
            png: false,
        };
        let entrees = [e(16, 32), e(32, 8), e(32, 32), e(48, 32), e(256, 32)];
        assert_eq!(meilleure_entree(&entrees, Some(24)), Some(2));
        assert_eq!(meilleure_entree(&entrees, Some(32)), Some(2));
        assert_eq!(meilleure_entree(&entrees, Some(49)), Some(4));
        assert_eq!(meilleure_entree(&entrees, Some(512)), Some(4));
        assert_eq!(meilleure_entree(&entrees, None), Some(4));
        assert_eq!(meilleure_entree(&[], Some(16)), None);
    }

    #[test]
    fn dimensions_selon_fit() {
        let r = |size, fit| Request {
            size,
            fit,
            ..Request::default()
        };
        assert_eq!(
            dimensions((200.0, 100.0), &r(Some(50), Fit::Contain)).ok(),
            Some(((50, 25), None))
        );
        assert_eq!(
            dimensions((200.0, 100.0), &r(Some(50), Fit::Cover)).ok(),
            Some(((100, 50), Some(50)))
        );
        assert_eq!(
            dimensions((200.0, 100.0), &r(Some(50), Fit::Fill)).ok(),
            Some(((50, 50), None))
        );
        assert_eq!(
            dimensions((200.0, 100.0), &r(Some(50), Fit::None)).ok(),
            Some(((200, 100), None))
        );
        let x2 = Request {
            scale: 2.0,
            ..r(None, Fit::Contain)
        };
        assert_eq!(dimensions((20.0, 10.0), &x2).ok(), Some(((40, 20), None)));
        assert!(dimensions((1.0, 1.0), &r(Some(20_000), Fit::Fill)).is_err());
        assert!(dimensions((0.0, 1.0), &r(None, Fit::Fill)).is_err());
    }
}
