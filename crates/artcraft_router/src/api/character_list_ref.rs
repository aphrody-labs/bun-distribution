use serde_derive::{Deserialize, Serialize};
use tokens::tokens::characters::CharacterToken;

/// Forward-compatible character reference list.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CharacterListRef {
  CharacterTokens(Vec<CharacterToken>),

  // In the future, we may have other identifiers for characters.
}
