//! Codec **G4CM** — animations de caméra de cutscene (`common/event/<ev>/<ev>_camera.g4cm`).
//!
//! **Le codec a déménagé dans [`aphrody_nie_formats::g4cm`]** et ce module le réexporte tel quel.
//!
//! La raison est la portée, pas le rangement : `aphrody-nie-formats` porte la table de dispatch
//! `decode` que partagent la FFI (`nie_decode_json`), `nie decode`, l'explorateur et le MCP.
//! Tant que le codec vivait ici, aucun de ces quatre chemins ne pouvait décoder un `.g4cm` —
//! `aphrody-nie-formats` ne peut pas dépendre de `aphrody-nie-camera`, qui dépend de lui. La documentation du
//! format, la structure reversée et les tests vivent désormais avec le code, dans
//! [`aphrody_nie_formats::g4cm`] ; `aphrody-nie-camera` garde ce qui est du domaine caméra (modèle,
//! contrôleurs, configs, live, indexation SQL).
//!
//! Le type d'erreur rendu est [`aphrody_nie_formats::FormatError`], que [`crate::CameraError`] absorbe
//! par `From` : un `?` dans le code de cette crate continue de fonctionner à l'identique.

pub use aphrody_nie_formats::g4cm::{
    AnimObject, CHANNEL_ENTRY_LEN, CLIP_ENTRY_LEN, COUNTER_COUNT, CameraAnim, Channel, ChannelKind,
    Clip, MAGIC, NAME_LEN, OBJECT_ENTRY_LEN, Track, VERSION, decode, encode, is_g4cm, parse,
};
