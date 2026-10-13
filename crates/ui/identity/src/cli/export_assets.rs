// SPDX-License-Identifier: Apache-2.0
//! Produit les assets de marque d'Aphrody depuis le logo : `.ico`, PNG, maskable, apple-touch-icon,
//! SVG vectoriel, wordmark, manifeste web, CSS du logo et des polices, jetons M3 (CSS, JSON).
//!
//! # Usage
//! ```text
//! aphrody identity export-assets --out crates/ui/identity/assets/brand \
//!     --source crates/ui/identity/assets/logo/source/byron_r0.png \
//!     --webp crates/ui/identity/assets/logo/aphrody.webp
//! aphrody identity export-assets --tauri --out crates/ui/app/icons
//! aphrody identity export-assets --pet --animation waving --frame 2 --out var/exports/aphrody
//! ```
//!
//! Sans `--source`, le portrait embarqué (`assets/logo/aphrody.webp`) sert de source. Les polices
//! (`--wordmark-font`, `--fonts-css`) sont lues depuis le monorepo ; absentes, le wordmark et
//! `aphrody-fonts.css` ne sont pas produits.

use crate::{
    Pet,
    assets::{Fichier, TAILLES_FAVICON},
    logo::{self, CDN, Polices},
};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

const WORDMARK_FONT: &str = "crates/m3-tokens/fonts/google-sans-flex/GoogleSansFlex-Variable.ttf";
const FONTS_CSS: &str = "packages/m3-fonts/src/fonts.css";

fn material_path(path: &str) -> PathBuf {
    let checkout = std::env::var_os("APHRODY_MATERIAL_CHECKOUT")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
                .ancestors()
                .nth(3)
                .expect("identity crate is three directories below its workspace root");
            workspace.parent().expect("Aphrody workspace parent").join("material")
        });
    checkout.join(path)
}

/// Entry point of the former `export_assets` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn export_assets_main(args: Vec<OsString>) -> i32 {
    match executer(&args.iter().map(|a| a.to_string_lossy().into_owned()).collect::<Vec<_>>()) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            1
        },
    }
}

fn executer(args: &[String]) -> Result<(), String> {
    let lire = |nom: &str| -> Option<String> {
        args.iter().position(|a| a == nom).and_then(|i| args.get(i + 1)).cloned()
    };
    let drapeau = |nom: &str| args.iter().any(|a| a == nom);
    let sortie = PathBuf::from(lire("--out").unwrap_or_else(|| "var/aphrody-assets".into()));

    if drapeau("--pet") {
        let animation = lire("--animation").unwrap_or_else(|| "idle".into());
        let index: usize = lire("--frame").and_then(|f| f.parse().ok()).unwrap_or(0);
        let pet = Pet::bundled().map_err(|e| format!("paquet Aphrody illisible : {e}"))?;
        let anim = pet.animation(&animation).ok_or_else(|| {
            format!(
                "animation « {animation} » inconnue. Disponibles : {}",
                pet.manifest.animations.keys().cloned().collect::<Vec<_>>().join(", ")
            )
        })?;
        let frame = anim.frames.get(index).ok_or_else(|| {
            format!("frame {index} hors de « {animation} » ({} frames)", anim.frames.len())
        })?;
        let fichiers = pet
            .brand_assets(frame, TAILLES_FAVICON)
            .map_err(|e| format!("production des assets : {e}"))?;
        return ecrire(&sortie, &fichiers);
    }

    let portrait = match lire("--source") {
        Some(chemin) => image::open(&chemin).map_err(|e| format!("{chemin} : {e}"))?.to_rgba8(),
        None => logo::portrait().map_err(|e| e.to_string())?,
    };
    if let Some(webp) = lire("--webp") {
        let octets = logo::webp_sans_perte(&portrait).map_err(|e| e.to_string())?;
        fs::write(&webp, &octets).map_err(|e| format!("écriture de {webp} : {e}"))?;
        println!("{:>9} o  {webp}", octets.len());
    }

    if drapeau("--tauri") {
        let fichiers = logo::icones_tauri(&portrait).map_err(|e| e.to_string())?;
        return ecrire(&sortie, &fichiers);
    }

    let lire_fichier =
        |chemin: &Path| fs::read(chemin).map_err(|e| format!("{} : {e}", chemin.display()));
    let wordmark =
        lire("--wordmark-font").map_or_else(|| material_path(WORDMARK_FONT), PathBuf::from);
    let css_m3 = lire("--fonts-css").map_or_else(|| material_path(FONTS_CSS), PathBuf::from);
    let polices = if wordmark.is_file() && css_m3.is_file() {
        let css = fs::read_to_string(&css_m3).map_err(|e| format!("{} : {e}", css_m3.display()))?;
        let (_, url) = logo::font_face(&css, "Google Sans Flex")
            .ok_or_else(|| format!("{} : pas de @font-face Google Sans Flex", css_m3.display()))?;
        let woff2 = css_m3.parent().unwrap_or(Path::new(".")).join(&url);
        Some((lire_fichier(&wordmark)?, css, lire_fichier(&woff2)?))
    } else {
        eprintln!(
            "polices absentes ({} ou {}) : ni wordmark ni aphrody-fonts.css",
            wordmark.display(),
            css_m3.display()
        );
        None
    };
    let cdn = lire("--cdn").unwrap_or_else(|| CDN.into());
    let marque = logo::marque(
        &portrait,
        polices.as_ref().map(|(w, c, f)| Polices { wordmark: w, css_m3: c, woff2: f }),
        &cdn,
    )
    .map_err(|e| e.to_string())?;
    ecrire(&sortie, &marque.fichiers)?;

    let c = &marque.cadrage;
    println!(
        "cadre large {}px en ({}, {}), serré {}px en ({}, {}) ; visage {}..{} x {}..{}",
        c.large.cote,
        c.large.x,
        c.large.y,
        c.serre.cote,
        c.serre.x,
        c.serre.y,
        c.visage.x0,
        c.visage.x1,
        c.visage.y0,
        c.visage.y1
    );
    let palette: Vec<String> =
        marque.theme.palette.iter().map(|p| format!("{} {:.1} %", p.hex, p.part_pct)).collect();
    println!("palette : {}", palette.join(", "));
    println!("graine M3 : {}", marque.theme.export.seed);
    println!(
        "icon.svg : {} o, SSIM {:.4}, {:.1} % des pixels à ±16 ({} px, {} couches)",
        marque.svg.octets,
        marque.svg.ssim,
        marque.svg.pixels_proches_pct,
        marque.svg.resolution,
        marque.svg.couches
    );
    Ok(())
}

fn ecrire(sortie: &Path, fichiers: &[Fichier]) -> Result<(), String> {
    fs::create_dir_all(sortie).map_err(|e| format!("création de {} : {e}", sortie.display()))?;
    let mut total = 0usize;
    for f in fichiers {
        let chemin = sortie.join(&f.nom);
        fs::write(&chemin, &f.octets)
            .map_err(|e| format!("écriture de {} : {e}", chemin.display()))?;
        total += f.octets.len();
        println!("{:>9} o  {}", f.octets.len(), chemin.display());
    }
    println!("{} fichiers, {total} o", fichiers.len());
    Ok(())
}
