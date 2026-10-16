//! Parsers de formats Level-5 / Criware portés en Rust, `no_std`-friendly (alloc) pour
//! la portabilité wasm.
//!
//! ## Modules disponibles
//!
//! - [`crilayla`] — décompresseur CRILAYLA complet (LZ bitstream inversé).
//! - [`cpk`] — lecteur de tables `@UTF` et d'archives CPK Criware (big-endian).
//! - [`cfgbin`] — lecteur de fichiers RDBN (cfg.bin Level-5) + décodage des VALEURS typées.
//! - [`g4tx`] — conteneurs de textures G4TX (header + entrées + atlas + noms).
//! - [`nxtch`] — chunks de texture Switch NXTCH + déswizzle GOB Tegra X1.
//! - [`g4md`] — métadonnées de modèle G4MD (sous-mailles + attributs vertex + materials).
//! - [`g4mg`] — géométrie G4MG (positions/normales/UV0/indices) pilotée par le `.g4md`.
//! - [`g4sk`] — squelettes G4SK (header garanti + hiérarchie d'os RÉSOLUE via la table
//!   d'offsets de l'en-tête, recoupée sur un `.g4sk` réel ; fallback heuristique).
//! - [`g4pk`] — Level-5 G4PK archives and legacy G4RA magic detection.
//! - [`g4ra`] — static reference-animation state, clip and target bindings.
//!
//! ## Compatibilité `no_std`
//!
//! Ce crate utilise `alloc` (via `extern crate alloc`). `FormatError`/`AssembleError`
//! implémentent `core::error::Error` **à la main** (plus de dépendance `thiserror`, Phase 3 dédup) →
//! types d'erreur `no_std`-ready. NB : le `#![no_std]` strict reste à faire (l'I/O des parseurs
//! utilise encore `std::io::Cursor` ; gating à venir, cf. `docs/nie/ARCHITECTURE.md` Phase 3).
//!
//! ## Chiffrement CPK IEVR (déchiffré, vérifié au réel)
//!
//! Les CPK de `data/packs/` d'Inazuma Eleven: Victory Road sont chiffrés par l'enveloppe
//! CRI Middleware « position-based XOR », clé dérivée du **nom de fichier** (CRC32 standard).
//! [`cpk::decrypt_and_check_cpk`] déchiffre en place et vérifie que le résultat est un en-tête
//! `CPK ` + table `@UTF` (anti-hallucination). Porté de `CriwareCrypt.cs` / `NativeCrypto.cs`
//! et recoupé sur des octets réels du dump VPS. La constante d'audit `0x1717E18E`
//! ([`cpk::VIOLA_FIXED_KEY`]) est la clé Viola des `cfg.bin`, PAS celle des packs.
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]
// `#![no_std]` strict hors feature `std` (dédup Phase 3). Cœur de parseurs = alloc-only ;
// assemble/vfs (I/O fichiers) + cri_audio (maths flottantes ADX f64::cos/sqrt) + textures/audio-decode
// = std. `default = ["std"]` → build par défaut INCHANGÉ ; `--no-default-features` = cœur no_std (aphrody-nie-data).
#![cfg_attr(not(feature = "std"), no_std)]

// `FormatError::Malformed` porte un message construit : la crate a besoin d'`alloc` au niveau
// racine, pas seulement dans les modules qui le déclarent chacun de leur côté.
extern crate alloc;

/// Reusable bitmap text from native cfg/G4TX assets.
#[cfg(feature = "textures")]
pub mod bitmap_font;

/// Assemblage GLB d'un personnage (feature `std` : I/O fichiers + `HashMap`).
#[cfg(feature = "std")]
pub mod assemble;
/// Pure IEVR asset-family and preview classification used by native hosts.
pub mod asset;
pub mod cfgbin;
#[cfg(feature = "std")]
pub mod col;
pub mod cpk;
/// Encodeur CPK/@UTF (contrepartie écriture de [`cpk`]) — même gating (aucun, `alloc`-only).
pub mod cpk_encode;
/// Parseurs/décodeurs audio Criware (feature `std` : ADX décode via `f64::cos`/`sqrt`).
#[cfg(feature = "std")]
pub mod cri_audio;
pub mod crilayla;
/// Dispatch « octets → JSON », partagé par la FFI, la CLI et le décodage en lot.
#[cfg(all(feature = "std", feature = "serde"))]
pub mod decode;
#[cfg(feature = "std")]
pub mod dxbc;
/// Scripts d'événements et cinématiques Level-5 (`ev*.cfg.bin`, format T2B).
pub mod event_script;
#[cfg(feature = "std")]
pub mod font;
#[cfg(feature = "std")]
pub mod g4cm;
#[cfg(feature = "std")]
pub mod g4la;
#[cfg(feature = "std")]
pub mod g4ma;
#[cfg(feature = "std")]
pub mod g4md;
#[cfg(feature = "std")]
pub mod g4mg;
#[cfg(feature = "std")]
pub mod g4mt;
#[cfg(feature = "std")]
pub mod g4pk;
#[cfg(feature = "std")]
pub mod g4pkm;
#[cfg(feature = "std")]
pub mod g4pkm_motion;
#[cfg(feature = "std")]
pub mod g4ra;
#[cfg(feature = "std")]
pub mod g4sk;
#[cfg(feature = "std")]
pub mod g4tx;
/// Décodeur G4TX/DDS → RGBA8/PNG (source unique du workspace, feature `textures`).
#[cfg(feature = "textures")]
pub mod g4tx_decode;
/// Encodeur G4TX/DDS (RGBA8 → BGRA8 non compressé → conteneur G4TX mono- ou multi-texture) — contrepartie
/// écriture de [`g4tx_decode`], même gating (ses tests round-trip en dépendent).
#[cfg(feature = "textures")]
pub mod g4tx_encode;
/// Recoloration d'un conteneur G4TX entier : décodage réel, filtre [`recolor`], réencodage réel.
/// Porte aussi la reconstruction partielle partagée d'un conteneur (`reencode_with_payloads`).
#[cfg(feature = "textures")]
pub mod g4tx_recolor;
#[cfg(feature = "std")]
pub mod g4vs;
/// Encodage d'une image RGBA8 vers les formats d'échange (WebP sans perte, GIF, JPEG, BMP, TGA,
/// TIFF, QOI) — feature `images`. Le PNG y garde son chemin `png` historique, byte-exact.
#[cfg(feature = "images")]
pub mod image_out;
/// Comparaison d'images de rendu : identité, ΔE2000, SSIM par région, carte par bloc, masques ROI.
#[cfg(feature = "std")]
pub mod imgmetric;
/// Conteneur et flux vidéo IVF (VP8/VP9/AV1) pur Rust, no_std.
pub mod ivf;
#[cfg(feature = "std")]
pub mod level5;
#[cfg(feature = "std")]
pub mod lip;
/// VFS-derived locale discovery for text, textures, fonts, and Criware assets.
pub mod locale;
#[cfg(feature = "std")]
pub mod menu;
/// Composition d'un layout de menu exporté par le runtime → image RGBA8 (feature `textures`).
#[cfg(feature = "textures")]
pub mod menu_layout;
/// Portable, measured VFS presentations shared by native and browser hosts.
#[cfg(all(feature = "std", feature = "serde"))]
pub mod menu_presentation;
/// Le layout d'un écran de menu, construit depuis les octets du jeu (feature `std`).
#[cfg(feature = "std")]
pub mod menu_screen;
#[cfg(feature = "std")]
pub mod mevbin;
/// Muxeur MP4/AVC pur Rust (H.264 Annex-B → `ftyp`/`moov`/`mdat`) — remplace l'appel `ffmpeg`.
pub mod mp4;
#[cfg(feature = "std")]
pub mod navm;
#[cfg(feature = "std")]
pub mod nxtch;
#[cfg(feature = "std")]
pub mod objbin;
/// Utilitaires de noms de chemins d'assets (file-stem byte-exact `FUN_140452820`), no_std.
pub mod pathname;
/// Analyse mesurée des planches de personnage (`chr/_face/20_EDIT`) : zones, rôle, convention de
/// composition. Source unique des seuils employés par [`image_out`].
pub mod planche;
/// Atlas d'icônes `.g4tx` → feuille de sprites CSS / SVG / JSON, pour le web et l'explorateur.
/// Déformation de maillage par squelette (*linear blend skinning*) : matrices monde animées,
/// matrices de skinning, et application aux sommets. Même gating que `assemble`/`g4sk`, dont il
/// consomme les types.
#[cfg(feature = "std")]
pub mod pose;
/// Deterministic startup VFS bundle container shared by native packers and WebAssembly readers.
#[cfg(all(feature = "std", feature = "serde"))]
pub mod preloaded_vfs;
/// Primitives 2D RGBA8 pures (crop/scale nearest) — source unique, no_std (le blend reste landmine #5).
pub mod raster2d;
pub mod rdbn_patch;
/// Recoloration d'une image RGBA8 (décalage TSV + rampe de luminance), alloc-only.
pub mod recolor;
#[cfg(feature = "std")]
pub mod sprite_sheet;
/// `strcmp` byte-exact (`FUN_14168b570`, MSVC SIMD) — comparaison C non signée, no_std.
pub mod strcmp;
/// `strlen` byte-exact (`FUN_14168b5f0`, MSVC SWAR) — longueur de chaîne C, no_std.
pub mod strlen;
/// `strncmp` byte-exact (`FUN_14168b330`, MSVC) — comparaison C bornée non signée, no_std.
pub mod strncmp;
pub mod t2b_patch;
/// Démultiplexeur USM/Sofdec2 complet : métadonnées `@UTF`, images, pistes sonores.
#[cfg(feature = "std")]
pub mod usm;
/// VFS multi-CPK (feature `std` : lit `cpk_list.cfg.bin` + CPK via `std::fs`).
#[cfg(feature = "std")]
pub mod vfs;

#[cfg(all(feature = "std", not(target_arch = "wasm32")))]
pub mod game_source;
#[cfg(all(feature = "remote-vfs", not(target_arch = "wasm32")))]
mod vfs_remote;
/// Muxeur WebM/Matroska pur Rust (VP9) — contrepartie de [`mp4`] pour les deux plus longs films.
pub mod webm;

#[derive(Debug)]
pub enum FormatError {
    /// Tampon trop court (`got` octets fournis, `need` requis).
    TooShort { got: usize, need: usize },
    /// Magic invalide pour le format attendu.
    BadMagic { format: &'static str },
    /// Données corrompues.
    Corrupt(&'static str),
    /// Structure incohérente, avec le détail chiffré (offset, compteur…) qui permet de la situer.
    ///
    /// Distinct de [`Self::Corrupt`], qui ne porte qu'un message figé : un décodeur qui suit des
    /// offsets calculés doit pouvoir dire **lesquels** ne retombent pas juste, sinon le
    /// diagnostic se refait à la main à chaque fois.
    Malformed(alloc::string::String),
}

// Display + Error MANUELS (no_std-ready via `core::error::Error`) — `thiserror` retiré (Phase 3 dédup).
impl core::fmt::Display for FormatError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::TooShort { got, need } => {
                write!(f, "tampon trop court : {got} octets, {need} attendus")
            },
            Self::BadMagic { format } => write!(f, "magic invalide pour {format}"),
            Self::Corrupt(s) => write!(f, "données corrompues : {s}"),
            Self::Malformed(s) => write!(f, "structure incohérente : {s}"),
        }
    }
}

impl core::error::Error for FormatError {}

/// Familles de formats reconnues dans l'écosystème IEVR (standardisées sur 28 formats VFS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[repr(u32)]
pub enum FileFormat {
    /// Inconnu ou non supporté.
    Unknown = 0,
    /// Texture Level-5 (`G4TX`).
    G4tx = 1,
    /// Métadonnées de modèle 3D (`G4MD`).
    G4md = 2,
    /// Mesh / géométrie Level-5 (`G4MG`).
    G4mg = 3,
    /// Propriétés de matériau (`G4MT`).
    G4mt = 4,
    /// Squelette & os (`G4SK`).
    G4sk = 5,
    /// Pack de ressources (`G4PK`).
    G4pk = 6,
    /// Archive de ressources (`G4RA`).
    G4ra = 7,
    /// Animation Graphic Interface (`AGI `).
    Agi = 8,
    /// Object Binary (`OBJB`).
    Objb = 9,
    /// Collision Level-5 (`PXCL`, extension `.col` ou `.pxcl`).
    Col = 10,
    /// Config binaire Level-5 (RDBN / cfg.bin / T2B).
    CfgBin = 11,
    /// Script d'événements Level-5 (`MEVS` / `.mevbin`).
    Mevs = 12,
    /// Trajectoire de caméra (`G4CM`).
    G4cm = 13,
    /// Archive Criware (`CPK `).
    Cpk = 14,
    /// Archive audio AWB (`AFS2`).
    Awb = 15,
    /// Table @UTF Criware (`@UTF`).
    Utf = 16,
    /// DirectDraw Surface (`DDS `).
    Dds = 17,
    /// Portable Network Graphics (`PNG\r`).
    Png = 18,
    /// Audio WAV Resource Interchange (`RIFF`).
    Riff = 19,
    /// Archive legacy Level-5 (`XPCK`).
    Xpck = 20,
    /// Système de fichiers Level-5 (`XFSA`).
    Xfsa = 21,
    /// Compression CriLayla (`CRILAYLA`).
    CriLayla = 22,
    /// Banque audio ACB (`@ACB`).
    Acb = 23,
    /// Vidéo USM Sofdec2 (`CRID`).
    Usm = 24,
    /// Navmesh Level-5 (magic réel `NAVM`, extension `.g4nv`).
    G4nv = 25,
    /// Mesh de collision Level-5 (`COL\0`).
    ColMesh = 26,
    /// Set de collision Level-5 (`COLS`).
    Cols = 27,
    /// Conteneur de sauvegarde Lives (`LIVE` / 0x9DCE66C3).
    Live = 28,
    /// Audio HCA Criware (`HCA\0` ou `@HCA`).
    Hca = 29,
    /// Synchronisation labiale (`lip\0`, extension `.p3lip`).
    Lip = 30,
    /// DirectX Bytecode shader Microsoft (`DXBC`).
    Dxbc = 31,
}

/// Descripteur complet et standardisé d'un format de fichier VFS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FormatDescriptor {
    /// Identifiant stable (1..28 ou étendu).
    pub id: u32,
    /// Nom court standardisé.
    pub name: &'static str,
    /// Magic 4-octets en hexadécimal.
    pub magic_hex: &'static str,
    /// Représentation ASCII du magic.
    pub magic_ascii: &'static str,
    /// Extension de fichier principale.
    pub extension: &'static str,
    /// Type MIME standardisé.
    pub mime_type: &'static str,
    /// Catégorie fonctionnelle.
    pub category: &'static str,
    /// Vrai si l'endianness est grand-boutiste (Big-Endian).
    pub is_big_endian: bool,
    /// Vrai si le format supporte le chiffrement.
    pub encryption_supported: bool,
    /// Vrai si le format supporte la compression (CRILAYLA, LZSS, Deflate).
    pub compression_supported: bool,
    /// Description lisible du rôle et du contenu.
    pub description: &'static str,
}

impl FileFormat {
    /// Identifiant discriminant stable (1..28 pour les formats standards VFS).
    #[must_use]
    pub const fn id(self) -> u32 {
        self as u32
    }

    /// Résout un `FileFormat` depuis son identifiant numérique.
    #[must_use]
    pub const fn from_id(id: u32) -> Self {
        match id {
            1 => Self::G4tx,
            2 => Self::G4md,
            3 => Self::G4mg,
            4 => Self::G4mt,
            5 => Self::G4sk,
            6 => Self::G4pk,
            7 => Self::G4ra,
            8 => Self::Agi,
            9 => Self::Objb,
            10 => Self::Col,
            11 => Self::CfgBin,
            12 => Self::Mevs,
            13 => Self::G4cm,
            14 => Self::Cpk,
            15 => Self::Awb,
            16 => Self::Utf,
            17 => Self::Dds,
            18 => Self::Png,
            19 => Self::Riff,
            20 => Self::Xpck,
            21 => Self::Xfsa,
            22 => Self::CriLayla,
            23 => Self::Acb,
            24 => Self::Usm,
            25 => Self::G4nv,
            26 => Self::ColMesh,
            27 => Self::Cols,
            28 => Self::Live,
            29 => Self::Hca,
            30 => Self::Lip,
            31 => Self::Dxbc,
            _ => Self::Unknown,
        }
    }

    /// Nom court lisible.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::G4tx => "G4TX",
            Self::G4md => "G4MD",
            Self::G4mg => "G4MG",
            Self::G4mt => "G4MT",
            Self::G4sk => "G4SK",
            Self::G4pk => "G4PK",
            Self::G4ra => "G4RA",
            Self::Agi => "AGI",
            Self::Objb => "OBJB",
            Self::Col => "col",
            Self::CfgBin => "cfg.bin",
            Self::Mevs => "mevbin",
            Self::G4cm => "G4CM",
            Self::Cpk => "CPK",
            Self::Awb => "AWB",
            Self::Utf => "@UTF",
            Self::Dds => "DDS",
            Self::Png => "PNG",
            Self::Riff => "WAV",
            Self::Xpck => "XPCK",
            Self::Xfsa => "XFSA",
            Self::CriLayla => "CRILAYLA",
            Self::Acb => "ACB",
            Self::Usm => "USM",
            Self::G4nv => "G4NV",
            Self::ColMesh => "COL",
            Self::Cols => "COLS",
            Self::Live => "LIVE",
            Self::Hca => "HCA",
            Self::Lip => "p3lip",
            Self::Dxbc => "DXBC",
            Self::Unknown => "?",
        }
    }

    /// Extension principale normalisée avec le point (ex. `.g4tx`).
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            Self::G4tx => ".g4tx",
            Self::G4md => ".g4md",
            Self::G4mg => ".g4mg",
            Self::G4mt => ".g4mt",
            Self::G4sk => ".g4sk",
            Self::G4pk => ".g4pk",
            Self::G4ra => ".g4ra",
            Self::Agi => ".agi",
            Self::Objb => ".objb",
            Self::Col => ".pxcl",
            Self::CfgBin => ".cfg.bin",
            Self::Mevs => ".mevbin",
            Self::G4cm => ".g4cm",
            Self::Cpk => ".cpk",
            Self::Awb => ".afs2",
            Self::Utf => ".utf",
            Self::Dds => ".dds",
            Self::Png => ".png",
            Self::Riff => ".wav",
            Self::Xpck => ".xpck",
            Self::Xfsa => ".xfsa",
            Self::CriLayla => ".crilayla",
            Self::Acb => ".acb",
            Self::Usm => ".usm",
            Self::G4nv => ".g4nv",
            Self::ColMesh => ".col",
            Self::Cols => ".cols",
            Self::Live => ".live",
            Self::Hca => ".hca",
            Self::Lip => ".p3lip",
            Self::Dxbc => ".vfxo",
            Self::Unknown => ".bin",
        }
    }

    /// Type MIME officiel ou standardisé.
    #[must_use]
    pub const fn mime_type(self) -> &'static str {
        match self {
            Self::G4tx => "image/x-level5-g4tx",
            Self::G4md => "model/x-level5-g4md",
            Self::G4mg => "model/x-level5-g4mg",
            Self::G4mt => "model/x-level5-g4mt",
            Self::G4sk => "model/x-level5-g4sk",
            Self::G4pk => "application/x-level5-g4pk",
            Self::G4ra => "application/x-level5-g4ra",
            Self::Agi => "application/x-level5-agi",
            Self::Objb => "application/x-level5-objb",
            Self::Col => "application/x-level5-pxcl",
            Self::CfgBin => "application/x-level5-rdbn",
            Self::Mevs => "application/x-level5-mevs",
            Self::G4cm => "application/x-level5-g4cm",
            Self::Cpk => "application/x-crifs-cpk",
            Self::Awb => "audio/x-cri-afs2",
            Self::Utf => "application/x-cri-utf",
            Self::Dds => "image/vnd-ms.dds",
            Self::Png => "image/png",
            Self::Riff => "audio/wav",
            Self::Xpck => "application/x-level5-xpck",
            Self::Xfsa => "application/x-level5-xfsa",
            Self::CriLayla => "application/x-cri-layla",
            Self::Acb => "audio/x-cri-acb",
            Self::Usm => "video/x-cri-usm",
            Self::G4nv => "application/x-level5-g4nv",
            Self::ColMesh => "application/x-level5-col",
            Self::Cols => "application/x-level5-cols",
            Self::Live => "application/x-level5-live",
            Self::Hca => "audio/x-cri-hca",
            Self::Lip => "application/x-level5-lip",
            Self::Dxbc => "application/x-ms-dxbc",
            Self::Unknown => "application/octet-stream",
        }
    }

    /// Catégorie fonctionnelle du format.
    #[must_use]
    pub const fn category(self) -> &'static str {
        match self {
            Self::G4tx | Self::Dds | Self::Png => "texture",
            Self::G4md | Self::G4mg | Self::G4mt | Self::G4sk | Self::Agi => "model",
            Self::G4pk
            | Self::G4ra
            | Self::Cpk
            | Self::Utf
            | Self::Xpck
            | Self::Xfsa
            | Self::CriLayla => "container",
            Self::Objb | Self::CfgBin => "config",
            Self::Mevs | Self::G4cm => "script",
            Self::Awb | Self::Acb | Self::Hca | Self::Riff => "audio",
            Self::Usm => "video",
            Self::Col | Self::ColMesh | Self::Cols => "collision",
            Self::G4nv | Self::Live | Self::Lip | Self::Dxbc | Self::Unknown => "system",
        }
    }

    /// Vrai si le format utilise l'ordre d'octets gros-boutiste (Big-Endian).
    #[must_use]
    pub const fn is_big_endian(self) -> bool {
        matches!(self, Self::Cpk | Self::Utf | Self::Acb | Self::Usm | Self::Png)
    }

    /// Vrai si le format supporte le chiffrement (Viola, CRI XOR, ou clé filename).
    #[must_use]
    pub const fn supports_encryption(self) -> bool {
        matches!(
            self,
            Self::CfgBin | Self::Cpk | Self::Awb | Self::Utf | Self::Acb | Self::Usm | Self::Live
        )
    }

    /// Vrai si le format supporte la compression (CRILAYLA, LZSS, Deflate).
    #[must_use]
    pub const fn supports_compression(self) -> bool {
        matches!(
            self,
            Self::G4tx
                | Self::G4md
                | Self::G4mg
                | Self::G4pk
                | Self::G4ra
                | Self::Agi
                | Self::Objb
                | Self::CfgBin
                | Self::Mevs
                | Self::Cpk
                | Self::Png
                | Self::Xpck
                | Self::Xfsa
                | Self::CriLayla
        )
    }

    /// Retourne le descripteur complet associé à ce format.
    #[must_use]
    pub const fn descriptor(self) -> FormatDescriptor {
        match self {
            Self::G4tx => FormatDescriptor {
                id: 1,
                name: "G4TX",
                magic_hex: "0x58543447",
                magic_ascii: "G4TX",
                extension: ".g4tx",
                mime_type: "image/x-level5-g4tx",
                category: "texture",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 Texture Container (DDS BCn textures + atlas sprite subregions)",
            },
            Self::G4md => FormatDescriptor {
                id: 2,
                name: "G4MD",
                magic_hex: "0x444D3447",
                magic_ascii: "G4MD",
                extension: ".g4md",
                mime_type: "model/x-level5-g4md",
                category: "model",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 3D Model Data (meshes, bone indices, vertex buffers, materials)",
            },
            Self::G4mg => FormatDescriptor {
                id: 3,
                name: "G4MG",
                magic_hex: "0x474D3447",
                magic_ascii: "G4MG",
                extension: ".g4mg",
                mime_type: "model/x-level5-g4mg",
                category: "model",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 Model Group (collection of submeshes and LOD levels)",
            },
            Self::G4mt => FormatDescriptor {
                id: 4,
                name: "G4MT",
                magic_hex: "0x544D3447",
                magic_ascii: "G4MT",
                extension: ".g4mt",
                mime_type: "model/x-level5-g4mt",
                category: "model",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Level-5 Material Properties (shaders, blend modes, diffuse/specular colors)",
            },
            Self::G4sk => FormatDescriptor {
                id: 5,
                name: "G4SK",
                magic_hex: "0x4B533447",
                magic_ascii: "G4SK",
                extension: ".g4sk",
                mime_type: "model/x-level5-g4sk",
                category: "model",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Level-5 Skeleton & Bone Hierarchy (quaternions, bind poses, transform trees)",
            },
            Self::G4pk => FormatDescriptor {
                id: 6,
                name: "G4PK",
                magic_hex: "0x4B503447",
                magic_ascii: "G4PK",
                extension: ".g4pk",
                mime_type: "application/x-level5-g4pk",
                category: "container",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 Package Container (multi-resource bundle for characters and animations)",
            },
            Self::G4ra => FormatDescriptor {
                id: 7,
                name: "G4RA",
                magic_hex: "0x41523447",
                magic_ascii: "G4RA",
                extension: ".g4ra",
                mime_type: "application/x-level5-g4ra",
                category: "container",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 Resource Archive (compact asset bundle indexed in nie.exe)",
            },
            Self::Agi => FormatDescriptor {
                id: 8,
                name: "AGI",
                magic_hex: "0x20494741",
                magic_ascii: "AGI ",
                extension: ".agi",
                mime_type: "application/x-level5-agi",
                category: "model",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 Animation Graphic Interface (timeline tracks, animation nodes)",
            },
            Self::Objb => FormatDescriptor {
                id: 9,
                name: "OBJB",
                magic_hex: "0x424A424F",
                magic_ascii: "OBJB",
                extension: ".objb",
                mime_type: "application/x-level5-objb",
                category: "config",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 Object Binary (scene layout descriptors, actor placements)",
            },
            Self::Col => FormatDescriptor {
                id: 10,
                name: "PXCL",
                magic_hex: "0x4C435850",
                magic_ascii: "PXCL",
                extension: ".pxcl",
                mime_type: "application/x-level5-pxcl",
                category: "collision",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Level-5 Pixel Collision & Physics Hull (hitboxes, boundary colliders)",
            },
            Self::CfgBin => FormatDescriptor {
                id: 11,
                name: "RDBN",
                magic_hex: "0x4E424452",
                magic_ascii: "RDBN",
                extension: ".cfg.bin",
                mime_type: "application/x-level5-rdbn",
                category: "config",
                is_big_endian: false,
                encryption_supported: true,
                compression_supported: true,
                description: "Level-5 Relational Database Binary (T2B structured binary data sheets)",
            },
            Self::Mevs => FormatDescriptor {
                id: 12,
                name: "MEVS",
                magic_hex: "0x5346454D",
                magic_ascii: "MEVS",
                extension: ".mevbin",
                mime_type: "application/x-level5-mevs",
                category: "script",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 Motion Event Script (choreographed cutscenes, camera paths, audio cues)",
            },
            Self::G4cm => FormatDescriptor {
                id: 13,
                name: "G4CM",
                magic_hex: "0x4D433447",
                magic_ascii: "G4CM",
                extension: ".g4cm",
                mime_type: "application/x-level5-g4cm",
                category: "script",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Level-5 Camera Track & Spline Path (cinematic parameters, FOV transitions)",
            },
            Self::Cpk => FormatDescriptor {
                id: 14,
                name: "CPK",
                magic_hex: "0x204B5043",
                magic_ascii: "CPK ",
                extension: ".cpk",
                mime_type: "application/x-crifs-cpk",
                category: "container",
                is_big_endian: true,
                encryption_supported: true,
                compression_supported: true,
                description: "CRI Middleware File Package (TOC, ITOC, ETOC, @UTF directory descriptors)",
            },
            Self::Awb => FormatDescriptor {
                id: 15,
                name: "AFS2",
                magic_hex: "0x32534641",
                magic_ascii: "AFS2",
                extension: ".afs2",
                mime_type: "audio/x-cri-afs2",
                category: "audio",
                is_big_endian: false,
                encryption_supported: true,
                compression_supported: false,
                description: "Criware Audio Archive (AWB wavebank containers)",
            },
            Self::Utf => FormatDescriptor {
                id: 16,
                name: "@UTF",
                magic_hex: "0x00465455",
                magic_ascii: "@UTF",
                extension: ".utf",
                mime_type: "application/x-cri-utf",
                category: "container",
                is_big_endian: true,
                encryption_supported: true,
                compression_supported: false,
                description: "CRI Universal Table Format (schema, column flags, string pools, row vectors)",
            },
            Self::Dds => FormatDescriptor {
                id: 17,
                name: "DDS",
                magic_hex: "0x20534444",
                magic_ascii: "DDS ",
                extension: ".dds",
                mime_type: "image/vnd-ms.dds",
                category: "texture",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "DirectDraw Surface (raw BC1/BC2/BC3/BC4/BC5/BC7 compressed texture payload)",
            },
            Self::Png => FormatDescriptor {
                id: 18,
                name: "PNG",
                magic_hex: "0x474E5089",
                magic_ascii: "PNG\r",
                extension: ".png",
                mime_type: "image/png",
                category: "texture",
                is_big_endian: true,
                encryption_supported: false,
                compression_supported: true,
                description: "Portable Network Graphics (decoded atlas glyphs, UI elements, web exports)",
            },
            Self::Riff => FormatDescriptor {
                id: 19,
                name: "RIFF",
                magic_hex: "0x46464952",
                magic_ascii: "RIFF",
                extension: ".wav",
                mime_type: "audio/wav",
                category: "audio",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Resource Interchange File Format (PCM and ADPCM audio tracks)",
            },
            Self::Xpck => FormatDescriptor {
                id: 20,
                name: "XPCK",
                magic_hex: "0x4B533447",
                magic_ascii: "XPCK",
                extension: ".xpck",
                mime_type: "application/x-level5-xpck",
                category: "container",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 XPCK Package (legacy DS/3DS/Switch container format)",
            },
            Self::Xfsa => FormatDescriptor {
                id: 21,
                name: "XFSA",
                magic_hex: "0x41534658",
                magic_ascii: "XFSA",
                extension: ".xfsa",
                mime_type: "application/x-level5-xfsa",
                category: "container",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "Level-5 XFSA Archive (file system archive with hash-addressed records)",
            },
            Self::CriLayla => FormatDescriptor {
                id: 22,
                name: "CRILAYLA",
                magic_hex: "0x4159414C",
                magic_ascii: "LAYL",
                extension: ".crilayla",
                mime_type: "application/x-cri-layla",
                category: "container",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: true,
                description: "CRI Layla Reverse-Bitstream LZSS Compressed Container (16-byte header)",
            },
            Self::Acb => FormatDescriptor {
                id: 23,
                name: "@ACB",
                magic_hex: "0x46424341",
                magic_ascii: "@ACB",
                extension: ".acb",
                mime_type: "audio/x-cri-acb",
                category: "audio",
                is_big_endian: true,
                encryption_supported: true,
                compression_supported: false,
                description: "Criware Audio Cue Sheet (cue mappings, sound triggers, DSP effects)",
            },
            Self::Usm => FormatDescriptor {
                id: 24,
                name: "USM",
                magic_hex: "0x20534D43",
                magic_ascii: "CRID",
                extension: ".usm",
                mime_type: "video/x-cri-usm",
                category: "video",
                is_big_endian: true,
                encryption_supported: true,
                compression_supported: false,
                description: "CRI Movie 2 Container (video stream, multi-track audio, subtitle packets)",
            },
            Self::G4nv => FormatDescriptor {
                id: 25,
                name: "NAVM",
                magic_hex: "0x4D56414E",
                magic_ascii: "NAVM",
                extension: ".g4nv",
                mime_type: "application/x-level5-g4nv",
                category: "system",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Level-5 Navigation Mesh (stadium and field locomotion polygons)",
            },
            Self::ColMesh => FormatDescriptor {
                id: 26,
                name: "COL",
                magic_hex: "0x004C4F43",
                magic_ascii: "COL\0",
                extension: ".col",
                mime_type: "application/x-level5-col",
                category: "collision",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Level-5 Collision mesh data",
            },
            Self::Cols => FormatDescriptor {
                id: 27,
                name: "COLS",
                magic_hex: "0x534C4F43",
                magic_ascii: "COLS",
                extension: ".cols",
                mime_type: "application/x-level5-cols",
                category: "collision",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Level-5 Collision Set (stadium boundaries, goal posts, ball bouncing volumes)",
            },
            Self::Live => FormatDescriptor {
                id: 28,
                name: "LIVE",
                magic_hex: "0x9DCE66C3",
                magic_ascii: "LIVE",
                extension: ".live",
                mime_type: "application/x-level5-live",
                category: "system",
                is_big_endian: false,
                encryption_supported: true,
                compression_supported: false,
                description: "Level-5 Lives Save Container (CRC32-keyed XOR cipher, 0xEEFF blobs)",
            },
            Self::Hca => FormatDescriptor {
                id: 29,
                name: "HCA",
                magic_hex: "0x00414348",
                magic_ascii: "HCA\0",
                extension: ".hca",
                mime_type: "audio/x-cri-hca",
                category: "audio",
                is_big_endian: false,
                encryption_supported: true,
                compression_supported: false,
                description: "CRI High Compression Audio",
            },
            Self::Lip => FormatDescriptor {
                id: 30,
                name: "LIP",
                magic_hex: "0x0070696C",
                magic_ascii: "lip\0",
                extension: ".p3lip",
                mime_type: "application/x-level5-lip",
                category: "system",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Level-5 Lip Sync Animation",
            },
            Self::Dxbc => FormatDescriptor {
                id: 31,
                name: "DXBC",
                magic_hex: "0x43425844",
                magic_ascii: "DXBC",
                extension: ".vfxo",
                mime_type: "application/x-ms-dxbc",
                category: "system",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "DirectX Compiled Shader Bytecode",
            },
            Self::Unknown => FormatDescriptor {
                id: 0,
                name: "?",
                magic_hex: "0x00000000",
                magic_ascii: "NONE",
                extension: ".bin",
                mime_type: "application/octet-stream",
                category: "system",
                is_big_endian: false,
                encryption_supported: false,
                compression_supported: false,
                description: "Unknown or unparsed binary format",
            },
        }
    }

    /// Liste de tous les 28 formats canoniques VFS reconnus.
    #[must_use]
    pub const fn all() -> &'static [Self] {
        &[
            Self::G4tx,
            Self::G4md,
            Self::G4mg,
            Self::G4mt,
            Self::G4sk,
            Self::G4pk,
            Self::G4ra,
            Self::Agi,
            Self::Objb,
            Self::Col,
            Self::CfgBin,
            Self::Mevs,
            Self::G4cm,
            Self::Cpk,
            Self::Awb,
            Self::Utf,
            Self::Dds,
            Self::Png,
            Self::Riff,
            Self::Xpck,
            Self::Xfsa,
            Self::CriLayla,
            Self::Acb,
            Self::Usm,
            Self::G4nv,
            Self::ColMesh,
            Self::Cols,
            Self::Live,
            Self::Hca,
            Self::Lip,
            Self::Dxbc,
        ]
    }
}

/// Détecte le format d'un tampon par ses octets de tête.
#[must_use]
pub fn detect(bytes: &[u8]) -> FileFormat {
    const fn starts(b: &[u8], m: &[u8]) -> bool {
        if b.len() < m.len() {
            return false;
        }
        let mut i = 0;
        while i < m.len() {
            if b[i] != m[i] {
                return false;
            }
            i += 1;
        }
        true
    }

    if starts(bytes, b"CRILAYLA") {
        FileFormat::CriLayla
    } else if starts(bytes, b"CPK ") {
        FileFormat::Cpk
    } else if starts(bytes, b"@UTF") {
        FileFormat::Utf
    } else if starts(bytes, b"AFS2") {
        FileFormat::Awb
    } else if starts(bytes, b"CRID") {
        FileFormat::Usm
    } else if starts(bytes, b"@ACB") {
        FileFormat::Acb
    } else if starts(bytes, b"@HCA") || starts(bytes, b"HCA\0") {
        FileFormat::Hca
    } else if starts(bytes, b"G4MG") {
        FileFormat::G4mg
    } else if starts(bytes, b"G4MD") {
        FileFormat::G4md
    } else if starts(bytes, b"G4TX") {
        FileFormat::G4tx
    } else if starts(bytes, b"G4MT") {
        FileFormat::G4mt
    } else if starts(bytes, b"G4SK") {
        FileFormat::G4sk
    } else if starts(bytes, b"G4PK") {
        FileFormat::G4pk
    } else if starts(bytes, b"G4RA") {
        FileFormat::G4ra
    } else if starts(bytes, b"G4CM") {
        FileFormat::G4cm
    } else if starts(bytes, b"AGI ") {
        FileFormat::Agi
    } else if starts(bytes, b"OBJB") {
        FileFormat::Objb
    } else if starts(bytes, b"MEVS") {
        FileFormat::Mevs
    } else if starts(bytes, b"NAVM") {
        FileFormat::G4nv
    } else if starts(bytes, b"lip\0") {
        FileFormat::Lip
    } else if starts(bytes, b"DXBC") {
        FileFormat::Dxbc
    } else if starts(bytes, b"PXCL") {
        FileFormat::Col
    } else if starts(bytes, b"COLS") {
        FileFormat::Cols
    } else if starts(bytes, b"COL\0") {
        FileFormat::ColMesh
    } else if starts(bytes, b"DDS ") {
        FileFormat::Dds
    } else if bytes.len() >= 8 && bytes[..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        FileFormat::Png
    } else if starts(bytes, b"RIFF") {
        FileFormat::Riff
    } else if starts(bytes, b"XPCK") {
        FileFormat::Xpck
    } else if starts(bytes, b"XFSA") {
        FileFormat::Xfsa
    } else if starts(bytes, b"RDBN") || cfgbin::is_t2b(bytes) {
        FileFormat::CfgBin
    } else if bytes.len() >= 4
        && u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) == 0x9DCE_66C3
    {
        FileFormat::Live
    } else {
        FileFormat::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_known_magics() {
        assert_eq!(detect(b"CRILAYLA\x00\x00"), FileFormat::CriLayla);
        assert_eq!(detect(b"CPK \x00\x00"), FileFormat::Cpk);
        assert_eq!(detect(b"@UTF\x00"), FileFormat::Utf);
        assert_eq!(detect(b"G4MG....."), FileFormat::G4mg);
        assert_eq!(detect(b"AFS2...."), FileFormat::Awb);
        assert_eq!(detect(b"RDBN...."), FileFormat::CfgBin);
        assert_eq!(detect(b"random"), FileFormat::Unknown);
        assert_eq!(detect(b""), FileFormat::Unknown);
    }

    /// Le magic réel des navmesh Level-5 (.g4nv) est `NAVM`, pas `G4NV`.
    /// Vérifié par dump hexadécimal de 159 vrais fichiers IEVR.
    #[test]
    fn g4nv_magic_is_navm_not_g4nv() {
        // Magic réel observé sur fichiers .g4nv du jeu (ex: k03.g4nv: 4E 41 56 4D ...)
        let navm_header = b"NAVM\x60\x00\x66\x00\x00\x00\x18\x00";
        assert_eq!(
            detect(navm_header),
            FileFormat::G4nv,
            "detect() doit retourner G4nv pour un magic NAVM"
        );
        // L'ancien magic erroné G4NV ne doit PAS être reconnu comme G4nv
        let wrong_magic = b"G4NV....";
        assert_eq!(
            detect(wrong_magic),
            FileFormat::Unknown,
            "detect() ne doit PAS reconnaître G4NV (absent des assets IEVR)"
        );
    }

    /// Test golden gated sur NIE_GAME_DIR : lit le plus petit .g4nv via VFS
    /// et vérifie que detect() retourne FileFormat::G4nv (magic NAVM).
    #[test]
    fn g4nv_detect_golden_via_vfs() {
        let dir = crate::vfs::resolve_game_dir().to_string_lossy().into_owned();
        let data = std::path::Path::new(&dir).join("data");
        if !crate::vfs::donnees_disponibles(&data) {
            eprintln!("skip g4nv_detect_golden_via_vfs : NIE_GAME_DIR absent");
            return;
        }

        let mut vfs = crate::vfs::Vfs::new();
        vfs.init(&data).expect("Vfs::init");

        // Sélectionne le plus petit .g4nv pour minimiser l'I/O
        let smallest = vfs
            .iter()
            .filter(|(p, e)| p.ends_with(".g4nv") && e.file_size > 0)
            .min_by_key(|(_, e)| e.file_size)
            .map(|(p, _)| p.to_string());

        let path = match smallest {
            Some(p) => p,
            None => {
                eprintln!("skip g4nv_detect_golden_via_vfs : aucun .g4nv dans l'index VFS");
                return;
            },
        };

        let bytes = vfs.read(&path).unwrap_or_else(|e| panic!("vfs.read({path}): {e}"));
        assert!(bytes.len() >= 4, "fichier .g4nv trop court ({} octets) : {path}", bytes.len());

        let fmt = detect(&bytes);
        assert_eq!(
            fmt,
            FileFormat::G4nv,
            "detect() a retourné {:?} au lieu de G4nv pour {path} (magic réel: {:?})",
            fmt,
            &bytes[..bytes.len().min(4)]
        );

        // Vérifie que les 4 premiers octets sont bien NAVM
        assert_eq!(&bytes[..4], b"NAVM", "magic inattendu dans {path}: {:?}", &bytes[..4]);

        eprintln!("OK: detect({path}) == G4nv (magic NAVM, {} octets)", bytes.len());
    }
}
