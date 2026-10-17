// SPDX-License-Identifier: Apache-2.0
//! Les deux fichiers que le runtime web consomme sont régénérés ici et comparés aux versions
//! versionnées : `assets/aphrody/web.json` (données + CSS de `<aphrody-pet>`) et
//! `tests/fixtures/parite-web.json` (ticks attendus, rejoués par `m3/packages/identity`).
//! `APHRODY_IDENTITY_BLESS=1` les réécrit.

use aphrody_identity::web;
use std::path::PathBuf;

fn verifier(relatif: &str, attendu: &str) {
    let chemin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relatif);
    if std::env::var_os("APHRODY_IDENTITY_BLESS").is_some() {
        if let Some(dossier) = chemin.parent() {
            std::fs::create_dir_all(dossier).expect("dossier");
        }
        std::fs::write(&chemin, attendu).expect("écriture");
        return;
    }
    let present = std::fs::read_to_string(&chemin)
        .unwrap_or_else(|e| panic!("{relatif} : {e} (APHRODY_IDENTITY_BLESS=1 pour le créer)"));
    assert!(
        present.replace("\r\n", "\n") == attendu,
        "{relatif} n'est plus à jour : relancer avec APHRODY_IDENTITY_BLESS=1"
    );
}

#[test]
fn les_donnees_web_sont_a_jour() {
    verifier(
        "assets/aphrody/web.json",
        &web::web_json_embarque().expect("données web"),
    );
}

#[test]
fn la_fixture_de_parite_est_a_jour() {
    let f = web::fixture_parite().expect("fixture");
    verifier("tests/fixtures/parite-web.json", &web::json_lisible(&f));
}
