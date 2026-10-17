//! Moteur RE nie.
//!
//! Trois capacités, implémentées au fil de la boucle :
//! - `rtti` : récupération RTTI MSVC (`.rdata` → classes `lives::*`/`game::*` + hiérarchie).
//! - `indexer` : ré-indexation du binaire (goblin + iced-x86 via `bun-re`) pour
//!   vérification/reproductibilité quand `nie.exe` change.
//! - `disasm` : récupération des arêtes d'appel manquantes par désassemblage `iced-x86`
//!   de `.text` (enrichit le call-graph au-delà du plafond de l'export Ghidra).
//! - `propagate` : propagation de labels semi-supervisée sur le call-graph (auto-ML),
//!   depuis les ancres du seed Ghidra/iecode vers les ~60 000 fonctions.
//! - `anchors` : ancrage des fonctions par leurs références de chaînes (table de règles
//!   `motif→sous-système` appliquée avant la propagation).
//! - `loop_db` : câblage DB → `PropagationGraph` → écriture des résultats.
//! - `dump` : recherche de motifs (AOB, wildcards) dans un minidump live de `nie.exe`,
//!   avec traduction `module + RVA` (oracle de lecture/validation runtime ; complète le
//!   scanner *process live* de `aphrody-nie-trace` pour le cas dump `.dmp` hors-ligne).
//!   Pure (no SQLite), so it stays available without the `nie` feature and on wasm.
//!
//! Absorbed from `aphrody-nie-re` and `aphrody-nie-dump`. [`dump`] and the [`pdata`] byte
//! parser are pure; SQLite indexing, recovery and the remaining analysis modules need the
//! `nie` feature. Label propagation is [`crate::propagate`].
#![allow(clippy::pedantic)]

#[cfg(feature = "nie")]
pub mod adjacency;
#[cfg(feature = "nie")]
pub mod anchors;
#[cfg(feature = "nie")]
pub mod disasm;
pub mod dump;
#[cfg(feature = "nie")]
pub mod funclua;
#[cfg(feature = "nie")]
pub mod ghidra_import;
#[cfg(feature = "nie")]
pub mod indexer;
#[cfg(feature = "nie")]
pub mod loop_db;
pub mod pdata;
#[cfg(feature = "nie")]
pub mod recover;
#[cfg(feature = "nie")]
pub mod rtti;
#[cfg(feature = "nie")]
pub mod strref;
#[cfg(feature = "nie")]
pub mod vtable;
#[cfg(feature = "nie")]
pub mod vtable_anon;
#[cfg(feature = "nie")]
pub mod workflow;
