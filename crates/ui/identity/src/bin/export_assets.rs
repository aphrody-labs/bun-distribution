// SPDX-License-Identifier: Apache-2.0
//! Produit les assets de marque d'Aphrody : favicons, `.ico`, SVG, manifeste web.
//!
//! Tout est tiré de l'atlas embarqué — aucune image dessinée à côté, donc rien qui puisse se
//! périmer sans qu'on le voie.
//!
//! # Usage
//! ```text
//! cargo run -p aphrody-identity --bin export_assets -- --out var/exports/aphrody
//! cargo run -p aphrody-identity --bin export_assets -- --animation waving --frame 2
//! cargo run -p aphrody-identity --bin export_assets -- --tauri --out crates/aphrody-app/icons
//! ```

use aphrody_identity::{Pet, assets::TAILLES_FAVICON};
use std::{fs, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
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
            return ExitCode::FAILURE;
        },
    };

    let Some(anim) = pet.animation(&animation) else {
        eprintln!(
            "animation « {animation} » inconnue. Disponibles : {}",
            pet.manifest.animations.keys().cloned().collect::<Vec<_>>().join(", ")
        );
        return ExitCode::FAILURE;
    };
    let Some(frame) = anim.frames.get(index) else {
        eprintln!("frame {index} hors de « {animation} » ({} frames)", anim.frames.len());
        return ExitCode::FAILURE;
    };

    // `--tauri`: the application bundle icon set instead of the web favicons.
    let tauri = args.iter().any(|a| a == "--tauri");
    let produits =
        if tauri { pet.tauri_icons(frame) } else { pet.brand_assets(frame, TAILLES_FAVICON) };
    let fichiers = match produits {
        Ok(f) => f,
        Err(e) => {
            eprintln!("production des assets : {e}");
            return ExitCode::FAILURE;
        },
    };

    if let Err(e) = fs::create_dir_all(&sortie) {
        eprintln!("création de {} : {e}", sortie.display());
        return ExitCode::FAILURE;
    }
    let mut total = 0usize;
    for f in &fichiers {
        let chemin = sortie.join(&f.nom);
        if let Err(e) = fs::write(&chemin, &f.octets) {
            eprintln!("écriture de {} : {e}", chemin.display());
            return ExitCode::FAILURE;
        }
        total += f.octets.len();
        println!("{:>9} o  {}", f.octets.len(), chemin.display());
    }
    println!("\n{} fichiers, {total} o, depuis {animation}[{index}]", fichiers.len());
    ExitCode::SUCCESS
}
