// SPDX-License-Identifier: Apache-2.0
//! Client-to-server JSON messages.

use serde::Deserialize;

fn left() -> String {
    "left".to_owned()
}

/// Message sent by the viewer, tagged by `type`.
///
/// Mouse coordinates are pixels of the (possibly downscaled) JPEG frame.
/// Wheel deltas use the DOM convention (positive `dy` scrolls down, positive
/// `dx` scrolls right), 120 units per notch.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    MouseMove {
        x: f64,
        y: f64,
    },
    MouseDown {
        #[serde(default = "left")]
        button: String,
    },
    MouseUp {
        #[serde(default = "left")]
        button: String,
    },
    Wheel {
        #[serde(default)]
        dx: f64,
        #[serde(default)]
        dy: f64,
    },
    Key {
        code: String,
        down: bool,
    },
    Text {
        text: String,
    },
    Config {
        fps: Option<u32>,
        quality: Option<u32>,
        scale: Option<u32>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_variants() {
        let p = |s: &str| serde_json::from_str::<ClientMsg>(s).unwrap();
        assert_eq!(
            p(r#"{"type":"mouse_move","x":1.5,"y":2}"#),
            ClientMsg::MouseMove { x: 1.5, y: 2.0 }
        );
        assert_eq!(
            p(r#"{"type":"mouse_down"}"#),
            ClientMsg::MouseDown {
                button: "left".into()
            }
        );
        assert_eq!(
            p(r#"{"type":"mouse_up","button":"right"}"#),
            ClientMsg::MouseUp {
                button: "right".into()
            }
        );
        assert_eq!(
            p(r#"{"type":"wheel","dy":-120}"#),
            ClientMsg::Wheel {
                dx: 0.0,
                dy: -120.0
            }
        );
        assert_eq!(
            p(r#"{"type":"key","code":"KeyA","down":true}"#),
            ClientMsg::Key {
                code: "KeyA".into(),
                down: true
            }
        );
        assert_eq!(
            p(r#"{"type":"text","text":"abc"}"#),
            ClientMsg::Text { text: "abc".into() }
        );
        assert_eq!(
            p(r#"{"type":"config","fps":30,"scale":2}"#),
            ClientMsg::Config {
                fps: Some(30),
                quality: None,
                scale: Some(2)
            }
        );
    }

    #[test]
    fn rejects_unknown_and_malformed() {
        assert!(serde_json::from_str::<ClientMsg>(r#"{"type":"nope"}"#).is_err());
        assert!(serde_json::from_str::<ClientMsg>(r#"{"type":"key","code":"A"}"#).is_err());
        assert!(serde_json::from_str::<ClientMsg>("garbage").is_err());
    }
}
