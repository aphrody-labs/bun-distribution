// SPDX-License-Identifier: Apache-2.0
//! Produit les assets de marque d'Aphrody : favicons, `.ico`, SVG, manifeste web.
//!
//! Tout est tiré de l'atlas embarqué — aucune image dessinée à côté, donc rien qui puisse se
//! périmer sans qu'on le voie.
//!
//! # Usage
//! ```text
//! aphrody identity export-assets --out var/exports/aphrody
//! aphrody identity export-assets --animation waving --frame 2
//! aphrody identity export-assets --tauri --out crates/aphrody-app/icons
//! ```

use crate::{Pet, assets::TAILLES_FAVICON};
use std::{ffi::OsString, fs, path::PathBuf};

/// Entry point of the former `export_assets` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn export_assets_main(args: Vec<OsString>) -> i32 {
    let args: Vec<String> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
    let lire = |nom: &str, defaut: &str| -> String {
        args.iter()
            .position(|a| a == nom)
            .and_then(|i| args.get(i + 1))
            .cloned()
            .unwrap_or_else(|| defaut.to_string())
    };

    let sortie = PathBuf::from(lire("--out", "var/aphrody-assets"));
    let animation = lire("--animation", "idle");
    let index: usize = lire("--frame", "0").parse().unwrap_or(0);

    let pet = match Pet::bundled() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("paquet Aphrody illisible : {e}");
            return 1;
        },
    };

    let Some(anim) = pet.animation(&animation) else {
        eprintln!(
            "animation « {animation} » inconnue. Disponibles : {}",
            pet.manifest.animations.keys().cloned().collect::<Vec<_>>().join(", ")
        );
        return 1;
    };
    let Some(frame) = anim.frames.get(index) else {
        eprintln!("frame {index} hors de « {animation} » ({} frames)", anim.frames.len());
        return 1;
    };

    // `--tauri`: the application bundle icon set instead of the web favicons.
    let tauri = args.iter().any(|a| a == "--tauri");
    let produits =
        if tauri { pet.tauri_icons(frame) } else { pet.brand_assets(frame, TAILLES_FAVICON) };
    let fichiers = match produits {
        Ok(f) => f,
        Err(e) => {
            eprintln!("production des assets : {e}");
            return 1;
        },
    };

    if let Err(e) = fs::create_dir_all(&sortie) {
        eprintln!("création de {} : {e}", sortie.display());
        return 1;
    }
    let mut total = 0usize;
    for f in &fichiers {
        let chemin = sortie.join(&f.nom);
        if let Err(e) = fs::write(&chemin, &f.octets) {
            eprintln!("écriture de {} : {e}", chemin.display());
            return 1;
        }
        total += f.octets.len();
        println!("{:>9} o  {}", f.octets.len(), chemin.display());
    }
    println!("\n{} fichiers, {total} o, depuis {animation}[{index}]", fichiers.len());
    0
}
