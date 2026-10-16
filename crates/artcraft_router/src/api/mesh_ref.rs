use serde_derive::{Deserialize, Serialize};
use tokens::tokens::media_files::MediaFileToken;

/// Reference to an input 3D mesh file (e.g. GLB/OBJ/FBX) for mesh-to-mesh
/// models like part splitting and retopology.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MeshRef {
  MediaFileToken(MediaFileToken),
  Url(String),
}
