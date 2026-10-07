// SPDX-License-Identifier: Apache-2.0
//! Thin JSON bridge for the shared combat core; browser controls and rendering stay in JS/WGSL.
use aphrody_dragon_pixel_core::{Game, Input};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Session {
    game: Game,
}

#[wasm_bindgen]
impl Session {
    #[wasm_bindgen(constructor)]
    pub fn new(style: &str) -> Self {
        Self { game: Game::new(style) }
    }

    /// Advance the Rust simulation with a JSON input object and return the updated state as JSON.
    pub fn step(&mut self, input_json: &str, dt: f32) -> Result<String, JsValue> {
        let input: Input = serde_json::from_str(input_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.game.step(input, dt);
        serde_json::to_string(&self.game).map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_the_shared_core_state() {
        let mut game = Game::new("speed");
        let input: Input = serde_json::from_str(r#"{"right":true}"#).unwrap();
        game.step(input, 0.05);
        assert!(game.player.x > 160.0);
        assert_eq!(game.wave, 1);
    }
}
