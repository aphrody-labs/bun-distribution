use serde_derive::{Deserialize, Serialize};
use tokens::tokens::media_files::MediaFileToken;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageRef {
    MediaFileToken(MediaFileToken),
    Url(String),
}
