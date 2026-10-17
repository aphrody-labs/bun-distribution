use serde_derive::{Deserialize, Serialize};
use strum::EnumIter;

/// The provider to route a generation request to.
#[derive(Copy, Clone, Debug, Serialize, Deserialize, EnumIter)]
#[serde(rename_all = "snake_case")]
pub enum RouterProvider {
    Artcraft,
    Midjourney,
    Fal,
    GmiCloud,
    GrokApi,
    KinoviWeb,
    WorldLabs,
}
