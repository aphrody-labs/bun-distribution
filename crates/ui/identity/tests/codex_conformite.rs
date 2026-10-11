// SPDX-License-Identifier: Apache-2.0
//! Aphrody est-il installable comme un Codex pet ?
//!
//! Le paquet suit la spécification publique des Codex pets (galerie
//! `legeling/awesome-codex-pet`, code MIT). Ces tests le vérifient plutôt que de l'affirmer :
//! une spécification tierce peut évoluer, et le jour où notre atlas ne correspondra plus, il
//! vaut mieux l'apprendre ici qu'au moment où quelqu'un tente d'installer le pet.

use aphrody_identity::{
    BUNDLED_ATLAS_WEBP, BUNDLED_PET_JSON, Pet,
    codex::{Version, conformite, entree_installation},
};

#[test]
fn le_paquet_embarque_est_un_codex_pet_v2_conforme() {
    let pet = Pet::bundled().expect("paquet");
    let c = conformite(&pet.pet, &pet.manifest);
    assert!(c.ok(), "écarts : {:?}", c.ecarts);
    assert_eq!(c.version, Some(Version::V2));
}

#[test]
fn l_entree_d_installation_decrit_les_octets_reellement_embarques() {
    let pet = Pet::bundled().expect("paquet");
    let e = entree_installation(
        &pet.pet,
        &pet.manifest,
        BUNDLED_PET_JSON.as_bytes(),
        BUNDLED_ATLAS_WEBP,
    )
    .expect("paquet conforme");

    assert_eq!(e.sprite_version_number, 2);
    // Les dimensions de la v2, telles que la spécification les fixe.
    assert_eq!((e.spritesheet_width, e.spritesheet_height), (1536, 2288));
    assert_eq!(e.pet_json_bytes, BUNDLED_PET_JSON.len());
    assert_eq!(e.spritesheet_bytes, BUNDLED_ATLAS_WEBP.len());
    assert_eq!(e.pet_json_sha256.len(), 64);

    // L'entrée doit se sérialiser sous les noms que l'installeur lit — un champ renommé de
    // travers produirait un manifeste syntaxiquement valide et fonctionnellement mort.
    let j = serde_json::to_value(&e).expect("sérialisable");
    for champ in [
        "name",
        "spriteVersionNumber",
        "petJsonSha256",
        "petJsonBytes",
        "spritesheetSha256",
        "spritesheetBytes",
        "spritesheetWidth",
        "spritesheetHeight",
    ] {
        assert!(j.get(champ).is_some(), "champ absent du manifeste : {champ}");
    }
}

#[test]
fn un_atlas_hors_specification_est_refuse_avec_sa_raison() {
    let mut pet = Pet::bundled().expect("paquet");
    pet.manifest.atlas.rows = 10;
    pet.manifest.atlas.height = 2080;

    let c = conformite(&pet.pet, &pet.manifest);
    assert!(!c.ok());
    assert_eq!(c.version, None);
    assert!(
        c.ecarts.iter().any(|e| e.contains("ni v1") && e.contains("ni v2")),
        "l'écart doit nommer les deux versions attendues : {:?}",
        c.ecarts
    );

    // Et l'entrée d'installation refuse de se produire : publier une entrée pour un paquet
    // qu'un installeur rejettera ne rend service à personne.
    assert!(
        entree_installation(
            &pet.pet,
            &pet.manifest,
            BUNDLED_PET_JSON.as_bytes(),
            BUNDLED_ATLAS_WEBP
        )
        .is_err()
    );
}

// ---------------------------------------------------------------------------------------------
// Installation native : les artefacts passent les validations reproduites de Codex
// ---------------------------------------------------------------------------------------------

use aphrody_identity::codex::{self, Artefact};

fn v1() -> (Pet, Artefact) {
    let pet = Pet::bundled().expect("paquet");
    let a = codex::artefact_v1(&pet).expect("artefact v1");
    (pet, a)
}

fn erreur(r: Result<impl std::fmt::Debug, aphrody_identity::Error>) -> String {
    r.expect_err("doit être refusé").to_string()
}

#[test]
fn l_artefact_v1_passe_le_tui_et_l_installeur_de_la_galerie() {
    let (pet, a) = v1();
    assert_eq!(a.dimensions, (1536, 1872));
    assert_eq!(codex::dimensions_webp(&a.atlas).expect("webp"), (1536, 1872));
    assert_eq!(codex::valider_galerie(&a.pet_json, &a.atlas, &a.id).expect("galerie"), Version::V1);
    let joue = codex::valider_tui(&a.pet_json, &a.atlas, &a.id).expect("TUI");
    // Sans `animations`, Codex applique ses pistes par défaut : ce sont celles du paquet (qui
    // en ajoute d'autres, les poses de regard notamment).
    let attendu = codex::pet_codex(&pet).expect("pet");
    for (nom, piste) in &joue.pistes {
        assert_eq!(Some(piste), attendu.pistes.get(nom), "piste « {nom} »");
    }
    assert!(a.atlas.len() <= codex::MAX_ATLAS);
    let e = a.entree(&pet.pet.display_name);
    assert_eq!((e.sprite_version_number, e.spritesheet_height), (1, 1872));
}

#[test]
fn l_artefact_v2_est_pour_l_app_et_le_tui_le_refuse_avec_sa_raison() {
    let pet = Pet::bundled().expect("paquet");
    let a = codex::artefact_v2(&pet, BUNDLED_ATLAS_WEBP).expect("artefact v2");
    assert_eq!(codex::valider_galerie(&a.pet_json, &a.atlas, &a.id).expect("galerie"), Version::V2);
    let e = erreur(codex::valider_tui(&a.pet_json, &a.atlas, &a.id));
    assert!(e.contains("1536x1872") && e.contains("1536x2288"), "{e}");
}

#[test]
fn les_refus_du_chargeur_codex_sont_reproduits() {
    let (_, a) = v1();
    let cas: [(&str, &str); 8] = [
        (r#"{"frame":{"rows":9}}"#, "missing field"),
        (r#"{"spritesheetPath":"../x.webp"}"#, "chemin d'atlas"),
        (r#"{"animations":{"idle":{"frames":[]}}}"#, "idle"),
        (r#"{"animations":{"idle":{"frames":[72]}}}"#, "72"),
        (r#"{"animations":{"idle":{"frames":[0],"fps":0}}}"#, "fps"),
        (r#"{"animations":{"idle":{"frames":[0],"fps":61}}}"#, "fps"),
        (r#"{"animations":{"wave":{"frames":[0],"loop":false,"fallback":"nope"}}}"#, "nope"),
        (r#"{"frame":{"width":100,"height":208,"columns":8,"rows":9}}"#, "atlas"),
    ];
    for (json, motif) in cas {
        let e = erreur(codex::valider_tui(json.as_bytes(), &a.atlas, "x"));
        assert!(e.contains(motif), "{json} : « {e} » devrait mentionner « {motif} »");
    }
    // Un manifeste minimal (`{}`) est accepté : Codex complète tout par défaut.
    let p = codex::valider_tui(b"{}", &a.atlas, "dossier").expect("minimal");
    assert_eq!(p.id, "dossier");
    // Atlas non WebP.
    let e = erreur(codex::valider_tui(b"{}", b"\x89PNG\r\n\x1a\n0000", "x"));
    assert!(e.contains("WebP"), "{e}");
}

#[test]
fn les_refus_de_l_installeur_de_la_galerie_sont_reproduits() {
    let (_, a) = v1();
    let e = erreur(codex::valider_galerie(&a.pet_json, &a.atlas, "autre"));
    assert!(e.contains("autre"), "{e}");
    let gros = vec![b' '; codex::MAX_PET_JSON + 1];
    assert!(erreur(codex::valider_galerie(&gros, &a.atlas, &a.id)).contains("64 Kio"));
    let faux_v2 = String::from_utf8(a.pet_json.clone())
        .expect("utf-8")
        .replace("\"spriteVersionNumber\": 1", "\"spriteVersionNumber\": 2");
    let e = erreur(codex::valider_galerie(faux_v2.as_bytes(), &a.atlas, &a.id));
    assert!(e.contains("incohérent"), "{e}");
}

#[cfg(feature = "fs")]
#[test]
fn installation_dans_un_codex_home_temporaire() {
    let (_, a) = v1();
    let home = std::env::temp_dir().join(format!("aphrody-codex-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);

    let cible = codex::installer(&home, &a).expect("installation");
    assert_eq!(cible, home.join("pets").join(&a.id));
    assert_eq!(std::fs::read(cible.join("pet.json")).expect("pet.json"), a.pet_json);
    // Réinstaller remplace un paquet géré.
    codex::installer(&home, &a).expect("réinstallation");
    let restes: Vec<_> = std::fs::read_dir(home.join("pets"))
        .expect("pets")
        .map(|e| e.expect("entrée").file_name())
        .collect();
    assert_eq!(restes, [std::ffi::OsString::from(&a.id)], "ni étape ni sauvegarde ne restent");

    // Un fichier étranger dans le dossier bloque le remplacement.
    std::fs::write(cible.join("notes.txt"), "à moi").expect("écriture");
    let e = erreur(codex::installer(&home, &a));
    assert!(e.contains("non géré"), "{e}");
    assert!(cible.join("notes.txt").exists());

    std::fs::remove_dir_all(&home).expect("nettoyage");
}

#[cfg(feature = "fs")]
#[test]
fn la_commande_pet_ecrit_puis_verifie_l_artefact() {
    let racine = std::env::temp_dir().join(format!("aphrody-pet-cli-{}", std::process::id()));
    let dossier = racine.join("aphrody");
    let _ = std::fs::remove_dir_all(&racine);
    let lancer = |args: &[&str]| {
        let mut v = vec![std::ffi::OsString::from("pet")];
        v.extend(args.iter().map(std::ffi::OsString::from));
        aphrody_identity::pet_main(v)
    };
    let chemin = dossier.to_string_lossy().into_owned();
    assert_eq!(lancer(&["codex", "--sortie", &chemin]), 0);
    assert_eq!(lancer(&["verifier", &chemin]), 0);
    assert_eq!(lancer(&["codex", "--v2", "--sortie", &chemin]), 0);
    assert_eq!(
        lancer(&["verifier", &chemin]),
        0,
        "une v2 passe la galerie, le refus du TUI est attendu"
    );
    assert_eq!(lancer(&["codex", "--inconnu"]), 1);
    assert_eq!(lancer(&["verifier", &racine.join("absent").to_string_lossy()]), 1);
    std::fs::remove_dir_all(&racine).expect("nettoyage");
}
