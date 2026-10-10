// SPDX-License-Identifier: Apache-2.0
//! `aphrody identity pet` — installer le pet dans Codex, vérifier un paquet, produire les données
//! du runtime web.

use crate::codex::{self, Artefact, Version};
use crate::{BUNDLED_ATLAS_WEBP, Pet, web};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

const AIDE: &str = "\
pet — le pet Aphrody hors de la crate

  pet codex [--codex-home DIR] [--v2] [--sortie DIR] [--json]
        installe le pet dans $CODEX_HOME/pets/aphrody (défaut ~/.codex) : artefact v1
        1536x1872 accepté par le TUI et l'app ; --v2 : atlas complet 1536x2288 (app seulement) ;
        --sortie : écrit l'artefact dans DIR sans installer
  pet verifier <DOSSIER> [--id ID]
        rejoue sur un paquet installé les contrôles du TUI Codex et de l'installeur de la galerie
  pet web [-o FICHIER]
        données du runtime web (<aphrody-pet>), comme assets/aphrody/web.json

Sélection dans Codex : [tui] pet = \"aphrody\" dans config.toml, ou /pets.
";

/// Entry point of `aphrody identity pet`. `args[0]` is the program name. Returns the exit code.
pub fn pet_main(args: Vec<OsString>) -> i32 {
    let args: Vec<String> = args.iter().skip(1).map(|a| a.to_string_lossy().into_owned()).collect();
    match executer(args) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("pet: {e}");
            1
        },
    }
}

fn valeur(args: &mut Vec<String>, nom: &str) -> Result<Option<String>, String> {
    let Some(i) = args.iter().position(|a| a == nom) else {
        return Ok(None);
    };
    if i + 1 >= args.len() {
        return Err(format!("{nom} attend une valeur"));
    }
    let v = args.remove(i + 1);
    args.remove(i);
    Ok(Some(v))
}

fn drapeau(args: &mut Vec<String>, nom: &str) -> bool {
    args.iter().position(|a| a == nom).is_some_and(|i| {
        args.remove(i);
        true
    })
}

fn executer(mut args: Vec<String>) -> Result<(), String> {
    if args.is_empty() || drapeau(&mut args, "--help") || drapeau(&mut args, "-h") {
        print!("{AIDE}");
        return Ok(());
    }
    let commande = args.remove(0);
    match commande.as_str() {
        "codex" => installer(args),
        "verifier" => verifier(args),
        "web" => {
            let sortie = valeur(&mut args, "-o")?;
            let json = web::web_json_embarque().map_err(|e| e.to_string())?;
            match sortie {
                Some(f) => std::fs::write(&f, json).map_err(|e| format!("{f} : {e}")),
                None => {
                    print!("{json}");
                    Ok(())
                },
            }
        },
        autre => Err(format!("commande inconnue « {autre} »\n\n{AIDE}")),
    }
}

fn installer(mut args: Vec<String>) -> Result<(), String> {
    let home = valeur(&mut args, "--codex-home")?.map(PathBuf::from);
    let sortie = valeur(&mut args, "--sortie")?.map(PathBuf::from);
    let v2 = drapeau(&mut args, "--v2");
    let json = drapeau(&mut args, "--json");
    if let Some(reste) = args.first() {
        return Err(format!("argument inattendu « {reste} »"));
    }
    let pet = Pet::bundled().map_err(|e| e.to_string())?;
    let artefact: Artefact =
        if v2 { codex::artefact_v2(&pet, BUNDLED_ATLAS_WEBP) } else { codex::artefact_v1(&pet) }
            .map_err(|e| e.to_string())?;

    let dossier = if let Some(dir) = sortie {
        std::fs::create_dir_all(&dir).map_err(|e| format!("{} : {e}", dir.display()))?;
        for (nom, octets) in codex::FICHIERS.iter().zip([&artefact.pet_json, &artefact.atlas]) {
            std::fs::write(dir.join(nom), octets).map_err(|e| format!("{nom} : {e}"))?;
        }
        dir
    } else {
        let home = home.or_else(codex::codex_home).ok_or("CODEX_HOME introuvable (ni HOME)")?;
        codex::installer(&home, &artefact).map_err(|e| e.to_string())?
    };

    let entree = artefact.entree(&pet.pet.display_name);
    if json {
        let j = serde_json::json!({ "dossier": dossier, "entree": entree });
        println!("{j:#}");
    } else {
        let gabarit = match artefact.version {
            Version::V1 => "v1 1536x1872 (TUI + app)",
            Version::V2 => "v2 1536x2288 (app Codex)",
        };
        println!("{} : {gabarit}, atlas {} octets", dossier.display(), entree.spritesheet_bytes);
        println!("config.toml : [tui] pet = \"{}\"", artefact.id);
    }
    Ok(())
}

fn verifier(mut args: Vec<String>) -> Result<(), String> {
    let id = valeur(&mut args, "--id")?;
    let dossier = args.first().map(PathBuf::from).ok_or("pet verifier <DOSSIER>")?;
    let id = id
        .or_else(|| dossier.file_name().map(|n| n.to_string_lossy().into_owned()))
        .ok_or("identifiant indéterminable : passer --id")?;
    let lire = |p: &Path| std::fs::read(p).map_err(|e| format!("{} : {e}", p.display()));
    let json = lire(&dossier.join(codex::FICHIERS[0]))?;
    let atlas = lire(&dossier.join(codex::FICHIERS[1]))?;
    let version = codex::valider_galerie(&json, &atlas, &id).map_err(|e| e.to_string())?;
    println!("installeur de la galerie : ok ({version:?})");
    match codex::valider_tui(&json, &atlas, &id) {
        Ok(p) => println!(
            "TUI Codex : ok ({} pistes, grille {}x{})",
            p.pistes.len(),
            p.grille.columns,
            p.grille.rows
        ),
        Err(e) if version == Version::V2 => {
            println!("TUI Codex : refusé, attendu pour une v2 ({e})")
        },
        Err(e) => return Err(format!("TUI Codex : {e}")),
    }
    Ok(())
}
