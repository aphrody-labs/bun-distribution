// SPDX-License-Identifier: Apache-2.0
//! Option A du runtime web, gardée pour la mesure : l'horloge du pet de la crate
//! ([`PetCodex::resoudre`]) compilée en `wasm32-unknown-unknown` derrière une ABI C minimale,
//! sans wasm-bindgen. `m3/packages/identity/scripts/measure.ts --wasm <fichier>` en mesure la
//! taille et l'instanciation, et rejoue la fixture de parité à travers elle.
//!
//! ```text
//! cargo build --release --target wasm32-unknown-unknown -p aphrody-identity --no-default-features \
//!     --example pet_wasm
//! ```
//!
//! ABI : `pet_buffer(n)` rend un tampon de `n` octets où écrire le nom de piste (UTF-8) ;
//! `pet_resolve(n, ecoule_ms)` rend la cellule (-1 : aucune) et réécrit dans le tampon le nom de
//! la piste jouée, dont `pet_track_len()` donne la longueur ; `pet_delay()` rend le délai avant la
//! frame suivante (-1 : image figée).

use aphrody_identity::pets::{Grille, PetCodex};
use aphrody_identity::{AnimationsManifest, BUNDLED_ANIMATIONS_JSON, pets};
use std::sync::{LazyLock, Mutex};

static PET: LazyLock<Option<PetCodex>> = LazyLock::new(|| {
    let m = AnimationsManifest::from_json(BUNDLED_ANIMATIONS_JSON).ok()?;
    Some(PetCodex {
        id: m.pet.id.clone(),
        nom: m.pet.display_name.clone(),
        description: String::new(),
        atlas: String::new(),
        grille: Grille::default(),
        pistes: pets::pistes_depuis_animations(&m).ok()?,
    })
});

struct Etat {
    tampon: Vec<u8>,
    piste: usize,
    delai: f64,
}

static ETAT: Mutex<Etat> = Mutex::new(Etat {
    tampon: Vec::new(),
    piste: 0,
    delai: -1.0,
});

/// Tampon d'échange de `n` octets, à remplir avant [`pet_resolve`].
#[unsafe(no_mangle)]
pub extern "C" fn pet_buffer(n: usize) -> *mut u8 {
    let mut e = ETAT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    e.tampon.resize(n.max(64), 0);
    e.tampon.as_mut_ptr()
}

/// Résout la piste nommée par les `n` premiers octets du tampon après `ecoule_ms`.
#[unsafe(no_mangle)]
pub extern "C" fn pet_resolve(n: usize, ecoule_ms: f64) -> i32 {
    let mut e = ETAT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let nom = e
        .tampon
        .get(..n)
        .and_then(|o| std::str::from_utf8(o).ok())
        .unwrap_or("")
        .to_string();
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "temps en ms, borné par l'appelant"
    )]
    let ecoule = ecoule_ms.max(0.0).floor() as u64;
    let Some((piste, tick)) = PET.as_ref().and_then(|p| p.resoudre(&nom, ecoule)) else {
        e.piste = 0;
        e.delai = -1.0;
        return -1;
    };
    let piste = piste.as_bytes();
    if e.tampon.len() < piste.len() {
        e.tampon.resize(piste.len(), 0);
    }
    e.tampon[..piste.len()].copy_from_slice(piste);
    e.piste = piste.len();
    #[expect(clippy::cast_precision_loss, reason = "délais de quelques secondes")]
    let delai = tick.delai_ms.map_or(-1.0, |d| d as f64);
    e.delai = delai;
    i32::try_from(tick.sprite_index).unwrap_or(-1)
}

/// Longueur du nom de piste écrit par le dernier [`pet_resolve`].
#[unsafe(no_mangle)]
pub extern "C" fn pet_track_len() -> usize {
    ETAT.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .piste
}

/// Délai du dernier [`pet_resolve`], ou -1.
#[unsafe(no_mangle)]
pub extern "C" fn pet_delay() -> f64 {
    ETAT.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .delai
}
