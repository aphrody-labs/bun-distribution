//! `aphrody-nie-ffi` — Frontière FFI C-ABI.
//!
//! Expose la logique nie à des runtimes extérieurs (Bun, Node, C, Python…) via une interface
//! `extern "C"` stable.
//!
//! # Fonctions exportées — existantes
//!
//! | Symbole C              | Sémantique Rust                                           |
//! |------------------------|-----------------------------------------------------------|
//! | `nie_crc32`            | CRC32 IEEE 802.3 d'un tampon `(ptr, len)`                 |
//! | `nie_crand_new`        | Crée un `CRand` (MT19937) depuis une graine `u32`         |
//! | `nie_crand_from_u64`   | Crée un `CRand` depuis une graine `u64` (repli XOR)      |
//! | `nie_crand_next_u32`   | Tire le prochain `u32`                                    |
//! | `nie_crand_bounded`    | Tire un entier dans `[0, bound)` (Lemire + rejet)         |
//! | `nie_crand_next_f32`   | Tire un `f32` dans `[0.0, 1.0)`                           |
//! | `nie_crand_free`       | Libère un handle `CRand` (exactement une fois)            |
//! | `nie_version`          | Version du crate en C-string statique                     |
//!
//! # Fonctions exportées — décodage formats + VFS
//!
//! | Symbole C                  | Sémantique Rust                                                  |
//! |----------------------------|------------------------------------------------------------------|
//! | `nie_bytes_free`           | Libère un `NieBytes` (exactement une fois, via `Vec::from_raw`) |
//! | `nie_bytes_free_fields`    | Libère par champs (`ptr, len, cap`) — pratique Bun FFI           |
//! | `nie_detect`               | Détecte le format d'un tampon → discriminant `u32` stable        |
//! | `nie_format_name`          | Nom court du format (C-string statique)                          |
//! | `nie_decode_json`          | Auto-détection → JSON UTF-8 ; `NieBytes::empty` si non supporté |
//! | `nie_decode_json_out`      | Idem, via paramètre de sortie `*mut NieBytes` (Bun FFI-friendly)|
//! | `nie_menu_setting_json_out`| `*_menu_setting.cfg.bin` → structure de menu typée       |
//! | `nie_g4tx_to_png`          | Première texture G4TX → octets PNG ; empty sur erreur            |
//! | `nie_g4tx_to_png_out`      | Idem, via `*mut NieBytes`                                        |
//! | `nie_vfs_open`             | Monte le VFS (AES-256-CBC cpk_list) ; null sur erreur            |
//! | `nie_vfs_read`             | Lit un fichier virtuel → octets bruts                            |
//! | `nie_vfs_read_out`         | Idem, via `*mut NieBytes`                                        |
//! | `nie_vfs_list_json`        | JSON `[{path,cpk,size}]` ; plafonné à 50 000 entrées             |
//! | `nie_vfs_list_json_out`    | Idem, via `*mut NieBytes`                                        |
//! | `nie_vfs_count`            | Nombre total d'entrées indexées (sans plafond)                   |
//! | `nie_vfs_is_readable`      | Présence servable d'un chemin, **sans lire le contenu**          |
//! | `nie_match_simulate_json_out` | Simulation de match à graine et à statistiques → JSON        |
//! | `nie_vfs_list_range_json_out` | Tranche `[offset, offset+limit)` de l'index, via `*mut NieBytes` |
//! | `nie_vfs_free`             | Libère le handle VFS                                             |
//!
//! # Fonctions exportées — rendu de texte (police du jeu)
//!
//! | Symbole C                  | Sémantique Rust                                                  |
//! |----------------------------|------------------------------------------------------------------|
//! | `nie_font_open`            | Charge métriques + atlas depuis le VFS → handle `FontCtx`         |
//! | `nie_font_render_text`     | Rend une chaîne UTF-8 avec la police → octets PNG RGBA8          |
//! | `nie_font_render_text_out` | Idem, via `*mut NieBytes` (Bun FFI-friendly)                     |
//! | `nie_font_free`            | Libère le handle `FontCtx`                                       |
//! | `nie_emu_registry_json_out` | Expose la matrice backend/capability de `aphrody-nie-emu`                 |
//!
//! # Invariants de sécurité pour les appelants
//!
//! - Les handles `*mut CRand` / VFS sont des pointeurs opaques alloués par ce crate.
//! - Chaque handle doit être libéré **exactement une fois** via la fonction `_free` correspondante.
//! - `null` est accepté en entrée par toutes les fonctions `unsafe` (no-op ou retour vide).
//! - `NieBytes` retourné par valeur utilise la convention sret x86-64 : **en Bun FFI, utiliser
//!   les variantes `_out` (paramètre `*mut NieBytes`) pour éviter le sret implicite.**
//!
//! # Utilisation Bun — variantes `_out` recommandées
//!
//! ```js
//! import { dlopen, FFIType, ptr, toArrayBuffer, suffix } from "bun:ffi";
//! // 1. Allouer un slot de sortie de 24 octets (sizeof NieBytes sur x86-64)
//! const outBuf = new Uint8Array(24);
//! // 2. Appeler la variante _out
//! symbols.nie_decode_json_out(inputPtr, BigInt(inputLen), ptr(outBuf));
//! // 3. Lire les champs depuis le slot via DataView
//! const dv  = new DataView(outBuf.buffer);
//! const p   = Number(dv.getBigUint64(0, true));   // ptr
//! const len = Number(dv.getBigUint64(8, true));   // len
//! const cap = dv.getBigUint64(16, true);           // cap (BigInt pour free)
//! // 4. Copier les données avant de libérer
//! const copy = new Uint8Array(toArrayBuffer(p, 0, len));
//! // 5. Libérer l'allocation Rust
//! symbols.nie_bytes_free_fields(BigInt(p), BigInt(len), cap);
//! ```

#![warn(missing_docs)]

use aphrody_nie_core::crand::CRand;
use core::ffi::{c_char, c_void};
use std::cell::RefCell;
use std::ffi::CStr;
use std::path::PathBuf;

thread_local! {
    static LAST_ERROR: RefCell<Option<String>> = const { RefCell::new(None) };
}

fn set_last_error(msg: impl Into<String>) {
    LAST_ERROR.with(|err| {
        *err.borrow_mut() = Some(msg.into());
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// CRC32 (IEEE 802.3, polynôme 0xEDB88320)
// ─────────────────────────────────────────────────────────────────────────────

/// Calcule le CRC32 IEEE 802.3 d'un tampon mémoire `(ptr, len)`.
///
/// Identique à `aphrody_nie_formats::cfgbin::crc32` : init `0xFFFFFFFF`, poly `0xEDB88320`, XOR final.
///
/// # Safety
///
/// - Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides et contigus.
/// - Si `len == 0`, `ptr` **n'est pas déréférencé** (retour immédiat `0`) ; `ptr` peut être null.
///
/// # Vecteurs de vérification (IEEE 802.3 / zlib)
///
/// - `crc32(b"Focus",       5) == 0xA301_65ED`
/// - `crc32(b"",            0) == 0x0000_0000`
/// - `crc32(b"123456789",   9) == 0xCBF4_3926`
///
/// # Bun
///
/// ```js
/// // Passer Buffer.from(s, "utf8") directement (zero-copy) et buf.byteLength.
/// const buf = Buffer.from("Focus", "utf8");
/// nie_crc32(buf, buf.byteLength); // => 0xA30165ED
/// ```
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crc32(ptr: *const u8, len: usize) -> u32 {
    if len == 0 {
        // Ne pas déréférencer ptr : peut être null ou dangling.
        return aphrody_nie_formats::cfgbin::crc32(&[]);
    }
    // SAFETY: l'appelant garantit que ptr pointe vers au moins `len` octets valides.
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    aphrody_nie_formats::cfgbin::crc32(data)
}

/// Calcule l'accumulateur brut CRC32 sans le XOR final `~crc`, identique à `nie-engine::g4::crc32_of`.
///
/// Utilisé pour les identifiants de modèles, uniformes, et clés brutes Level-5.
///
/// # Safety
///
/// - Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides.
/// - Si `len == 0` ou `ptr == null`, retourne `0xFFFFFFFF`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crc32_nie(ptr: *const u8, len: usize) -> u32 {
    if len == 0 || ptr.is_null() {
        return 0xFFFF_FFFF;
    }
    // SAFETY: l'appelant garantit que ptr pointe vers au moins `len` octets valides.
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    aphrody_nie_formats::cpk::crc32_nie(data)
}

// ─────────────────────────────────────────────────────────────────────────────
// CRand — handle opaque boxé (Box<CRand>)
// ─────────────────────────────────────────────────────────────────────────────

/// Crée un nouveau `CRand` (MT19937) depuis une graine 32 bits.
///
/// Retourne un handle opaque alloué sur le tas. Le propriétaire doit appeler
/// [`nie_crand_free`] **exactement une fois** pour libérer la mémoire.
///
/// # Propriété
///
/// ```text
/// let h = nie_crand_new(5489);
/// // ... utiliser h ...
/// nie_crand_free(h);  // une seule fois
/// // h est invalide après ce point
/// ```
///
/// # Bun
///
/// ```js
/// const h = symbols.nie_crand_new(5489); // FFIType.u32 -> FFIType.ptr (JS number)
/// ```
#[unsafe(no_mangle)]
pub extern "C" fn nie_crand_new(seed: u32) -> *mut CRand {
    Box::into_raw(Box::new(CRand::new(seed)))
}

/// Crée un nouveau `CRand` depuis une graine 64 bits (repli XOR des deux moitiés sur 32 bits).
///
/// Équivalent à `CRand::from_u64(seed)`. Côté Bun, la graine est un `BigInt` (`FFIType.u64`).
///
/// Même règle de propriété que [`nie_crand_new`] : libérer exactement une fois.
#[unsafe(no_mangle)]
pub extern "C" fn nie_crand_from_u64(seed: u64) -> *mut CRand {
    Box::into_raw(Box::new(CRand::from_u64(seed)))
}

/// Tire le prochain `u32` depuis le PRNG (MT19937 `genrand_int32` avec tempering canonique).
///
/// # Safety
///
/// - `handle` doit être un pointeur valide retourné par [`nie_crand_new`] ou
///   [`nie_crand_from_u64`], non encore libéré.
/// - `null` est accepté : retourne `0` sans déréférencer.
///
/// # Vecteurs (graine 5489)
///
/// ```text
/// new(5489) -> 3_499_211_612, 581_869_302, 3_890_346_734, …
/// ```
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crand_next_u32(handle: *mut CRand) -> u32 {
    if handle.is_null() {
        return 0;
    }
    // SAFETY: handle est non-null ; l'appelant garantit qu'il est valide et non libéré.
    unsafe { (*handle).next_u32() }
}

/// Tire un entier dans `[0, bound)` via la méthode de Lemire avec rejet.
///
/// Sémantique byte-exacte du moteur :
/// - `bound == 0` → retourne le tirage **brut** `next_u32()` (pas `0`) ;
/// - sinon → Lemire avec rejet (consommation de tirages identique au moteur nie.exe).
///
/// # Safety
///
/// Mêmes invariants que [`nie_crand_next_u32`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crand_bounded(handle: *mut CRand, bound: u32) -> u32 {
    if handle.is_null() {
        return 0;
    }
    // SAFETY: handle est non-null ; l'appelant garantit qu'il est valide et non libéré.
    unsafe { (*handle).bounded(bound) }
}

/// Tire un `f32` dans `[0.0, 1.0)` via les 24 bits de poids fort du tirage brut.
///
/// # Safety
///
/// Mêmes invariants que [`nie_crand_next_u32`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crand_next_f32(handle: *mut CRand) -> f32 {
    if handle.is_null() {
        return 0.0_f32;
    }
    // SAFETY: handle est non-null ; l'appelant garantit qu'il est valide et non libéré.
    unsafe { (*handle).next_f32() }
}

/// Libère un handle `CRand` précédemment retourné par [`nie_crand_new`] ou
/// [`nie_crand_from_u64`].
///
/// # Safety
///
/// - Appeler cette fonction **exactement une fois** par handle.
/// - `null` est un no-op (aucun déréférencement).
/// - Après l'appel, tout usage du pointeur est un comportement indéfini.
///
/// # Recommandation JS / Bun
///
/// Encapsuler dans une classe qui nullifie le pointeur après free et implante
/// `[Symbol.dispose]` (mot-clé `using`) pour garantir un seul appel :
///
/// ```js
/// class CRandHandle {
///   #ptr;
///   constructor(seed) { this.#ptr = symbols.nie_crand_new(seed); }
///   nextU32()  { return symbols.nie_crand_next_u32(this.#ptr); }
///   bounded(n) { return symbols.nie_crand_bounded(this.#ptr, n); }
///   [Symbol.dispose]() {
///     if (this.#ptr) { symbols.nie_crand_free(this.#ptr); this.#ptr = null; }
///   }
/// }
/// // usage : using h = new CRandHandle(5489);
/// ```
///
/// Une `FinalizationRegistry` peut servir de filet de sécurité additionnel.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crand_free(handle: *mut CRand) {
    if handle.is_null() {
        return;
    }
    // SAFETY: handle est non-null ; l'appelant garantit qu'il provient de nie_crand_new /
    // nie_crand_from_u64 et qu'il n'a pas encore été libéré.
    unsafe { drop(Box::from_raw(handle)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Méta
// ─────────────────────────────────────────────────────────────────────────────

/// Retourne la version du crate en C-string `'static` ASCII (`CARGO_PKG_VERSION` + `\0`).
///
/// La chaîne est statique : l'appelant **ne doit pas** la libérer.
/// Bun la décode directement en string JS via `FFIType.cstring`.
#[unsafe(no_mangle)]
pub extern "C" fn nie_version() -> *const c_char {
    // SAFETY: la chaîne est ASCII-pur, null-terminée, 'static et non-muable.
    concat!(env!("CARGO_PKG_VERSION"), "\0").as_ptr().cast::<c_char>()
}

// ─────────────────────────────────────────────────────────────────────────────
// NieBytes — tampon d'octets transféré de Rust vers JS
// ─────────────────────────────────────────────────────────────────────────────

/// Tampon d'octets alloué par Rust, passé à JS via l'ABI C.
///
/// JS DOIT appeler [`nie_bytes_free`] (ou [`nie_bytes_free_fields`] en Bun FFI)
/// **exactement une fois** après avoir lu `ptr[0..len]`.
///
/// `NieBytes::empty` (ptr null, len 0, cap 0) signal une erreur ou un résultat vide.
/// `nie_bytes_free` / `nie_bytes_free_fields` acceptent empty comme no-op.
#[repr(C)]
pub struct NieBytes {
    /// Pointeur vers les octets alloués par `Vec::into_raw_parts`.
    pub ptr: *mut u8,
    /// Longueur utile (octets valides).
    pub len: usize,
    /// Capacité interne (requis pour `Vec::from_raw_parts` lors de la libération).
    pub cap: usize,
}

// SAFETY: NieBytes transporte des données immutables après création ;
// le transfert de propriété unique vers JS est géré par convention.
unsafe impl Send for NieBytes {}

impl NieBytes {
    /// Tampon vide (ptr null, len 0, cap 0) — signal d'erreur ou de non-support.
    fn empty() -> Self {
        Self { ptr: core::ptr::null_mut(), len: 0, cap: 0 }
    }

    /// Transfère la propriété d'un `Vec<u8>` vers un `NieBytes`.
    /// La mémoire est désormais possédée par JS et doit être libérée via `nie_bytes_free`.
    fn from_vec(v: Vec<u8>) -> Self {
        let mut v = core::mem::ManuallyDrop::new(v);
        Self { ptr: v.as_mut_ptr(), len: v.len(), cap: v.capacity() }
    }
}

/// Sérialise le registre `aphrody-nie-emu` (backends et adaptateurs) vers un tampon C-ABI.
///
/// La fonction ne découvre rien et ne lance aucun processus. Elle donne aux hôtes Bun, C#,
/// Python et WASM le même contrat de capacités avant qu'un adaptateur FFI in-process ne soit
/// sélectionné.
///
/// # Safety
///
/// `out` doit être nul ou pointer vers un `NieBytes` accessible en écriture et exclusivement
/// détenu par l'appelant pendant cette invocation. Lorsque `out` est non nul, l'appelant doit
/// libérer le tampon produit avec l'API de libération FFI correspondante.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_emu_registry_json_out(out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    let value = serde_json::json!({
        "backends": aphrody_nie_emu::REGISTRY.all(),
        "adapters": aphrody_nie_emu::REGISTRY.adapters(),
        "common_capabilities": aphrody_nie_emu::COMMON_CAPABILITIES,
    });
    let bytes = serde_json::to_vec(&value).unwrap_or_default();
    // SAFETY: out is non-null and exclusively owned by the caller for this call.
    unsafe { *out = NieBytes::from_vec(bytes) };
}

/// Libère un [`NieBytes`] alloué par ce crate (via `Vec::from_raw_parts`).
///
/// # Safety
///
/// - Appeler **exactement une fois** par `NieBytes` non vide retourné par ce crate.
/// - `NieBytes::empty` (ptr null) est un no-op.
/// - En Bun FFI, utiliser [`nie_bytes_free_fields`] (évite le sret 24 octets).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_bytes_free(b: NieBytes) {
    if b.ptr.is_null() {
        return;
    }
    // SAFETY: ptr/len/cap proviennent de Vec::into_raw_parts ; appelé exactement une fois.
    unsafe { drop(Vec::from_raw_parts(b.ptr, b.len, b.cap)) };
}

/// Libère un tampon NieBytes en passant ses trois champs séparément.
///
/// Variante Bun-FFI-friendly de [`nie_bytes_free`] qui évite le problème de sret 24 octets :
/// `dlopen` peut déclarer `(ptr: u64, len: u64, cap: u64) → void`.
///
/// # Safety
///
/// - `data_ptr` doit provenir du champ `ptr` d'un `NieBytes` retourné par ce crate.
/// - `len` et `cap` doivent correspondre aux champs `len` et `cap` du même `NieBytes`.
/// - Appeler exactement une fois. `data_ptr == null` est un no-op.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_bytes_free_fields(data_ptr: *mut u8, len: usize, cap: usize) {
    if data_ptr.is_null() {
        return;
    }
    // SAFETY: identique à nie_bytes_free — même contrat de propriété.
    unsafe { drop(Vec::from_raw_parts(data_ptr, len, cap)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Détection de format
// ─────────────────────────────────────────────────────────────────────────────

/// Discriminant `u32` stable par variante de [`aphrody_nie_formats::FileFormat`].
/// Ces valeurs ne changent JAMAIS — elles font partie de l'ABI publique.
///
/// | u32 | Format      |
/// |-----|-------------|
/// |   0 | Unknown     |
/// |   1 | CPK         |
/// |   2 | @UTF        |
/// |   3 | CRILAYLA    |
/// |   4 | HCA         |
/// |   5 | ACB         |
/// |   6 | AWB         |
/// |   7 | USM         |
/// |   8 | cfg.bin     |
/// |   9 | G4MG        |
/// |  10 | G4MD        |
/// |  11 | G4TX        |
/// |  12 | G4SK        |
/// |  13 | G4PK/G4PKM  |
/// |  14 | G4NV        |
/// |  15 | LIP         |
const FORMAT_UNKNOWN: u32 = 0;

fn fileformat_to_u32(f: aphrody_nie_formats::FileFormat) -> u32 {
    f.id()
}

/// Détecte le format d'un tampon à partir de ses octets magiques.
///
/// Retourne un discriminant `u32` stable (1..28 pour les formats VFS standard).
/// `0` = inconnu.
///
/// # Safety
///
/// - Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides.
/// - `ptr == null` ou `len == 0` → retourne `0` (Unknown).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_detect(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return FORMAT_UNKNOWN;
    }
    // SAFETY: l'appelant garantit ptr..len valides.
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    fileformat_to_u32(aphrody_nie_formats::detect(data))
}

/// Retourne le nom court du format (C-string statique `'static`).
///
/// La chaîne est statique : l'appelant **ne doit pas** la libérer.
#[unsafe(no_mangle)]
pub extern "C" fn nie_format_name(kind: u32) -> *const c_char {
    let s: &'static [u8] = match kind {
        0 => b"?\0",
        1 => b"G4TX\0",
        2 => b"G4MD\0",
        3 => b"G4MG\0",
        4 => b"G4MT\0",
        5 => b"G4SK\0",
        6 => b"G4PK\0",
        7 => b"G4RA\0",
        8 => b"AGI\0",
        9 => b"OBJB\0",
        10 => b"col\0",
        11 => b"cfg.bin\0",
        12 => b"mevbin\0",
        13 => b"G4CM\0",
        14 => b"CPK\0",
        15 => b"AWB\0",
        16 => b"@UTF\0",
        17 => b"DDS\0",
        18 => b"PNG\0",
        19 => b"WAV\0",
        20 => b"XPCK\0",
        21 => b"XFSA\0",
        22 => b"CRILAYLA\0",
        23 => b"ACB\0",
        24 => b"USM\0",
        25 => b"G4NV\0",
        26 => b"COL\0",
        27 => b"COLS\0",
        28 => b"LIVE\0",
        29 => b"HCA\0",
        30 => b"p3lip\0",
        31 => b"DXBC\0",
        _ => b"?\0",
    };
    s.as_ptr().cast()
}

/// Retourne l'extension principale du format (C-string statique `'static`).
#[unsafe(no_mangle)]
pub extern "C" fn nie_format_extension(kind: u32) -> *const c_char {
    let s: &'static [u8] = match kind {
        1 => b".g4tx\0",
        2 => b".g4md\0",
        3 => b".g4mg\0",
        4 => b".g4mt\0",
        5 => b".g4sk\0",
        6 => b".g4pk\0",
        7 => b".g4ra\0",
        8 => b".agi\0",
        9 => b".objb\0",
        10 => b".pxcl\0",
        11 => b".cfg.bin\0",
        12 => b".mevbin\0",
        13 => b".g4cm\0",
        14 => b".cpk\0",
        15 => b".afs2\0",
        16 => b".utf\0",
        17 => b".dds\0",
        18 => b".png\0",
        19 => b".wav\0",
        20 => b".xpck\0",
        21 => b".xfsa\0",
        22 => b".crilayla\0",
        23 => b".acb\0",
        24 => b".usm\0",
        25 => b".g4nv\0",
        26 => b".col\0",
        27 => b".cols\0",
        28 => b".live\0",
        29 => b".hca\0",
        30 => b".p3lip\0",
        31 => b".vfxo\0",
        _ => b".bin\0",
    };
    s.as_ptr().cast()
}

/// Retourne le type MIME officiel du format (C-string statique `'static`).
#[unsafe(no_mangle)]
pub extern "C" fn nie_format_mime_type(kind: u32) -> *const c_char {
    let s: &'static [u8] = match kind {
        1 => b"image/x-level5-g4tx\0",
        2 => b"model/x-level5-g4md\0",
        3 => b"model/x-level5-g4mg\0",
        4 => b"model/x-level5-g4mt\0",
        5 => b"model/x-level5-g4sk\0",
        6 => b"application/x-level5-g4pk\0",
        7 => b"application/x-level5-g4ra\0",
        8 => b"application/x-level5-agi\0",
        9 => b"application/x-level5-objb\0",
        10 => b"application/x-level5-pxcl\0",
        11 => b"application/x-level5-rdbn\0",
        12 => b"application/x-level5-mevs\0",
        13 => b"application/x-level5-g4cm\0",
        14 => b"application/x-crifs-cpk\0",
        15 => b"audio/x-cri-afs2\0",
        16 => b"application/x-cri-utf\0",
        17 => b"image/vnd-ms.dds\0",
        18 => b"image/png\0",
        19 => b"audio/wav\0",
        20 => b"application/x-level5-xpck\0",
        21 => b"application/x-level5-xfsa\0",
        22 => b"application/x-cri-layla\0",
        23 => b"audio/x-cri-acb\0",
        24 => b"video/x-cri-usm\0",
        25 => b"application/x-level5-g4nv\0",
        26 => b"application/x-level5-col\0",
        27 => b"application/x-level5-cols\0",
        28 => b"application/x-level5-live\0",
        29 => b"audio/x-cri-hca\0",
        30 => b"application/x-level5-lip\0",
        31 => b"application/x-ms-dxbc\0",
        _ => b"application/octet-stream\0",
    };
    s.as_ptr().cast()
}

/// Retourne la catégorie fonctionnelle du format (C-string statique `'static`).
#[unsafe(no_mangle)]
pub extern "C" fn nie_format_category(kind: u32) -> *const c_char {
    let s: &'static [u8] = match kind {
        1 | 17 | 18 => b"texture\0",
        2 | 3 | 4 | 5 | 8 => b"model\0",
        6 | 7 | 14 | 16 | 20 | 21 | 22 => b"container\0",
        9 | 11 => b"config\0",
        12 | 13 => b"script\0",
        15 | 19 | 23 | 29 => b"audio\0",
        24 => b"video\0",
        10 | 26 | 27 => b"collision\0",
        _ => b"system\0",
    };
    s.as_ptr().cast()
}

/// Vrai si le format est Big-Endian.
#[unsafe(no_mangle)]
pub extern "C" fn nie_format_is_big_endian(kind: u32) -> bool {
    aphrody_nie_formats::FileFormat::from_id(kind).is_big_endian()
}

/// Vrai si le format supporte le chiffrement.
#[unsafe(no_mangle)]
pub extern "C" fn nie_format_supports_encryption(kind: u32) -> bool {
    aphrody_nie_formats::FileFormat::from_id(kind).supports_encryption()
}

/// Vrai si le format supporte la compression.
#[unsafe(no_mangle)]
pub extern "C" fn nie_format_supports_compression(kind: u32) -> bool {
    aphrody_nie_formats::FileFormat::from_id(kind).supports_compression()
}

/// Nombre total de formats canoniques supportés (28 formats VFS).
#[unsafe(no_mangle)]
pub extern "C" fn nie_format_count() -> u32 {
    28
}

/// Récupère l'ID du format à l'index `idx` (0-indexed).
#[unsafe(no_mangle)]
pub extern "C" fn nie_format_id_by_index(idx: u32) -> u32 {
    if idx < 28 { idx + 1 } else { 0 }
}

/// Exporte le catalogue VFS complet des 28 formats au format JSON UTF-8.
///
/// # Safety
///
/// If non-null, `out` must point to a writable, aligned `NieBytes` value.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_format_catalog_json_out(out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    let formats: Vec<_> = (1..=28)
        .map(|id| {
            let fmt = aphrody_nie_formats::FileFormat::from_id(id);
            let desc = fmt.descriptor();
            serde_json::json!({
                "id": desc.id,
                "name": desc.name,
                "magic_hex": desc.magic_hex,
                "magic_ascii": desc.magic_ascii,
                "extension": desc.extension,
                "mime_type": desc.mime_type,
                "category": desc.category,
                "is_big_endian": desc.is_big_endian,
                "encryption_supported": desc.encryption_supported,
                "compression_supported": desc.compression_supported,
                "description": desc.description,
            })
        })
        .collect();
    let json = serde_json::to_string(&formats).unwrap_or_else(|_| "[]".to_string());
    unsafe {
        *out = NieBytes::from_vec(json.into_bytes());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Décodage générique → JSON
// ─────────────────────────────────────────────────────────────────────────────

/// Dispatch interne : détecte le format et sérialise en JSON.
///
/// La table de dispatch vit dans [`aphrody_nie_formats::decode::to_json`], partagée avec la CLI
/// (`nie decode`) : une famille ajoutée là-bas profite aux deux d'un coup.
fn decode_json_impl(data: &[u8]) -> NieBytes {
    match aphrody_nie_formats::decode::to_json(data) {
        Some(v) => NieBytes::from_vec(v),
        None => NieBytes::empty(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wiki Rust → JSON (Bun/native hosts)
// ─────────────────────────────────────────────────────────────────────────────

/// Execute one bounded read-only wiki operation and serialize its Rust result.
///
/// The input is a UTF-8 JSON object with an `op` field. All database reads and
/// game-data decisions remain in `aphrody-nie-wiki`; this is only the flat C-ABI
/// transport. It never accepts SQL and never contacts Supabase.
fn wiki_json_impl(input: &[u8]) -> NieBytes {
    let result = std::panic::catch_unwind(|| -> anyhow::Result<serde_json::Value> {
        let request: serde_json::Value = serde_json::from_slice(input)
            .map_err(|error| anyhow::anyhow!("invalid wiki request: {error}"))?;
        let op = request
            .get("op")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("wiki request requires string field `op`"))?;
        let database =
            request.get("database").and_then(serde_json::Value::as_str).map(PathBuf::from);
        if database.is_none() {
            let domain = match op {
                "character" | "chara" | "search" => "characters",
                "skill" => "skills",
                "item" => "items",
                "team" => "teams",
                _ => {
                    return Err(anyhow::anyhow!(
                        "wiki operation `{op}` requires an explicit database; use the VFS domain API for native game data"
                    ));
                },
            };
            let supplied = request
                .get("game_dir")
                .or_else(|| request.get("data_root"))
                .and_then(serde_json::Value::as_str)
                .map(PathBuf::from)
                .unwrap_or_else(aphrody_nie_formats::vfs::resolve_game_dir);
            let data = if supplied.join("cpk_list.cfg.bin").is_file() {
                supplied
            } else {
                supplied.join("data")
            };
            let mut vfs = aphrody_nie_formats::vfs::Vfs::new();
            vfs.init(&data).map_err(|error| anyhow::anyhow!("VFS unavailable: {error}"))?;
            let mut direct = request.clone();
            direct["domain"] = serde_json::json!(domain);
            if direct.get("query").is_none()
                && let Some(id) = request.get("id")
            {
                direct["query"] = id.clone();
            }
            return aphrody_nie_app::game_data::query_vfs(&vfs, &direct)
                .map_err(anyhow::Error::msg);
        }
        let connection = aphrody_nie_wiki::mirror::open(database.as_deref())
            .map_err(|error| anyhow::anyhow!("wiki mirror unavailable: {error}"))?;
        let string_field = |name: &str| {
            request
                .get(name)
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("wiki request requires string field `{name}`"))
        };
        let data_root = request
            .get("data_root")
            .and_then(serde_json::Value::as_str)
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("DATA_ROOT").map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("data"));

        let value = match op {
            "character" | "chara" => {
                let query = string_field("query").or_else(|_| string_field("id"))?;
                let id = aphrody_nie_wiki::query::search_characters(&connection, query)?
                    .into_iter()
                    .next()
                    .map(|character| character.id)
                    .unwrap_or_else(|| query.to_owned());
                let card = aphrody_nie_wiki::cards::character(&connection, &id)?
                    .ok_or_else(|| anyhow::anyhow!("character was not found"))?;
                serde_json::to_value(card)?
            },
            "search" => {
                let query = string_field("query")?;
                let limit = request
                    .get("limit")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(20)
                    .clamp(1, 50) as usize;
                serde_json::to_value(aphrody_nie_wiki::query::search_all(
                    &connection,
                    query,
                    limit,
                )?)?
            },
            "skill" => {
                let query = string_field("query").or_else(|_| string_field("id"))?;
                if let Some(skill) = aphrody_nie_wiki::query::get_skill(&connection, query)? {
                    serde_json::to_value(skill)?
                } else {
                    aphrody_nie_wiki::query::lookup_skill_legacy(&data_root, query)?
                }
            },
            "item" => {
                let query = string_field("query").or_else(|_| string_field("id"))?;
                aphrody_nie_wiki::query::lookup_item_legacy(&connection, query)?
            },
            "team" => {
                let query = string_field("query").or_else(|_| string_field("id"))?;
                let corpus = data_root.join("all-gamedata").join("teams.json");
                aphrody_nie_wiki::query::lookup_team_legacy(&connection, &corpus, query)?
            },
            "compare" => {
                let level = request
                    .get("level")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(99)
                    .clamp(1, 99) as u8;
                let first = string_field("chara1")?;
                let second = string_field("chara2")?;
                serde_json::to_value(aphrody_nie_wiki::query::compare_characters(
                    &connection,
                    &data_root,
                    first,
                    second,
                    level,
                )?)?
            },
            "auras" => {
                let input: aphrody_nie_wiki::auras::AuraListRequest =
                    serde_json::from_value(request.clone())?;
                serde_json::to_value(aphrody_nie_wiki::auras::list_auras(&connection, &input)?)?
            },
            "aura" => {
                let id = string_field("id")?;
                let type_slug = request.get("type_slug").and_then(serde_json::Value::as_str);
                let aura = aphrody_nie_wiki::auras::get_aura(&connection, id, type_slug)?
                    .ok_or_else(|| anyhow::anyhow!("aura was not found"))?;
                serde_json::to_value(aura)?
            },
            "tactics" => {
                let input: aphrody_nie_wiki::tactics::TacticListRequest =
                    serde_json::from_value(request.clone())?;
                serde_json::to_value(aphrody_nie_wiki::tactics::list_tactics(&connection, &input)?)?
            },
            "tactic" => {
                let id = string_field("id")?;
                let tactic = aphrody_nie_wiki::tactics::get_tactic(&connection, id)?
                    .ok_or_else(|| anyhow::anyhow!("tactic was not found"))?;
                serde_json::to_value(tactic)?
            },
            "passives" => {
                let input: aphrody_nie_wiki::passives::PassiveListRequest =
                    serde_json::from_value(request.clone())?;
                serde_json::to_value(aphrody_nie_wiki::passives::list_passives(
                    &connection,
                    &input,
                )?)?
            },
            "passive" => {
                let id = string_field("id")?;
                let passive = aphrody_nie_wiki::passives::get_passive(&connection, id)?
                    .ok_or_else(|| anyhow::anyhow!("passive was not found"))?;
                serde_json::to_value(passive)?
            },
            "passive-scaling" => serde_json::to_value(
                aphrody_nie_wiki::passives::list_passive_scaling(&connection)?,
            )?,
            "quests" => {
                let input: aphrody_nie_wiki::auxiliary::QuestRequest =
                    serde_json::from_value(request.clone())?;
                aphrody_nie_wiki::auxiliary::list_quests(&connection, &input)?
            },
            "quest" => {
                let id = string_field("id")?;
                aphrody_nie_wiki::auxiliary::get_quest(&connection, id)?
                    .ok_or_else(|| anyhow::anyhow!("quest was not found"))?
            },
            "shops" => {
                let input: aphrody_nie_wiki::auxiliary::ShopRequest =
                    serde_json::from_value(request.clone())?;
                aphrody_nie_wiki::auxiliary::list_shops(&connection, &input)?
            },
            "shop" => {
                let id = request
                    .get("id")
                    .and_then(serde_json::Value::as_i64)
                    .ok_or_else(|| anyhow::anyhow!("shop request requires integer field `id`"))?;
                aphrody_nie_wiki::auxiliary::get_shop(&connection, id)?
                    .ok_or_else(|| anyhow::anyhow!("shop was not found"))?
            },
            "capsules" => {
                let input: aphrody_nie_wiki::auxiliary::CapsuleRequest =
                    serde_json::from_value(request.clone())?;
                aphrody_nie_wiki::auxiliary::list_capsules(&connection, &input)?
            },
            "capsule" => {
                let id = string_field("id")?;
                aphrody_nie_wiki::auxiliary::get_capsule(&connection, id)?
                    .ok_or_else(|| anyhow::anyhow!("capsule was not found"))?
            },
            "costumes" => aphrody_nie_wiki::auxiliary::list_costumes(
                &connection,
                request.get("page").and_then(serde_json::Value::as_u64).unwrap_or(1) as u32,
                request.get("limit").and_then(serde_json::Value::as_u64).unwrap_or(50) as u32,
            )?,
            "stadiums" => aphrody_nie_wiki::auxiliary::list_stadiums(
                &connection,
                request.get("query").and_then(serde_json::Value::as_str),
            )?,
            "stadium" => {
                let id = string_field("id")?;
                aphrody_nie_wiki::auxiliary::get_stadium(&connection, id)?
                    .ok_or_else(|| anyhow::anyhow!("stadium was not found"))?
            },
            "trophies" => aphrody_nie_wiki::auxiliary::list_trophies(
                &connection,
                request.get("query").and_then(serde_json::Value::as_str),
                request.get("category").and_then(serde_json::Value::as_str),
            )?,
            "coaches" => aphrody_nie_wiki::auxiliary::list_coaches(
                &connection,
                request.get("query").and_then(serde_json::Value::as_str),
            )?,
            other => return Err(anyhow::anyhow!("unsupported wiki operation: {other}")),
        };
        Ok(value)
    });

    match result {
        Ok(Ok(value)) => {
            serde_json::to_vec(&value).map(NieBytes::from_vec).unwrap_or_else(|_| NieBytes::empty())
        },
        _ => NieBytes::empty(),
    }
}

/// Execute one Rust-owned wiki request from Bun or another native host.
///
/// # Safety
/// `input` must point to a valid UTF-8 JSON buffer of `input_len` bytes and
/// `out` must point to a writable, properly aligned [`NieBytes`] slot.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_wiki_json_out(input: *const u8, input_len: usize, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    if input.is_null() || input_len == 0 {
        // SAFETY: caller supplied a non-null writable output slot.
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    // SAFETY: caller guarantees that input points to input_len readable bytes.
    let bytes = unsafe { core::slice::from_raw_parts(input, input_len) };
    // SAFETY: caller supplied a non-null writable output slot.
    unsafe { out.write(wiki_json_impl(bytes)) };
}

/// Parse un `*_menu_setting.cfg.bin` T2B vers la structure de menu sémantique de `aphrody-nie-data`.
///
/// Le résultat JSON contient les douze collections de [`aphrody_nie_data::menu_setting::MenuSetting`]
/// (`layers`, `resources`, `commands`, groupes et focus), plutôt que l'arbre T2B brut. La
/// fonction est volontairement spécialisée : le nom de fichier n'est pas nécessaire pour
/// décoder et la même ABI sert donc les appels directs et le VFS Bun.
fn menu_setting_json_impl(data: &[u8]) -> NieBytes {
    let parsed = match aphrody_nie_formats::cfgbin::cfgbin_parse(data) {
        Ok(value) => value,
        Err(_) => return NieBytes::empty(),
    };
    let root = match serde_json::to_value(parsed) {
        Ok(value) => value,
        Err(_) => return NieBytes::empty(),
    };
    let setting = aphrody_nie_data::menu_setting::parse(&root);
    match serde_json::to_vec(&setting) {
        Ok(value) => NieBytes::from_vec(value),
        Err(_) => NieBytes::empty(),
    }
}

/// Auto-détecte le format d'un tampon et le sérialise en JSON UTF-8.
///
/// Retourne [`NieBytes::empty`] si le format est non supporté ou si le parse échoue.
/// JS doit appeler [`nie_bytes_free`] après avoir consommé le résultat.
///
/// **Note Bun FFI** : cette fonction retourne `NieBytes` par valeur (24 octets, sret x86-64).
/// Préférer [`nie_decode_json_out`] depuis Bun.
///
/// # Safety
///
/// - Si `len > 0`, `ptr` doit pointer vers `len` octets valides.
/// - `ptr == null` ou `len == 0` → retourne `NieBytes::empty`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_decode_json(ptr: *const u8, len: usize) -> NieBytes {
    if ptr.is_null() || len == 0 {
        return NieBytes::empty();
    }
    // SAFETY: l'appelant garantit ptr..len valides.
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    decode_json_impl(data)
}

/// Variante Bun-FFI-friendly de [`nie_decode_json`] : écrit le résultat dans `*out`.
///
/// `out` doit pointer vers un `NieBytes` de 24 octets alloué par l'appelant (p.ex. un
/// `Uint8Array(24)` côté JS, dont l'adresse est passée via `ptr(buf)`).
///
/// # Safety
///
/// - `ptr` et `out` ne doivent pas être null et doivent pointer vers des zones valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_decode_json_out(ptr: *const u8, len: usize, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    let result = if ptr.is_null() || len == 0 {
        NieBytes::empty()
    } else {
        // SAFETY: l'appelant garantit ptr..len valides.
        let data = unsafe { core::slice::from_raw_parts(ptr, len) };
        decode_json_impl(data)
    };
    // SAFETY: out est non-null et aligné (l'appelant alloue 24 octets alignés).
    unsafe { out.write(result) };
}

/// Decode CFG bytes into the canonical typed `{entries}` or `{lists}` schema.
/// This is an in-memory conversion; no extracted JSON file or database is required.
/// Free the returned bytes with [`nie_bytes_free`]. Invalid input returns empty bytes.
///
/// # Safety
/// When non-null, `ptr` must address `len` readable bytes and `out` must address
/// an aligned, writable [`NieBytes`]. A null `out` is a no-op.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cfgbin_typed_json_out(ptr: *const u8, len: usize, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    let result = if ptr.is_null() || len == 0 {
        NieBytes::empty()
    } else {
        // SAFETY: the caller guarantees the input range is readable.
        let data = unsafe { core::slice::from_raw_parts(ptr, len) };
        aphrody_nie_formats::cfgbin::to_iecode_json(data)
            .and_then(|value| serde_json::to_vec(&value).ok())
            .map(NieBytes::from_vec)
            .unwrap_or_else(NieBytes::empty)
    };
    // SAFETY: the caller guarantees the output is aligned and writable.
    unsafe { out.write(result) };
}

/// Variante Bun-FFI-friendly du parseur de menu typé.
///
/// `out` doit pointer vers un `NieBytes` de 24 octets alloué par l'appelant. Un pointeur nul,
/// un tampon vide ou un T2B invalide produisent un résultat vide ; aucun détail d'erreur n'est
/// exposé par cette ABI C, conformément aux autres décodeurs `_out`.
///
/// # Safety
///
/// - Si `len > 0`, `ptr` doit pointer vers `len` octets valides et contigus.
/// - `out` doit être non nul, aligné et inscriptible pour un [`NieBytes`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_menu_setting_json_out(ptr: *const u8, len: usize, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    let result = if ptr.is_null() || len == 0 {
        NieBytes::empty()
    } else {
        // SAFETY: l'appelant garantit ptr..len valides.
        let data = unsafe { core::slice::from_raw_parts(ptr, len) };
        menu_setting_json_impl(data)
    };
    // SAFETY: out est non-null et aligné (l'appelant alloue 24 octets alignés).
    unsafe { out.write(result) };
}

// ─────────────────────────────────────────────────────────────────────────────
// G4TX → PNG
// ─────────────────────────────────────────────────────────────────────────────

/// Décode la première texture principale d'un fichier G4TX en octets PNG.
///
/// Extraction : `g4tx::parse` → `textures[0]` → payload DDS → `image::load_from_memory_with_format`
/// (BC1/BC2/BC3/BC4/BC5 supportés ; BC7 retourne empty). Encode en PNG via le crate `image`.
///
/// Retourne [`NieBytes::empty`] sur toute erreur (magic invalide, DDS non supporté, etc.).
/// JS doit appeler [`nie_bytes_free`] / [`nie_bytes_free_fields`] après consommation.
///
/// **Note Bun FFI** : préférer [`nie_g4tx_to_png_out`].
///
/// # Safety
///
/// - Si `len > 0`, `ptr` doit pointer vers `len` octets G4TX valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_g4tx_to_png(ptr: *const u8, len: usize) -> NieBytes {
    if ptr.is_null() || len == 0 {
        return NieBytes::empty();
    }
    // SAFETY: l'appelant garantit ptr..len valides.
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    g4tx_to_png_impl(data)
}

/// Variante Bun-FFI-friendly de [`nie_g4tx_to_png`] : écrit le résultat dans `*out`.
///
/// # Safety
///
/// Mêmes invariants que [`nie_decode_json_out`].
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_g4tx_to_png_out(ptr: *const u8, len: usize, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    let result = if ptr.is_null() || len == 0 {
        NieBytes::empty()
    } else {
        // SAFETY: l'appelant garantit ptr..len valides.
        let data = unsafe { core::slice::from_raw_parts(ptr, len) };
        g4tx_to_png_impl(data)
    };
    // SAFETY: out est non-null et aligné.
    unsafe { out.write(result) };
}

/// Implémentation commune G4TX → PNG.
///
/// Délègue au décodeur partagé `aphrody_nie_formats::g4tx_decode` (feature `textures`, source unique
/// du workspace — Phase 1b dédup). Bonus vs l'ancienne copie locale (DX10 seul) : support
/// FourCC legacy + non compressé + sélecteur anti-dummy [`g4tx::select_main_texture`].
fn g4tx_to_png_impl(data: &[u8]) -> NieBytes {
    // Basename vide ASSUMÉ : l'ABI C ne reçoit que des octets, jamais le nom du fichier source
    // (cf. `decode_best_to_png`). La sélection retombe sur « la plus grande non-dummy ».
    match aphrody_nie_formats::g4tx_decode::decode_best_to_png(data, "") {
        Some(png) => NieBytes::from_vec(png),
        None => NieBytes::empty(),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// VFS — Virtual File System (CPK/cpk_list)
// ─────────────────────────────────────────────────────────────────────────────

/// Nombre maximum d'entrées dans la liste JSON du VFS (cap mémoire).
///
/// Le VFS IEVR indexe ~254 200 fichiers. Sérialiser la totalité en JSON représente
/// ~40 Mo. Cette constante borne le tableau à 50 000 entrées ; les entrées suivantes
/// sont silencieusement tronquées. Utiliser `nie_vfs_read` pour accéder à n'importe
/// quel fichier par chemin interne.
const VFS_LIST_CAP: usize = 50_000;

/// Mount a game root, data directory, nie.exe path, HTTP(S) URI or SSH/SFTP URI.
/// Null/empty selects shared discovery. Returns an opaque handle or null on failure;
/// inspect `nie_last_error_out` and release successful handles with [`nie_vfs_free`].
///
/// # Safety
///
/// `game_data_dir` is null or a valid NUL-terminated UTF-8 C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_open(game_data_dir: *const c_char) -> *mut c_void {
    // SAFETY: l'appelant garantit une C-string null-terminée valide.
    let hint = if game_data_dir.is_null() {
        None
    } else {
        match unsafe { std::ffi::CStr::from_ptr(game_data_dir) }.to_str() {
            Ok(source) => Some(source),
            Err(_) => {
                set_last_error("game source must be UTF-8");
                return core::ptr::null_mut();
            },
        }
    };
    match aphrody_nie_formats::vfs::open_source(hint) {
        Ok(vfs) => Box::into_raw(Box::new(vfs)).cast(),
        Err(error) => {
            set_last_error(error.to_string());
            core::ptr::null_mut()
        },
    }
}

/// Resolve a source without mounting/indexing it; null/empty hint selects shared discovery.
///
/// # Safety
/// `hint` is null or a valid NUL-terminated UTF-8 string; `out` points to writable NieBytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_game_source_resolve_out(hint: *const c_char, out: *mut NieBytes) {
    let started = std::time::Instant::now();
    if out.is_null() {
        return;
    }
    let hint = if hint.is_null() {
        None
    } else {
        match unsafe { std::ffi::CStr::from_ptr(hint) }.to_str() {
            Ok(source) => Some(source),
            Err(_) => {
                set_last_error("game source must be UTF-8");
                unsafe {
                    *out = NieBytes::empty();
                }
                return;
            },
        }
    };
    match aphrody_nie_formats::game_source::resolve(hint) {
        Ok(source) => {
            let json = serde_json::json!({"remote": aphrody_nie_formats::game_source::is_remote(&source), "source": source, "discovery_ms": started.elapsed().as_secs_f64() * 1000.0});
            unsafe {
                *out = NieBytes::from_vec(json.to_string().into_bytes());
            }
        },
        Err(error) => {
            set_last_error(error.to_string());
            unsafe {
                *out = NieBytes::empty();
            }
        },
    }
}

/// Lit un fichier du VFS par son chemin interne (déchiffrement + décompression CPK inclus).
///
/// Retourne les octets bruts du fichier, ou [`NieBytes::empty`] si le fichier est absent
/// ou si une erreur d'extraction se produit. JS doit appeler [`nie_bytes_free`] après
/// consommation.
///
/// **Note Bun FFI** : préférer [`nie_vfs_read_out`].
///
/// # Safety
///
/// - `vfs` doit être un handle valide retourné par [`nie_vfs_open`], non encore libéré.
/// - `internal_path` doit être une C-string UTF-8 null-terminée valide.
/// - null sur l'un ou l'autre des deux paramètres → retourne empty.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_read(vfs: *mut c_void, internal_path: *const c_char) -> NieBytes {
    if vfs.is_null() || internal_path.is_null() {
        return NieBytes::empty();
    }
    // SAFETY: vfs provient de nie_vfs_open ; internal_path est null-terminé.
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    let path = match unsafe { std::ffi::CStr::from_ptr(internal_path) }.to_str() {
        Ok(s) => s,
        Err(_) => return NieBytes::empty(),
    };
    match vfs_ref.read(path) {
        Ok(v) => NieBytes::from_vec(v),
        Err(_) => NieBytes::empty(),
    }
}

/// Variante Bun-FFI-friendly de [`nie_vfs_read`] : écrit le résultat dans `*out`.
///
/// # Safety
///
/// Mêmes invariants que [`nie_vfs_read`], plus `out` non-null et aligné 8 octets.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_read_out(
    vfs: *mut c_void,
    internal_path: *const c_char,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    // SAFETY: délègue à nie_vfs_read qui gère les null.
    let result = unsafe { nie_vfs_read(vfs, internal_path) };
    // SAFETY: out est non-null et aligné.
    unsafe { out.write(result) };
}

/// Retourne un tableau JSON `[{path, cpk, size}]` des fichiers indexés dans le VFS.
///
/// Plafonné à [`VFS_LIST_CAP`] entrées (50 000) pour limiter l'utilisation mémoire.
/// Si le VFS contient plus d'entrées, les suivantes sont silencieusement omises.
/// Appelez `nie_vfs_read("data/relative/path")` pour accéder à tout fichier par nom.
///
/// **Note Bun FFI** : préférer [`nie_vfs_list_json_out`].
///
/// # Safety
///
/// - `vfs` doit être un handle valide retourné par [`nie_vfs_open`], non encore libéré.
/// - null → retourne empty.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_list_json(vfs: *mut c_void) -> NieBytes {
    if vfs.is_null() {
        return NieBytes::empty();
    }
    // SAFETY: vfs provient de nie_vfs_open.
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    let entries: Vec<_> = vfs_ref
        .iter()
        .take(VFS_LIST_CAP)
        .map(|(path, e)| {
            serde_json::json!({
                "path": path,
                "cpk":  e.cpk_filename,
                "size": e.file_size,
            })
        })
        .collect();
    match serde_json::to_vec(&entries) {
        Ok(v) => NieBytes::from_vec(v),
        Err(_) => NieBytes::empty(),
    }
}

/// Variante Bun-FFI-friendly de [`nie_vfs_list_json`] : écrit le résultat dans `*out`.
///
/// # Safety
///
/// Mêmes invariants que [`nie_vfs_list_json`], plus `out` non-null et aligné 8 octets.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_list_json_out(vfs: *mut c_void, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    // SAFETY: délègue à nie_vfs_list_json.
    let result = unsafe { nie_vfs_list_json(vfs) };
    // SAFETY: out est non-null et aligné.
    unsafe { out.write(result) };
}

/// Nombre total d'entrées indexées dans le VFS — sans plafond, contrairement à
/// [`nie_vfs_list_json`].
///
/// C'est la borne à utiliser pour paginer avec [`nie_vfs_list_range_json_out`].
///
/// # Safety
///
/// - `vfs` doit être un handle valide retourné par [`nie_vfs_open`], non encore libéré.
/// - null → retourne 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_count(vfs: *mut c_void) -> u64 {
    if vfs.is_null() {
        return 0;
    }
    // SAFETY: vfs provient de nie_vfs_open.
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    vfs_ref.iter().count() as u64
}

/// Dit si un chemin interne est réellement servable, **sans extraire son contenu**.
///
/// Délègue à [`aphrody_nie_formats::vfs::Vfs::is_readable`], donc tient compte des fichiers
/// « loose » que `cpk_list.cfg.bin` déclare sans qu'ils existent sur une installation
/// donnée : une simple présence dans l'index annoncerait des fichiers que
/// [`nie_vfs_read`] refuserait ensuite.
///
/// C'est le test qu'un consommateur interactif doit employer pour décider s'il peut
/// afficher un asset. L'alternative — appeler [`nie_vfs_read`] et regarder si le
/// tampon est vide — extrait le CPK entier pour répondre par oui ou par non, et
/// remplit le cache de paquets au passage : mesuré à 4,9 Go retenus pour soixante
/// vérifications de textures dispersées.
///
/// # Safety
///
/// - `vfs` doit être un handle valide retourné par [`nie_vfs_open`], non encore libéré.
/// - `internal_path` doit être une chaîne C null-terminée valide.
/// - null (l'un ou l'autre) → retourne 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_is_readable(
    vfs: *mut c_void,
    internal_path: *const c_char,
) -> u32 {
    if vfs.is_null() || internal_path.is_null() {
        return 0;
    }
    // SAFETY: vfs provient de nie_vfs_open ; internal_path est null-terminé.
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    let path = match unsafe { std::ffi::CStr::from_ptr(internal_path) }.to_str() {
        Ok(s) => s,
        Err(_) => return 0,
    };
    u32::from(vfs_ref.is_readable(path))
}

/// Occupation du cache CPK — miroir de `aphrody_nie_formats::vfs::CacheCpkStats`.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct NieCacheStats {
    /// Octets bruts actuellement retenus.
    pub octets: u64,
    /// Nombre de paquets CPK en cache.
    pub entrees: u64,
    /// Budget au-delà duquel l'éviction LRU se déclenche.
    pub budget: u64,
}

/// Écrit l'occupation du cache CPK dans `out`.
///
/// Le VFS garde les octets **bruts** de chaque paquet ouvert : quelques lectures dans des
/// paquets différents suffisent à retenir plusieurs centaines de mégaoctets. Un hôte qui
/// embarque cette bibliothèque — un jeu, par exemple — a besoin de le voir pour décider, et le
/// budget par défaut (16 Gio) est dimensionné pour un traitement par lots, pas pour lui.
///
/// # Safety
///
/// - `vfs` doit provenir de [`nie_vfs_open`] et ne pas avoir été libéré ; null est un no-op.
/// - `out` doit pointer un [`NieCacheStats`] inscriptible.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_cache_stats(vfs: *mut c_void, out: *mut NieCacheStats) {
    if vfs.is_null() || out.is_null() {
        return;
    }
    // SAFETY: vfs provient de nie_vfs_open ; out est inscriptible par contrat.
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    let s = vfs_ref.cache_stats();
    unsafe {
        *out = NieCacheStats {
            octets: s.octets as u64,
            entrees: s.entrees as u64,
            budget: s.budget as u64,
        };
    }
}

/// Vide le cache CPK et rend les octets libérés.
///
/// Sans danger pour les lectures en cours : chacune détient sa donnée par `Arc` jusqu'à la fin
/// de l'extraction. Les lectures suivantes relisent le paquet depuis le disque.
///
/// # Safety
///
/// `vfs` doit provenir de [`nie_vfs_open`] et ne pas avoir été libéré ; null rend 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_cache_vider(vfs: *mut c_void) -> u64 {
    if vfs.is_null() {
        return 0;
    }
    // SAFETY: vfs provient de nie_vfs_open.
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    vfs_ref.vider_cache() as u64
}

/// Change le budget du cache CPK et évince immédiatement ce qui dépasse.
///
/// Rend les octets libérés par l'éviction déclenchée. L'éviction garde toujours un paquet :
/// évincer celui qu'on vient de demander ferait relire le disque au prochain appel, en boucle.
///
/// # Safety
///
/// `vfs` doit provenir de [`nie_vfs_open`] et ne pas avoir été libéré ; null rend 0.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_cache_budget(vfs: *mut c_void, budget: u64) -> u64 {
    if vfs.is_null() {
        return 0;
    }
    // SAFETY: vfs provient de nie_vfs_open.
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    vfs_ref.regler_budget_cache(usize::try_from(budget).unwrap_or(usize::MAX)) as u64
}

/// Tranche `[offset, offset + limit)` de l'index VFS, en JSON `[{path, cpk, size}]`.
///
/// Complète [`nie_vfs_list_json`], dont le plafond de 50 000 entrées tronque **en silence**
/// un VFS qui en compte ~255 000 : paginer avec cette fonction permet d'énumérer la totalité
/// de l'index sans jamais matérialiser plus d'une page en mémoire. L'ordre d'itération est
/// celui de [`aphrody_nie_formats::vfs::Vfs::iter`] : stable pour un même handle, non trié.
///
/// `limit == 0` renvoie un tableau vide ; un `offset` au-delà de la fin aussi.
///
/// # Safety
///
/// - `vfs` doit être un handle valide retourné par [`nie_vfs_open`], non encore libéré.
/// - `out` non-null et aligné 8 octets.
/// - null → écrit un `NieBytes` vide.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_list_range_json_out(
    vfs: *mut c_void,
    offset: u64,
    limit: u64,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if vfs.is_null() {
        // SAFETY: out est non-null et aligné.
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    // SAFETY: vfs provient de nie_vfs_open.
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    let entries: Vec<_> = vfs_ref
        .iter()
        .skip(usize::try_from(offset).unwrap_or(usize::MAX))
        .take(usize::try_from(limit).unwrap_or(usize::MAX))
        .map(|(path, e)| {
            serde_json::json!({
                "path": path,
                "cpk":  e.cpk_filename,
                "size": e.file_size,
            })
        })
        .collect();
    let result = match serde_json::to_vec(&entries) {
        Ok(v) => NieBytes::from_vec(v),
        Err(_) => NieBytes::empty(),
    };
    // SAFETY: out est non-null et aligné.
    unsafe { out.write(result) };
}

type DomainRecords = std::collections::HashMap<String, Vec<serde_json::Value>>;
type DomainCache = std::collections::HashMap<usize, DomainRecords>;
static VFS_DOMAIN_CACHE: std::sync::OnceLock<std::sync::Mutex<DomainCache>> =
    std::sync::OnceLock::new();

fn cached_vfs_query(
    vfs: &aphrody_nie_formats::vfs::Vfs,
    request: &serde_json::Value,
) -> Option<serde_json::Value> {
    let domain = request.get("domain").and_then(serde_json::Value::as_str).unwrap_or("characters");
    let key = std::ptr::from_ref(vfs) as usize;
    let mut cache = VFS_DOMAIN_CACHE.get_or_init(Default::default).lock().ok()?;
    let domains = cache.entry(key).or_default();
    if let std::collections::hash_map::Entry::Vacant(entry) = domains.entry(domain.to_owned()) {
        let records = aphrody_nie_app::game_data::load_domain_records(vfs, domain).ok()?;
        entry.insert(records);
    }
    aphrody_nie_app::game_data::query_records(domain, domains.get(domain)?, request).ok()
}

/// Query native game collections through the mounted VFS.
/// The JSON request uses `domain`, optional filters, `offset` and bounded `limit`.
/// The result contains `source`, `domain`, `total`, `matched`, `offset` and `items`.
///
/// # Safety
/// The handle must be valid and live; input must address `input_len` readable bytes,
/// and `out` must address an aligned writable [`NieBytes`]. Null inputs return empty bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_query_json_out(
    vfs: *mut c_void,
    input: *const u8,
    input_len: usize,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    let result = if vfs.is_null() || input.is_null() || input_len == 0 {
        NieBytes::empty()
    } else {
        // SAFETY: the caller guarantees the live handle and readable input range.
        let mounted = unsafe { &*vfs.cast::<aphrody_nie_formats::vfs::Vfs>() };
        let bytes = unsafe { core::slice::from_raw_parts(input, input_len) };
        serde_json::from_slice(bytes)
            .ok()
            .and_then(|request| cached_vfs_query(mounted, &request))
            .and_then(|value| serde_json::to_vec(&value).ok())
            .map(NieBytes::from_vec)
            .unwrap_or_else(NieBytes::empty)
    };
    // SAFETY: the caller guarantees the aligned writable output slot.
    unsafe { out.write(result) };
}

/// Libère un handle VFS retourné par [`nie_vfs_open`].
///
/// # Safety
///
/// - Appeler **exactement une fois** par handle non-null.
/// - null → no-op.
/// - Après l'appel, tout usage du handle est un comportement indéfini.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_free(vfs: *mut c_void) {
    if vfs.is_null() {
        return;
    }
    // SAFETY: vfs provient de nie_vfs_open → Box<Vfs> ; appelé exactement une fois.
    if let Some(cache) = VFS_DOMAIN_CACHE.get() {
        // Clear even a poisoned cache so a reused allocation cannot inherit stale records.
        cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&(vfs as usize));
    }
    unsafe { drop(Box::from_raw(vfs.cast::<aphrody_nie_formats::vfs::Vfs>())) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Police — rendu de texte (couche 4) : métriques font.cfg.bin + atlas font.g4tx
// ─────────────────────────────────────────────────────────────────────────────

/// Chemin VFS des métriques de glyphes (T2B).
const FONT_METRICS_PATH: &str = "data/common/font/font/font_def/font.cfg.bin";
/// Chemin VFS de l'atlas de police (DDS BGRA8 non compressé, 4096×2048).
const FONT_ATLAS_PATH: &str = "data/dx11/font/font_def/font.g4tx";
/// Décalage des pixels mip0 dans le payload DDS (magic 4 + DDS_HEADER 124, sans ext DX10).
const FONT_DDS_PIXEL_OFFSET: usize = 128;

/// Contexte de police chargé : métriques + atlas BGRA8, prêt pour le rendu répété.
///
/// Construit une fois par [`nie_font_open`] pour éviter de relire/reparser l'atlas de
/// ~33 Mo à chaque rendu.
struct FontCtx {
    metrics: aphrody_nie_formats::font::FontMetrics,
    atlas: Vec<u8>,
    atlas_w: u32,
}

/// Construit un [`FontCtx`] depuis un VFS monté (lecture + parse métriques et atlas).
fn build_font_ctx(vfs: &aphrody_nie_formats::vfs::Vfs) -> Option<FontCtx> {
    let cfg_bytes = vfs.read(FONT_METRICS_PATH).ok()?;
    let cfg = aphrody_nie_formats::cfgbin::parse_t2b(&cfg_bytes).ok()?;
    let metrics = aphrody_nie_formats::font::parse_metrics(&cfg);
    if metrics.dims.cell_height == 0 {
        return None;
    }
    let g4tx_bytes = vfs.read(FONT_ATLAS_PATH).ok()?;
    let g4tx = aphrody_nie_formats::g4tx::parse(&g4tx_bytes).ok()?;
    let tex = g4tx.textures.first()?;
    if !tex.is_dds || tex.width <= 0 {
        return None;
    }
    let start = tex.data_offset + FONT_DDS_PIXEL_OFFSET;
    let atlas = g4tx_bytes.get(start..)?.to_vec();
    Some(FontCtx { metrics, atlas, atlas_w: tex.width as u32 })
}

/// Implémentation commune : rend `text` sur un canevas RGBA8 ajusté puis encode en PNG.
fn render_text_impl(ctx: &FontCtx, text: &str, color: [u8; 4]) -> NieBytes {
    use std::io::Cursor;
    let ascent = i32::from(ctx.metrics.dims.ascent);
    let cell_h = ctx.metrics.dims.cell_height as usize;
    if cell_h == 0 {
        return NieBytes::empty();
    }
    // Mesure : largeur = max(avance cumulée, extrémité droite du dernier glyphe tracé).
    let mut pen = 0i32;
    let mut max_x = 0i32;
    for c in text.chars() {
        if let Some(m) = ctx.metrics.glyph(c as u32) {
            max_x = max_x.max(pen + i32::from(m.bearing_x) + i32::from(m.width));
            pen += i32::from(m.advance);
        }
    }
    let width = max_x.max(pen).max(1) as usize;
    let mut canvas = vec![0u8; width * cell_h * 4];
    aphrody_nie_formats::font::draw_text(
        &ctx.atlas,
        ctx.atlas_w,
        &ctx.metrics,
        text,
        &mut canvas,
        (width * 4) as u32,
        0,
        ascent,
        color,
    );
    let img = match image::RgbaImage::from_raw(width as u32, cell_h as u32, canvas) {
        Some(i) => i,
        None => return NieBytes::empty(),
    };
    let mut png: Vec<u8> = Vec::new();
    if img.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).is_err() {
        return NieBytes::empty();
    }
    NieBytes::from_vec(png)
}

/// Ouvre un contexte de police depuis un VFS monté (charge + parse métriques et atlas).
///
/// Lit `font.cfg.bin` (métriques T2B) et `font.g4tx` (atlas DDS BGRA8) du VFS, les parse
/// une fois, et retourne un handle réutilisable pour [`nie_font_render_text`]. Évite de
/// relire/reparser l'atlas de ~33 Mo à chaque rendu.
///
/// Retourne null si `vfs` est null, si un fichier de police est absent, ou si le parse
/// échoue. Libérer avec [`nie_font_free`] **exactement une fois**.
///
/// # Safety
///
/// - `vfs` doit être un handle valide retourné par [`nie_vfs_open`], non encore libéré.
/// - null → retourne null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_font_open(vfs: *mut c_void) -> *mut c_void {
    if vfs.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: vfs provient de nie_vfs_open.
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    match build_font_ctx(vfs_ref) {
        Some(ctx) => Box::into_raw(Box::new(ctx)).cast(),
        None => core::ptr::null_mut(),
    }
}

/// Rend une chaîne UTF-8 avec la police du jeu → octets PNG RGBA8 (fond transparent).
///
/// La couleur de teinte `(r, g, b, a)` module le masque alpha des glyphes (blanc opaque =
/// `255, 255, 255, 255`). Le canevas a la hauteur d'une cellule (`cell_height`, 71 px pour
/// la police principale) et la largeur de l'avance totale du texte. Les points de code
/// absents de la police principale sont ignorés.
///
/// Retourne [`NieBytes::empty`] si `ctx`/`text` est null, si `text` n'est pas de l'UTF-8
/// valide, ou en cas d'erreur d'encodage. JS doit appeler [`nie_bytes_free`] /
/// [`nie_bytes_free_fields`] après consommation.
///
/// **Note Bun FFI** : préférer [`nie_font_render_text_out`] (évite le sret 24 octets).
///
/// # Safety
///
/// - `ctx` doit être un handle valide retourné par [`nie_font_open`], non encore libéré.
/// - `text` doit être une C-string UTF-8 null-terminée valide.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_font_render_text(
    ctx: *mut c_void,
    text: *const c_char,
    r: u8,
    g: u8,
    b: u8,
    a: u8,
) -> NieBytes {
    if ctx.is_null() || text.is_null() {
        return NieBytes::empty();
    }
    // SAFETY: ctx provient de nie_font_open ; text est null-terminé.
    let ctx_ref = unsafe { &*(ctx.cast::<FontCtx>()) };
    let s = match unsafe { std::ffi::CStr::from_ptr(text) }.to_str() {
        Ok(s) => s,
        Err(_) => return NieBytes::empty(),
    };
    render_text_impl(ctx_ref, s, [r, g, b, a])
}

/// Variante Bun-FFI-friendly de [`nie_font_render_text`] : écrit le résultat dans `*out`.
///
/// # Safety
///
/// Mêmes invariants que [`nie_font_render_text`], plus `out` non-null et aligné 8 octets.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_font_render_text_out(
    ctx: *mut c_void,
    text: *const c_char,
    r: u8,
    g: u8,
    b: u8,
    a: u8,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    // SAFETY: délègue à nie_font_render_text qui gère les null.
    let result = unsafe { nie_font_render_text(ctx, text, r, g, b, a) };
    // SAFETY: out est non-null et aligné.
    unsafe { out.write(result) };
}

/// Libère un contexte de police retourné par [`nie_font_open`].
///
/// # Safety
///
/// - Appeler **exactement une fois** par handle non-null.
/// - null → no-op.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_font_free(ctx: *mut c_void) {
    if ctx.is_null() {
        return;
    }
    // SAFETY: ctx provient de nie_font_open → Box<FontCtx> ; appelé exactement une fois.
    unsafe { drop(Box::from_raw(ctx.cast::<FontCtx>())) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Moteur de match (`aphrody-nie-runtime`) — la simulation, pilotable depuis l'extérieur
// ─────────────────────────────────────────────────────────────────────────────
//
// Tout ce qui précède LIT le jeu (assets, formats, VFS). Ce bloc le fait TOURNER : il expose
// `aphrody_nie_runtime::World`, la simulation 11 v 11 déterministe, pour qu'un hôte non-Rust — la lib
// Python `niepy`, et donc Ren'Py — puisse avancer un match tick par tick et lire son état.
//
// Le déterminisme est le contrat : à `dt` et entrées identiques, deux exécutions donnent la
// même suite d'états. C'est ce qui permet à un visual novel de rejouer une action à l'identique.

/// Handle opaque de monde de match, alloué par [`nie_world_new`].
///
/// Le type réel est `aphrody_nie_runtime::World` ; l'hôte ne le manipule que par ce pointeur.
pub struct NieWorld {
    _priv: [u8; 0],
}

/// Un joueur, aplati en `repr(C)` pour la frontière.
///
/// Les positions sont en mètres, origine au centre du terrain
/// (demi-longueur [`aphrody_nie_runtime::HALF_LEN`], demi-largeur [`aphrody_nie_runtime::HALF_WID`]).
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct NiePlayer {
    /// Position au sol, axe but-à-but.
    pub x: f32,
    /// Position au sol, axe touche-à-touche.
    pub y: f32,
    /// Vitesse au sol, composante `x` (m/s).
    pub vx: f32,
    /// Vitesse au sol, composante `y` (m/s).
    pub vy: f32,
    /// Équipe : `0` = domicile (attaque vers `+x`), `1` = extérieur.
    pub team: u8,
    /// Rôle : `0` gardien, `1` défenseur, `2` milieu, `3` attaquant.
    pub role: u8,
}

/// Le ballon, aplati en `repr(C)`. `z` est la **hauteur** (convention `aphrody-nie-runtime`).
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct NieBall {
    /// Position, axe but-à-but.
    pub x: f32,
    /// Position, axe touche-à-touche.
    pub y: f32,
    /// Hauteur au-dessus du sol.
    pub z: f32,
    /// Vitesse, composante `x` (m/s).
    pub vx: f32,
    /// Vitesse, composante `y` (m/s).
    pub vy: f32,
    /// Vitesse verticale (m/s).
    pub vz: f32,
}

/// Crée un monde de match au coup d'envoi (22 joueurs + ballon, un gardien par camp).
///
/// Rend un handle à libérer **exactement une fois** par [`nie_world_free`].
#[unsafe(no_mangle)]
pub extern "C" fn nie_world_new() -> *mut NieWorld {
    let w = Box::new(aphrody_nie_runtime::World::kickoff());
    Box::into_raw(w).cast::<NieWorld>()
}

/// Remet le monde au coup d'envoi, sans réallouer le handle.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] et ne pas avoir été libéré.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_kickoff(w: *mut NieWorld) {
    if w.is_null() {
        return;
    }
    // SAFETY: w provient de nie_world_new → Box<World>, encore vivant par contrat.
    let world = unsafe { &mut *w.cast::<aphrody_nie_runtime::World>() };
    *world = aphrody_nie_runtime::World::kickoff();
}

/// Avance la simulation de `dt` secondes.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] et ne pas avoir été libéré.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_step(w: *mut NieWorld, dt: f32) {
    if w.is_null() {
        return;
    }
    // SAFETY: idem nie_world_kickoff.
    let world = unsafe { &mut *w.cast::<aphrody_nie_runtime::World>() };
    world.step(dt);
}

/// Pose l'entrée du joueur contrôlé : direction souhaitée et ordre de frappe.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] et ne pas avoir été libéré.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_set_input(w: *mut NieWorld, dx: f32, dy: f32, shoot: bool) {
    if w.is_null() {
        return;
    }
    // SAFETY: idem nie_world_kickoff.
    let world = unsafe { &mut *w.cast::<aphrody_nie_runtime::World>() };
    // Affectation champ par champ : évite de nommer `aphrody_nie_geom::Vec2` ici, donc évite d'ajouter
    // une dépendance à ce crate juste pour construire deux flottants.
    world.input.dir.x = dx;
    world.input.dir.y = dy;
    world.input.shoot = shoot;
}

/// Nombre de joueurs sur le terrain (22 au coup d'envoi). `0` si `w` est null.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] et ne pas avoir été libéré.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_player_count(w: *const NieWorld) -> usize {
    if w.is_null() {
        return 0;
    }
    // SAFETY: w provient de nie_world_new ; lecture partagée.
    let world = unsafe { &*w.cast::<aphrody_nie_runtime::World>() };
    world.players.len()
}

/// Copie le joueur d'indice `i` dans `out`. Rend `false` si `i` est hors bornes.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] ; `out` doit pointer un [`NiePlayer`] inscriptible.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_player(
    w: *const NieWorld,
    i: usize,
    out: *mut NiePlayer,
) -> bool {
    if w.is_null() || out.is_null() {
        return false;
    }
    // SAFETY: w provient de nie_world_new ; lecture partagée.
    let world = unsafe { &*w.cast::<aphrody_nie_runtime::World>() };
    let Some(p) = world.players.get(i) else {
        return false;
    };
    let role = match p.role {
        aphrody_nie_runtime::Role::Goalkeeper => 0,
        aphrody_nie_runtime::Role::Defender => 1,
        aphrody_nie_runtime::Role::Midfielder => 2,
        aphrody_nie_runtime::Role::Forward => 3,
    };
    // SAFETY: out est un NiePlayer inscriptible par contrat.
    unsafe {
        *out = NiePlayer { x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y, team: p.team, role };
    }
    true
}

/// Copie l'état du ballon dans `out`.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] ; `out` doit pointer un [`NieBall`] inscriptible.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_ball(w: *const NieWorld, out: *mut NieBall) {
    if w.is_null() || out.is_null() {
        return;
    }
    // SAFETY: w provient de nie_world_new ; lecture partagée.
    let world = unsafe { &*w.cast::<aphrody_nie_runtime::World>() };
    let b = &world.ball;
    // SAFETY: out est un NieBall inscriptible par contrat.
    unsafe {
        *out =
            NieBall { x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z };
    }
}

/// Écrit le score dans `home` et `away` (chacun optionnel — un pointeur null est ignoré).
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] ; `home`/`away` sont null ou inscriptibles.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_score(w: *const NieWorld, home: *mut u32, away: *mut u32) {
    if w.is_null() {
        return;
    }
    // SAFETY: w provient de nie_world_new ; lecture partagée.
    let world = unsafe { &*w.cast::<aphrody_nie_runtime::World>() };
    if !home.is_null() {
        // SAFETY: non-null et inscriptible par contrat.
        unsafe { *home = world.score[0] };
    }
    if !away.is_null() {
        // SAFETY: non-null et inscriptible par contrat.
        unsafe { *away = world.score[1] };
    }
}

/// Temps de jeu écoulé, en secondes. `0.0` si `w` est null.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] et ne pas avoir été libéré.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_time(w: *const NieWorld) -> f32 {
    if w.is_null() {
        return 0.0;
    }
    // SAFETY: w provient de nie_world_new ; lecture partagée.
    unsafe { &*w.cast::<aphrody_nie_runtime::World>() }.time
}

/// Numéro du tick courant — le compteur qui atteste du déterminisme. `0` si `w` est null.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] et ne pas avoir été libéré.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_tick(w: *const NieWorld) -> u64 {
    if w.is_null() {
        return 0;
    }
    // SAFETY: w provient de nie_world_new ; lecture partagée.
    unsafe { &*w.cast::<aphrody_nie_runtime::World>() }.tick
}

/// Indice du joueur qui possède le ballon, ou `-1` si personne ne l'a.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] et ne pas avoir été libéré.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_possessor(w: *const NieWorld) -> isize {
    if w.is_null() {
        return -1;
    }
    // SAFETY: w provient de nie_world_new ; lecture partagée.
    let world = unsafe { &*w.cast::<aphrody_nie_runtime::World>() };
    world.possessor().map_or(-1, |i| i as isize)
}

/// État complet du monde en JSON UTF-8 — la voie pratique pour un hôte scripté.
///
/// Forme : `{"tick","time","score":[h,a],"possessor","ball":{…},"players":[{…}]}`.
/// L'hôte DOIT libérer le tampon par [`nie_bytes_free`] / [`nie_bytes_free_fields`].
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] ; `out` doit pointer un [`NieBytes`] inscriptible.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_snapshot_json_out(w: *const NieWorld, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    if w.is_null() {
        // SAFETY: out non-null et inscriptible par contrat.
        unsafe { *out = NieBytes::empty() };
        return;
    }
    // SAFETY: w provient de nie_world_new ; lecture partagée.
    let world = unsafe { &*w.cast::<aphrody_nie_runtime::World>() };
    let players: Vec<serde_json::Value> = world
        .players
        .iter()
        .map(|p| {
            serde_json::json!({
                "x": p.pos.x, "y": p.pos.y,
                "vx": p.vel.x, "vy": p.vel.y,
                "team": p.team,
                "role": match p.role {
                    aphrody_nie_runtime::Role::Goalkeeper => "GK",
                    aphrody_nie_runtime::Role::Defender => "DF",
                    aphrody_nie_runtime::Role::Midfielder => "MF",
                    aphrody_nie_runtime::Role::Forward => "FW",
                },
            })
        })
        .collect();
    let snap = serde_json::json!({
        "tick": world.tick,
        "time": world.time,
        "score": [world.score[0], world.score[1]],
        "possessor": world.possessor().map_or(-1, |i| i as isize),
        "ball": {
            "x": world.ball.pos.x, "y": world.ball.pos.y, "z": world.ball.pos.z,
            "vx": world.ball.vel.x, "vy": world.ball.vel.y, "vz": world.ball.vel.z,
        },
        "players": players,
    });
    let bytes = serde_json::to_vec(&snap).unwrap_or_default();
    // SAFETY: out non-null et inscriptible par contrat.
    unsafe { *out = NieBytes::from_vec(bytes) };
}

/// Libère un handle de monde.
///
/// # Safety
///
/// `w` doit provenir de [`nie_world_new`] et n'être libéré **qu'une fois**. Null est un no-op.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_world_free(w: *mut NieWorld) {
    if w.is_null() {
        return;
    }
    // SAFETY: w provient de nie_world_new → Box<World> ; appelé exactement une fois.
    unsafe { drop(Box::from_raw(w.cast::<aphrody_nie_runtime::World>())) };
}

// ============================================================================
// Simulation de match — à graine et à statistiques
// ============================================================================

/// Simule une rencontre complète et rend le résultat en JSON UTF-8.
///
/// C'est le complément du bloc `nie_world_*`, et il répond à un autre besoin.
/// `nie_world_*` fait TOURNER un match jouable : on lui pousse des entrées et on
/// l'avance pas à pas. Il n'accepte aucune graine et son onze est le sien — deux
/// matchs laissés à eux-mêmes rendent le même score, et rien ne distingue les
/// joueurs d'un camp de ceux de l'autre.
///
/// [`aphrody_nie_core::match_sim::simulate_match`] fait l'inverse : il tranche une
/// rencontre d'un bloc, à partir des STATISTIQUES des deux équipes et d'une
/// GRAINE. C'est ce qu'un récit demande — un match que le joueur ne dispute pas,
/// dont le résultat dépend de la force des effectifs et se rejoue à l'identique.
///
/// `home_json` et `away_json` sont des `TeamSetup` sérialisés :
///
/// ```json
/// {"name": "Raimon", "aggregate_stats": {"kc":207,"cr":216,"tc":218,
///  "pr":235,"ps":242,"ag":210,"it":261}, "placements": null}
/// ```
///
/// La sortie est un `MatchResult` : `home_score`, `away_score`, `final_clock`
/// (`minutes * 10_000 + secondes`) et la séquence complète d'`events`.
///
/// `NieBytes::empty` en sortie signale une entrée illisible — JSON invalide,
/// champ manquant, ou pointeur nul.
///
/// # Safety
///
/// - `home_json` et `away_json` doivent être des chaînes C null-terminées valides.
/// - `out` doit pointer sur un `NieBytes` inscriptible et aligné.
/// - null (n'importe lequel) → `NieBytes::empty`, aucun effet.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_match_simulate_json_out(
    home_json: *const c_char,
    away_json: *const c_char,
    seed: u64,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if home_json.is_null() || away_json.is_null() {
        // SAFETY: out est non-null et aligné.
        unsafe { out.write(NieBytes::empty()) };
        return;
    }

    // SAFETY: les deux pointeurs sont non-null et null-terminés.
    let (home_str, away_str) = unsafe {
        (std::ffi::CStr::from_ptr(home_json).to_str(), std::ffi::CStr::from_ptr(away_json).to_str())
    };

    let resultat = (|| -> Option<Vec<u8>> {
        let home: aphrody_nie_core::match_sim::TeamSetup =
            serde_json::from_str(home_str.ok()?).ok()?;
        let away: aphrody_nie_core::match_sim::TeamSetup =
            serde_json::from_str(away_str.ok()?).ok()?;
        let issue = aphrody_nie_core::match_sim::simulate_match(home, away, seed);
        serde_json::to_vec(&issue).ok()
    })();

    let sortie = match resultat {
        Some(v) => NieBytes::from_vec(v),
        None => NieBytes::empty(),
    };
    // SAFETY: out est non-null et aligné.
    unsafe { out.write(sortie) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics & Info
// ─────────────────────────────────────────────────────────────────────────────

/// Efface le dernier message d'erreur thread-local enregistré.
#[unsafe(no_mangle)]
pub extern "C" fn nie_clear_error() {
    LAST_ERROR.with(|err| {
        *err.borrow_mut() = None;
    });
}

/// Écrit le dernier message d'erreur thread-local dans `out`.
///
/// # Safety
///
/// `out` doit pointer vers un [`NieBytes`] inscriptible et aligné.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_last_error_out(out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    let res = LAST_ERROR
        .with(|err| err.borrow().as_ref().map(|s| NieBytes::from_vec(s.as_bytes().to_vec())))
        .unwrap_or_else(NieBytes::empty);
    unsafe { out.write(res) };
}

/// Retourne les informations de compilation, plateforme et capacités du moteur en JSON UTF-8.
///
/// # Safety
///
/// `out` doit pointer vers un [`NieBytes`] inscriptible et aligné.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_build_info_json_out(out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    let info = serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "product": "iecode",
        "abiVersion": 1,
        "capabilities": [
            "crc32",
            "crc32_nie",
            "crand",
            "cpk",
            "crilayla",
            "cfgbin",
            "g4tx",
            "vfs",
            "save",
            "font",
            "match_sim",
            "world_runtime",
            "wiki_query",
            "emu_registry"
        ],
        "targetOs": std::env::consts::OS,
        "targetArch": std::env::consts::ARCH,
    });
    let bytes = serde_json::to_vec(&info).unwrap_or_default();
    unsafe { out.write(NieBytes::from_vec(bytes)) };
}

/// Détecte le format d'un tampon et retourne un code discriminant stable (alias de [`nie_detect`]).
///
/// # Safety
///
/// Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_probe_header(ptr: *const u8, len: usize) -> u32 {
    unsafe { nie_detect(ptr, len) }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRI CPK & CRILAYLA
// ─────────────────────────────────────────────────────────────────────────────

/// Dérive la clé de déchiffrement CPK depuis le nom de fichier (nom de base).
///
/// # Safety
///
/// `name` doit être une C-string UTF-8 null-terminée valide, ou null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cpk_key_from_filename(name: *const c_char) -> u32 {
    if name.is_null() {
        return 0;
    }
    let s = match unsafe { CStr::from_ptr(name) }.to_str() {
        Ok(v) => v,
        Err(_) => return 0,
    };
    let base = s.rsplit(['/', '\\']).next().unwrap_or(s);
    aphrody_nie_formats::cpk::key_from_filename(base)
}

/// Déchiffre (ou chiffre) en place un bloc CPK avec clé positionnelle CRI.
///
/// # Safety
///
/// `buf` doit pointer vers au moins `len` octets mutables valides si `len > 0`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cpk_decrypt_block(
    buf: *mut u8,
    len: usize,
    file_offset: u64,
    key: u32,
) {
    if buf.is_null() || len == 0 {
        return;
    }
    let slice = unsafe { core::slice::from_raw_parts_mut(buf, len) };
    aphrody_nie_formats::cpk::decrypt_block(slice, file_offset, key);
}

/// Vérifie si les données commencent par le magic `CRILAYLA`.
///
/// # Safety
///
/// Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crilayla_is_compressed(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len < 8 {
        return 0;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    u32::from(aphrody_nie_formats::crilayla::has_magic(data))
}

/// Décompresse un flux CRILAYLA vers des octets bruts alloués en [`NieBytes`].
///
/// # Safety
///
/// Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crilayla_decompress(ptr: *const u8, len: usize) -> NieBytes {
    if ptr.is_null() || len == 0 {
        return NieBytes::empty();
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    match aphrody_nie_formats::crilayla::decompress(data) {
        Ok(v) => NieBytes::from_vec(v),
        Err(e) => {
            set_last_error(format!("crilayla decompress error: {e}"));
            NieBytes::empty()
        },
    }
}

/// Variante Bun-FFI-friendly de [`nie_crilayla_decompress`] écrivant dans `*out`.
///
/// # Safety
///
/// `ptr` et `out` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crilayla_decompress_out(
    ptr: *const u8,
    len: usize,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    let res = unsafe { nie_crilayla_decompress(ptr, len) };
    unsafe { out.write(res) };
}

/// Compresse un tampon en flux CRILAYLA standard avec raw header block et bitstream inversé.
pub fn compress_crilayla(data: &[u8]) -> Vec<u8> {
    const RAW_BLOCK_SIZE: usize = 0x100;
    let (raw_block, payload) = if data.len() >= RAW_BLOCK_SIZE {
        (&data[..RAW_BLOCK_SIZE], &data[RAW_BLOCK_SIZE..])
    } else {
        (data, &[][..])
    };

    struct BitWriter {
        bytes: Vec<u8>,
        current: u8,
        bits_used: u32,
    }
    impl BitWriter {
        fn new() -> Self {
            Self { bytes: Vec::new(), current: 0, bits_used: 0 }
        }
        fn push_bit(&mut self, bit: u8) {
            self.current = (self.current << 1) | (bit & 1);
            self.bits_used += 1;
            if self.bits_used == 8 {
                self.bytes.push(self.current);
                self.current = 0;
                self.bits_used = 0;
            }
        }
        fn push_bits(&mut self, val: u32, n: u32) {
            for i in (0..n).rev() {
                self.push_bit(((val >> i) & 1) as u8);
            }
        }
        fn finish(mut self) -> Vec<u8> {
            if self.bits_used > 0 {
                self.current <<= 8 - self.bits_used;
                self.bytes.push(self.current);
            }
            self.bytes
        }
    }

    let mut bw = BitWriter::new();
    for &byte in payload.iter().rev() {
        bw.push_bit(0); // 0 = octet littéral
        bw.push_bits(byte as u32, 8);
    }
    let mut bitstream = bw.finish();
    bitstream.reverse();

    let uncompressed_size = payload.len() as u32;
    let header_offset = bitstream.len() as u32;

    let mut out = Vec::with_capacity(16 + bitstream.len() + RAW_BLOCK_SIZE);
    out.extend_from_slice(b"CRILAYLA");
    out.extend_from_slice(&uncompressed_size.to_le_bytes());
    out.extend_from_slice(&header_offset.to_le_bytes());
    out.extend_from_slice(&bitstream);
    out.extend_from_slice(raw_block);
    if raw_block.len() < RAW_BLOCK_SIZE {
        out.resize(out.len() + (RAW_BLOCK_SIZE - raw_block.len()), 0);
    }
    out
}

/// Compresse un tampon en flux CRILAYLA et retourne un [`NieBytes`].
///
/// # Safety
///
/// Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crilayla_compress(ptr: *const u8, len: usize) -> NieBytes {
    if ptr.is_null() || len == 0 {
        return NieBytes::empty();
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    NieBytes::from_vec(compress_crilayla(data))
}

/// Variante Bun-FFI-friendly de [`nie_crilayla_compress`] écrivant dans `*out`.
///
/// # Safety
///
/// `ptr` et `out` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_crilayla_compress_out(ptr: *const u8, len: usize, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    let res = unsafe { nie_crilayla_compress(ptr, len) };
    unsafe { out.write(res) };
}

/// Vérifie si le tampon est une archive CPK valide (en clair).
///
/// # Safety
///
/// Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cpk_probe(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len < 16 {
        return 0;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    if data.starts_with(b"CPK ") { 1 } else { 0 }
}

/// Analyse l'en-tête CPK et écrit les métadonnées de base en JSON dans `*out`.
///
/// # Safety
///
/// `ptr`, `filename` et `out` doivent être valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cpk_header_json_out(
    ptr: *const u8,
    len: usize,
    filename: *const c_char,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len < 16 {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let fname = if filename.is_null() {
        ""
    } else {
        unsafe { CStr::from_ptr(filename) }.to_str().unwrap_or("")
    };
    let base = fname.rsplit(['/', '\\']).next().unwrap_or(fname);
    let json_bytes = (|| -> Option<Vec<u8>> {
        let reader = aphrody_nie_formats::cpk::CpkReader::new(data, base).ok()?;
        let val = serde_json::json!({
            "isEncrypted": reader.is_encrypted,
            "fileKey": reader.file_key,
            "entryCount": reader.entries.len(),
        });
        serde_json::to_vec(&val).ok()
    })();
    let res = match json_bytes {
        Some(b) => NieBytes::from_vec(b),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

/// Énumère la liste complète des fichiers d'une archive CPK en JSON dans `*out`.
///
/// # Safety
///
/// `ptr`, `filename` et `out` doivent être valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cpk_list_json_out(
    ptr: *const u8,
    len: usize,
    filename: *const c_char,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len < 16 {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let fname = if filename.is_null() {
        ""
    } else {
        unsafe { CStr::from_ptr(filename) }.to_str().unwrap_or("")
    };
    let base = fname.rsplit(['/', '\\']).next().unwrap_or(fname);
    let json_bytes = (|| -> Option<Vec<u8>> {
        let reader = aphrody_nie_formats::cpk::CpkReader::new(data, base).ok()?;
        let entries: Vec<serde_json::Value> = reader
            .entries
            .iter()
            .enumerate()
            .map(|(idx, e)| {
                serde_json::json!({
                    "index": idx,
                    "id": idx as u64,
                    "name": e.filename,
                    "dirName": e.directory,
                    "offset": e.offset,
                    "size": e.size,
                    "extractSize": e.extract_size,
                    "isCompressed": e.is_compressed,
                })
            })
            .collect();
        let val = serde_json::json!({
            "isEncrypted": reader.is_encrypted,
            "fileKey": reader.file_key,
            "count": reader.entries.len(),
            "entries": entries,
        });
        serde_json::to_vec(&val).ok()
    })();
    let res = match json_bytes {
        Some(b) => NieBytes::from_vec(b),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

/// Extrait une entrée CPK par son indice ordinal vers `*out`.
///
/// # Safety
///
/// `ptr`, `filename` et `out` doivent être valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cpk_extract_entry_out(
    ptr: *const u8,
    len: usize,
    filename: *const c_char,
    entry_index: usize,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len < 16 {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let fname = if filename.is_null() {
        ""
    } else {
        unsafe { CStr::from_ptr(filename) }.to_str().unwrap_or("")
    };
    let base = fname.rsplit(['/', '\\']).next().unwrap_or(fname);
    let extracted = (|| -> Option<Vec<u8>> {
        let reader = aphrody_nie_formats::cpk::CpkReader::new(data, base).ok()?;
        let entry = reader.entries.get(entry_index)?;
        reader.extract(data, entry).ok()
    })();
    let res = match extracted {
        Some(v) => NieBytes::from_vec(v),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

/// Extrait une entrée CPK par son nom interne vers `*out`.
///
/// # Safety
///
/// `ptr`, `filename`, `entry_name` et `out` doivent être valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cpk_extract_by_name_out(
    ptr: *const u8,
    len: usize,
    filename: *const c_char,
    entry_name: *const c_char,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len < 16 || entry_name.is_null() {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let fname = if filename.is_null() {
        ""
    } else {
        unsafe { CStr::from_ptr(filename) }.to_str().unwrap_or("")
    };
    let target = match unsafe { CStr::from_ptr(entry_name) }.to_str() {
        Ok(t) => t,
        Err(_) => {
            unsafe { out.write(NieBytes::empty()) };
            return;
        },
    };
    let base = fname.rsplit(['/', '\\']).next().unwrap_or(fname);
    let extracted = (|| -> Option<Vec<u8>> {
        let reader = aphrody_nie_formats::cpk::CpkReader::new(data, base).ok()?;
        let entry = reader.entries.iter().find(|e| {
            if e.filename == target {
                return true;
            }
            let full = format!("{}/{}", e.directory.trim_matches('/'), e.filename);
            full == target.trim_matches('/')
        })?;
        reader.extract(data, entry).ok()
    })();
    let res = match extracted {
        Some(v) => NieBytes::from_vec(v),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

// ─────────────────────────────────────────────────────────────────────────────
// RDBN / cfg.bin
// ─────────────────────────────────────────────────────────────────────────────

/// Détecte le sous-type d'un fichier cfg.bin (1 = RDBN, 2 = T2B, 0 = Inconnu).
///
/// # Safety
///
/// Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cfgbin_probe(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    if aphrody_nie_formats::cfgbin::is_rdbn(data) {
        1
    } else if aphrody_nie_formats::cfgbin::is_t2b(data) {
        2
    } else {
        0
    }
}

/// Décode un fichier RDBN ou T2B vers la représentation JSON canonique IECODE.
///
/// # Safety
///
/// `ptr` et `out` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_cfgbin_to_json_out(ptr: *const u8, len: usize, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len == 0 {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let val = aphrody_nie_formats::cfgbin::to_iecode_json(data);
    let bytes = val.and_then(|v| serde_json::to_vec(&v).ok());
    let res = match bytes {
        Some(b) => NieBytes::from_vec(b),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

/// Extrait une table nommée d'un fichier RDBN sous forme de JSON UTF-8 dans `*out`.
///
/// # Safety
///
/// `ptr`, `table_name` et `out` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_rdbn_entry_query_json_out(
    ptr: *const u8,
    len: usize,
    table_name: *const c_char,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len == 0 || table_name.is_null() {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let name_str = match unsafe { CStr::from_ptr(table_name) }.to_str() {
        Ok(s) => s,
        Err(_) => {
            unsafe { out.write(NieBytes::empty()) };
            return;
        },
    };
    let json_bytes = (|| -> Option<Vec<u8>> {
        let rdbn = aphrody_nie_formats::cfgbin::parse(data).ok()?;
        let lists = aphrody_nie_formats::cfgbin::read_values(&rdbn, data);
        let list = lists.into_iter().find(|l| l.name == name_str)?;
        serde_json::to_vec(&list).ok()
    })();
    let res = match json_bytes {
        Some(b) => NieBytes::from_vec(b),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

// ─────────────────────────────────────────────────────────────────────────────
// G4TX textures
// ─────────────────────────────────────────────────────────────────────────────

/// Vérifie si le tampon commence par le magic `G4TX`.
///
/// # Safety
///
/// Si `len > 0`, `ptr` doit pointer vers au moins `len` octets valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_g4tx_probe(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    u32::from(aphrody_nie_formats::g4tx::is_g4tx(data))
}

/// Analyse les métadonnées d'un conteneur G4TX (textures, mipmaps, sous-textures) en JSON.
///
/// # Safety
///
/// `ptr` et `out` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_g4tx_info_json_out(ptr: *const u8, len: usize, out: *mut NieBytes) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len == 0 {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let info = (|| -> Option<Vec<u8>> {
        let g4tx = aphrody_nie_formats::g4tx::parse(data).ok()?;
        let textures: Vec<serde_json::Value> = g4tx
            .textures
            .iter()
            .map(|t| {
                let sub_textures: Vec<serde_json::Value> = t
                    .sub_textures
                    .iter()
                    .map(|s| {
                        serde_json::json!({
                            "id": s.id,
                            "name": s.name,
                            "x": s.x,
                            "y": s.y,
                            "width": s.width,
                            "height": s.height,
                        })
                    })
                    .collect();
                serde_json::json!({
                    "id": t.id,
                    "name": t.name,
                    "width": t.width,
                    "height": t.height,
                    "isDds": t.is_dds,
                    "dataOffset": t.data_offset,
                    "dataSize": t.data_size,
                    "subTextureCount": t.sub_textures.len(),
                    "subTextures": sub_textures,
                })
            })
            .collect();
        let val = serde_json::json!({
            "headerSize": g4tx.header.header_size,
            "fileType": g4tx.header.file_type,
            "tableSize": g4tx.header.table_size,
            "textureCount": g4tx.textures.len(),
            "textures": textures,
        });
        serde_json::to_vec(&val).ok()
    })();
    let res = match info {
        Some(v) => NieBytes::from_vec(v),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

/// Décode la texture principale G4TX vers un tampon RGBA8 brut avec largeur et hauteur.
///
/// Retourne 1 si le décodage a réussi, 0 sinon.
///
/// # Safety
///
/// `ptr`, `out_rgba`, `out_width` et `out_height` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_g4tx_to_rgba_out(
    ptr: *const u8,
    len: usize,
    out_rgba: *mut NieBytes,
    out_width: *mut u32,
    out_height: *mut u32,
) -> u32 {
    if out_rgba.is_null() {
        return 0;
    }
    if ptr.is_null() || len == 0 {
        unsafe { out_rgba.write(NieBytes::empty()) };
        return 0;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    if let Some((w, h, rgba)) = aphrody_nie_formats::g4tx_decode::decode_best_to_rgba(data, "") {
        if !out_width.is_null() {
            unsafe { *out_width = w };
        }
        if !out_height.is_null() {
            unsafe { *out_height = h };
        }
        unsafe { out_rgba.write(NieBytes::from_vec(rgba)) };
        1
    } else {
        unsafe { out_rgba.write(NieBytes::empty()) };
        0
    }
}

/// Décode une sous-texture nommée d'un atlas G4TX en octets PNG vers `*out`.
///
/// # Safety
///
/// `ptr`, `sub_name` et `out` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_g4tx_subtexture_to_png_out(
    ptr: *const u8,
    len: usize,
    sub_name: *const c_char,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len == 0 || sub_name.is_null() {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let name_str = match unsafe { CStr::from_ptr(sub_name) }.to_str() {
        Ok(s) => s,
        Err(_) => {
            unsafe { out.write(NieBytes::empty()) };
            return;
        },
    };
    let png = aphrody_nie_formats::g4tx_decode::decode_named_to_png(data, name_str)
        .map(NieBytes::from_vec)
        .unwrap_or_else(NieBytes::empty);
    unsafe { out.write(png) };
}

// ─────────────────────────────────────────────────────────────────────────────
// VFS file info
// ─────────────────────────────────────────────────────────────────────────────

/// Retourne les informations d'un fichier virtuel individuel en JSON UTF-8 dans `*out`.
///
/// # Safety
///
/// `vfs`, `internal_path` et `out` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_vfs_file_info_json_out(
    vfs: *mut c_void,
    internal_path: *const c_char,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if vfs.is_null() || internal_path.is_null() {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let path = match unsafe { CStr::from_ptr(internal_path) }.to_str() {
        Ok(p) => p,
        Err(_) => {
            unsafe { out.write(NieBytes::empty()) };
            return;
        },
    };
    let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
    let info = (|| -> Option<Vec<u8>> {
        let entry = vfs_ref.iter().find(|(p, _)| *p == path).map(|(p, e)| {
            let readable = vfs_ref.is_readable(p);
            serde_json::json!({
                "path": p,
                "cpk": e.cpk_filename,
                "size": e.file_size,
                "isReadable": readable,
            })
        })?;
        serde_json::to_vec(&entry).ok()
    })();
    let res = match info {
        Some(b) => NieBytes::from_vec(b),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sauvegardes de jeu (`aphrody-nie-save`)
// ─────────────────────────────────────────────────────────────────────────────

/// Vérifie si le tampon est un conteneur de sauvegarde Lives valide.
///
/// # Safety
///
/// `ptr` et `filename` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_save_probe(
    ptr: *const u8,
    len: usize,
    filename: *const c_char,
) -> u32 {
    if ptr.is_null() || len < 0x800 || filename.is_null() {
        return 0;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let fname = match unsafe { CStr::from_ptr(filename) }.to_str() {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let base = fname.rsplit(['/', '\\']).next().unwrap_or(fname);
    u32::from(aphrody_nie_save::parse(data, base).is_ok())
}

/// Déchiffre une sauvegarde Lives et écrit son résumé en JSON UTF-8 dans `*out`.
///
/// # Safety
///
/// `ptr`, `filename` et `out` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_save_summary_json_out(
    ptr: *const u8,
    len: usize,
    filename: *const c_char,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len < 0x800 || filename.is_null() {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let fname = match unsafe { CStr::from_ptr(filename) }.to_str() {
        Ok(s) => s,
        Err(_) => {
            unsafe { out.write(NieBytes::empty()) };
            return;
        },
    };
    let base = fname.rsplit(['/', '\\']).next().unwrap_or(fname);
    let summary_bytes = (|| -> Option<Vec<u8>> {
        let container = aphrody_nie_save::parse(data, base).ok()?;
        let summary = aphrody_nie_save::summarize(&container);
        let blob_infos: Vec<serde_json::Value> = container
            .entries
            .iter()
            .zip(&container.blobs)
            .enumerate()
            .map(|(idx, (entry, blob))| {
                serde_json::json!({
                    "index": idx,
                    "filename": entry.filename,
                    "subtype": format!("{:?}", blob.header.subtype),
                    "size": entry.size,
                    "crc32": entry.crc32,
                    "payloadSize": blob.body.len(),
                })
            })
            .collect();
        let val = serde_json::json!({
            "slotName": summary.slot_name,
            "playerName": summary.player_name,
            "levelStr": summary.level_str,
            "playtimeSecs": summary.playtime_secs,
            "uniqueId": summary.unique_id,
            "lastSave": summary.last_save,
            "usedSlots": summary.used_slots,
            "maxSlots": summary.max_slots,
            "rosterCount": summary.roster.count(),
            "blobs": blob_infos,
        });
        serde_json::to_vec(&val).ok()
    })();
    let res = match summary_bytes {
        Some(b) => NieBytes::from_vec(b),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

/// Extrait un blob déchiffré d'un conteneur de sauvegarde dans `*out`.
///
/// # Safety
///
/// `ptr`, `filename` et `out` doivent être des pointeurs valides.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn nie_save_extract_blob_out(
    ptr: *const u8,
    len: usize,
    filename: *const c_char,
    blob_index: usize,
    out: *mut NieBytes,
) {
    if out.is_null() {
        return;
    }
    if ptr.is_null() || len < 0x800 || filename.is_null() {
        unsafe { out.write(NieBytes::empty()) };
        return;
    }
    let data = unsafe { core::slice::from_raw_parts(ptr, len) };
    let fname = match unsafe { CStr::from_ptr(filename) }.to_str() {
        Ok(s) => s,
        Err(_) => {
            unsafe { out.write(NieBytes::empty()) };
            return;
        },
    };
    let base = fname.rsplit(['/', '\\']).next().unwrap_or(fname);
    let bytes = (|| -> Option<Vec<u8>> {
        let container = aphrody_nie_save::parse(data, base).ok()?;
        let blob = container.blobs.get(blob_index)?;
        Some(blob.body.clone())
    })();
    let res = match bytes {
        Some(b) => NieBytes::from_vec(b),
        None => NieBytes::empty(),
    };
    unsafe { out.write(res) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    #[test]
    fn typed_cfgbin_abi_converts_in_memory_and_rejects_invalid_input() {
        let input = aphrody_nie_formats::cfgbin::encode_t2b(&[]);
        let mut out = super::NieBytes::empty();
        unsafe { super::nie_cfgbin_typed_json_out(input.as_ptr(), input.len(), &mut out) };
        let decoded: serde_json::Value =
            serde_json::from_slice(unsafe { core::slice::from_raw_parts(out.ptr, out.len) })
                .expect("typed JSON");
        assert_eq!(decoded, serde_json::json!({"entries":[]}));
        unsafe { super::nie_bytes_free(out) };
        let mut out = super::NieBytes::empty();
        unsafe { super::nie_cfgbin_typed_json_out(core::ptr::null(), 0, &mut out) };
        assert!(out.ptr.is_null());
        assert_eq!(out.len, 0);
    }
    use super::*;
    use std::ffi::CStr;

    // ── CRC32 ────────────────────────────────────────────────────────────────

    #[test]
    fn crc32_ground_truth_focus() {
        let buf = b"Focus";
        let hash = unsafe { nie_crc32(buf.as_ptr(), buf.len()) };
        assert_eq!(hash, 0xA301_65ED, "crc32(b\"Focus\")");
    }

    #[test]
    fn crc32_ground_truth_123456789() {
        let buf = b"123456789";
        let hash = unsafe { nie_crc32(buf.as_ptr(), buf.len()) };
        assert_eq!(hash, 0xCBF4_3926, "crc32(b\"123456789\")");
    }

    #[test]
    fn crc32_empty_len_zero_returns_zero() {
        // len==0 : ptr n'est pas déréférencé, retour 0.
        let hash = unsafe { nie_crc32(core::ptr::null(), 0) };
        assert_eq!(hash, 0, "crc32(null, 0)");
    }

    #[test]
    fn crc32_empty_slice_ptr_returns_zero() {
        // Slice vide via ptr valide (même résultat).
        let hash = unsafe { nie_crc32(b"".as_ptr(), 0) };
        assert_eq!(hash, 0, "crc32(b\"\", 0)");
    }

    // ── CRand ────────────────────────────────────────────────────────────────

    #[test]
    fn crand_new_vecteur_mt19937_seed_5489() {
        let h = nie_crand_new(5489);
        assert_eq!(unsafe { nie_crand_next_u32(h) }, 3_499_211_612, "tirage #1");
        assert_eq!(unsafe { nie_crand_next_u32(h) }, 581_869_302, "tirage #2");
        assert_eq!(unsafe { nie_crand_next_u32(h) }, 3_890_346_734, "tirage #3");
        unsafe { nie_crand_free(h) };
    }

    #[test]
    fn crand_null_handle_safe() {
        let null: *mut CRand = core::ptr::null_mut();
        assert_eq!(unsafe { nie_crand_next_u32(null) }, 0);
        assert_eq!(unsafe { nie_crand_bounded(null, 10) }, 0);
        assert_eq!(unsafe { nie_crand_next_f32(null) }, 0.0_f32);
        // free null = no-op
        unsafe { nie_crand_free(null) };
    }

    #[test]
    fn crand_from_u64_matches_u32_low_half() {
        // from_u64(n) avec moitié haute nulle == new(n as u32)
        let h64 = nie_crand_from_u64(12_345_u64);
        let h32 = nie_crand_new(12_345_u32);
        assert_eq!(unsafe { nie_crand_next_u32(h64) }, unsafe { nie_crand_next_u32(h32) });
        unsafe { nie_crand_free(h64) };
        unsafe { nie_crand_free(h32) };
    }

    #[test]
    fn crand_bounded_zero_is_raw_next_u32() {
        // bound==0 → tirage brut (pas 0) et consomme un tirage.
        let h = nie_crand_new(99);
        let h2 = nie_crand_new(99);
        let via_bounded = unsafe { nie_crand_bounded(h, 0) };
        let via_next = unsafe { nie_crand_next_u32(h2) };
        assert_eq!(via_bounded, via_next, "bound==0 → tirage brut");
        // Les deux PRNG restent synchronisés après.
        assert_eq!(
            unsafe { nie_crand_next_u32(h) },
            unsafe { nie_crand_next_u32(h2) },
            "consommation identique"
        );
        unsafe { nie_crand_free(h) };
        unsafe { nie_crand_free(h2) };
    }

    #[test]
    fn crand_bounded_nonzero_in_range() {
        let h = nie_crand_new(42);
        for _ in 0..10_000 {
            assert!(unsafe { nie_crand_bounded(h, 6) } < 6);
        }
        unsafe { nie_crand_free(h) };
    }

    #[test]
    fn crand_next_f32_in_range() {
        let h = nie_crand_new(7);
        for _ in 0..10_000 {
            let f = unsafe { nie_crand_next_f32(h) };
            assert!((0.0_f32..1.0_f32).contains(&f));
        }
        unsafe { nie_crand_free(h) };
    }

    // ── Version ──────────────────────────────────────────────────────────────

    #[test]
    fn version_is_static_cstring() {
        let ptr = nie_version();
        // SAFETY: nie_version retourne une C-string 'static null-terminée ASCII.
        let s = unsafe { CStr::from_ptr(ptr) }.to_str().unwrap();
        // La version vient du workspace (`version.workspace = true`) : la comparer à une
        // constante en dur faisait échouer le test à chaque bump (0.1.0 → 0.4.0).
        assert_eq!(s, env!("CARGO_PKG_VERSION"));
    }

    // ── Police : rendu de texte (gated sur le vrai jeu) ────────────────────────

    /// Round-trip complet : VFS → `nie_font_open` → `nie_font_render_text("A")` → PNG.
    /// Valide la dimension (avance 39 × cell_height 71) et la présence d'un masque alpha
    /// significatif. Le pixel exact dépend de la révision de l'atlas et n'est pas un contrat FFI.
    #[test]
    fn font_render_text_a_real() {
        use std::ffi::CString;
        let dir = aphrody_nie_formats::vfs::resolve_game_dir().to_string_lossy().into_owned();
        let data = std::path::Path::new(&dir).join("data");
        if !aphrody_nie_formats::vfs::donnees_disponibles(&data) {
            eprintln!("skip font_render_text_a_real : jeu absent");
            return;
        }
        let data_c = CString::new(data.to_str().unwrap()).unwrap();
        // SAFETY: data_c est une C-string valide.
        let vfs = unsafe { nie_vfs_open(data_c.as_ptr()) };
        assert!(!vfs.is_null(), "vfs open");

        // La police a DEUX fichiers, et `donnees_disponibles` n'en garantit aucun.
        //
        // Un dump partiel suffit à faire passer cette garde : celui du dépôt porte les métriques
        // (343 888 o) et PAS l'atlas de 44 Mo, qui ne vit que dans les CPK d'une installation.
        // Le test allait alors jusqu'à `nie_font_open`, qui rend `null`, et paniquait sur
        // « font open » — un échec qui accuse le code alors qu'il manque une donnée. Mesuré le
        // 2026-09-19 avec `NIE_GAME_DIR` pointant sur le dépôt.
        //
        // La garde nomme donc le fichier absent, au lieu de laisser deviner.
        // SAFETY: vfs provient de nie_vfs_open.
        let vfs_ref = unsafe { &*(vfs.cast::<aphrody_nie_formats::vfs::Vfs>()) };
        for chemin in [FONT_METRICS_PATH, FONT_ATLAS_PATH] {
            if vfs_ref.read(chemin).is_err() {
                eprintln!("skip font_render_text_a_real : {chemin} absent du VFS monté");
                // SAFETY: vfs provient de nie_vfs_open et n'a pas encore été libéré.
                unsafe { nie_vfs_free(vfs) };
                return;
            }
        }

        // SAFETY: vfs provient de nie_vfs_open.
        let fctx = unsafe { nie_font_open(vfs) };
        assert!(!fctx.is_null(), "font open");

        let text = CString::new("A").unwrap();
        // SAFETY: fctx/text valides.
        let png = unsafe { nie_font_render_text(fctx, text.as_ptr(), 255, 255, 255, 255) };
        assert!(!png.ptr.is_null() && png.len > 8, "PNG non vide");

        // SAFETY: png.ptr..len est un tampon PNG valide alloué par ce crate.
        let bytes = unsafe { core::slice::from_raw_parts(png.ptr, png.len) };
        let img = image::load_from_memory(bytes).expect("décodage PNG").to_rgba8();
        assert_eq!(img.width(), 39, "largeur = avance de 'A'");
        assert_eq!(img.height(), 71, "hauteur = cell_height");
        let alphas = img.pixels().map(|pixel| pixel[3]);
        let opaque_pixels = alphas.clone().filter(|alpha| *alpha != 0).count();
        let max_alpha = alphas.max().unwrap_or(0);
        assert!(opaque_pixels > 100, "le glyphe A doit couvrir une surface réelle");
        assert!(max_alpha > 200, "le masque du glyphe doit contenir un trait opaque");

        // SAFETY: chaque handle/tampon est libéré exactement une fois.
        unsafe { nie_bytes_free(png) };
        unsafe { nie_font_free(fctx) };
        unsafe { nie_vfs_free(vfs) };
    }

    /// Parcourt le corpus Steam complet et vérifie que le pont typé ne perd aucun écran menu.
    ///
    /// Ce garde-fou est volontairement end-to-end : index VFS réel, extraction CPK réelle,
    /// parseur T2B réel, puis désérialisation de la structure sémantique. Il reste silencieux
    /// quand l'installation n'est pas disponible sur la machine de CI.
    #[test]
    fn menu_setting_typed_corpus_real() {
        let dir = aphrody_nie_formats::vfs::resolve_game_dir().join("data");
        if !aphrody_nie_formats::vfs::donnees_disponibles(&dir) {
            eprintln!("skip menu_setting_typed_corpus_real : jeu absent");
            return;
        }

        let mut vfs = aphrody_nie_formats::vfs::Vfs::new();
        vfs.init(&dir).expect("initialiser le VFS réel");
        let paths: Vec<String> = vfs
            .iter()
            .filter(|(path, _)| path.ends_with("_menu_setting.cfg.bin"))
            .map(|(path, _)| path.to_owned())
            .collect();
        assert!(paths.len() >= 300, "corpus menu_setting trop petit : {}", paths.len());

        let mut total_layers = 0usize;
        let mut total_commands = 0usize;
        for path in &paths {
            let bytes = vfs.read(path).unwrap_or_else(|e| panic!("lecture {path}: {e}"));
            let output = menu_setting_json_impl(&bytes);
            assert!(!output.ptr.is_null(), "sortie vide pour {path}");
            // SAFETY: le tampon vient de `menu_setting_json_impl` et reste vivant jusqu'à free.
            let json = unsafe { core::slice::from_raw_parts(output.ptr, output.len) };
            let parsed: aphrody_nie_data::menu_setting::MenuSetting =
                serde_json::from_slice(json).unwrap_or_else(|e| panic!("JSON {path}: {e}"));
            assert!(parsed.layer_hashes_consistent(), "layer_id incohérent dans {path}");
            total_layers += parsed.layers.len();
            total_commands += parsed.commands.len();
            // SAFETY: chaque allocation produite par `menu_setting_json_impl` est libérée une fois.
            unsafe { nie_bytes_free(output) };
        }
        assert!(total_layers >= 2_000, "trop peu de layers : {total_layers}");
        assert!(total_commands >= 300, "trop peu de commandes : {total_commands}");
        eprintln!(
            "OK {}/{} menu_setting — {total_layers} layers / {total_commands} commandes",
            paths.len(),
            paths.len()
        );
    }

    #[test]
    fn crc32_nie_accumulator_test() {
        let empty_crc = unsafe { nie_crc32_nie(core::ptr::null(), 0) };
        assert_eq!(empty_crc, 0xFFFF_FFFF);

        let data = b"test";
        let raw = unsafe { nie_crc32_nie(data.as_ptr(), data.len()) };
        let standard = unsafe { nie_crc32(data.as_ptr(), data.len()) };
        // NIE raw accumulator has !raw == standard
        assert_eq!(!raw, standard);
    }

    #[test]
    fn crilayla_ffi_rejects_excessive_decoded_size() {
        let mut input = vec![0u8; aphrody_nie_formats::crilayla::MIN_FILE_SIZE];
        input[..8].copy_from_slice(aphrody_nie_formats::crilayla::MAGIC);
        input[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        let output = unsafe { nie_crilayla_decompress(input.as_ptr(), input.len()) };
        assert!(output.ptr.is_null());
        assert_eq!(output.len, 0);
    }

    #[test]
    fn crilayla_compression_decompression_round_trip() {
        let mut sample = vec![0u8; 350];
        for (i, b) in sample.iter_mut().enumerate() {
            *b = (i % 251) as u8;
        }
        let compressed = compress_crilayla(&sample);
        assert_eq!(unsafe { nie_crilayla_is_compressed(compressed.as_ptr(), compressed.len()) }, 1);

        let mut out = NieBytes::empty();
        unsafe {
            nie_crilayla_decompress_out(compressed.as_ptr(), compressed.len(), &mut out);
        }
        assert!(!out.ptr.is_null());
        assert_eq!(out.len, sample.len());
        let decompressed = unsafe { core::slice::from_raw_parts(out.ptr, out.len) };
        assert_eq!(decompressed, sample.as_slice());
        unsafe { nie_bytes_free(out) };
    }

    #[test]
    fn cpk_key_derivation_and_block_involution() {
        use std::ffi::CString;
        let c_name = CString::new("path/to/archive.cpk").unwrap();
        let key1 = unsafe { nie_cpk_key_from_filename(c_name.as_ptr()) };
        let c_base = CString::new("archive.cpk").unwrap();
        let key2 = unsafe { nie_cpk_key_from_filename(c_base.as_ptr()) };
        assert_eq!(key1, key2);
        assert_ne!(key1, 0);

        let mut buffer = b"Level-5 IECODE high performance FFI buffer test".to_vec();
        let original = buffer.clone();
        unsafe { nie_cpk_decrypt_block(buffer.as_mut_ptr(), buffer.len(), 0, key1) };
        assert_ne!(buffer, original);
        // XOR is an involution: applying it again with identical offset and key restores original
        unsafe { nie_cpk_decrypt_block(buffer.as_mut_ptr(), buffer.len(), 0, key1) };
        assert_eq!(buffer, original);
    }

    #[test]
    fn build_info_and_diagnostics_round_trip() {
        let mut out = NieBytes::empty();
        unsafe { nie_build_info_json_out(&mut out) };
        assert!(!out.ptr.is_null() && out.len > 0);
        let bytes = unsafe { core::slice::from_raw_parts(out.ptr, out.len) };
        let parsed: serde_json::Value =
            serde_json::from_slice(bytes).expect("valid build info JSON");
        assert_eq!(parsed["product"], "iecode");
        assert!(parsed["capabilities"].is_array());
        unsafe { nie_bytes_free(out) };

        nie_clear_error();
        let mut err_out = NieBytes::empty();
        unsafe { nie_last_error_out(&mut err_out) };
        assert!(err_out.ptr.is_null());

        set_last_error("test error condition");
        unsafe { nie_last_error_out(&mut err_out) };
        assert!(!err_out.ptr.is_null());
        let err_bytes = unsafe { core::slice::from_raw_parts(err_out.ptr, err_out.len) };
        assert_eq!(err_bytes, b"test error condition");
        unsafe { nie_bytes_free(err_out) };
        nie_clear_error();
    }
}
