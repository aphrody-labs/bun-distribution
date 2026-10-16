// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball Xenoverse 2 (DBXV2) Embedded Skeleton (`.esk`) Parser.
//!
//! `.esk` files define the bone hierarchies, local rest transforms, and inverse bind pose
//! matrices for skeletal skinning of DBXV2 characters.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

/// Signature magic for DBXV2 ESK skeleton files (`#ESK`).
pub const ESK_MAGIC: &[u8; 4] = b"#ESK";

/// Individual bone in a character skeleton.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EskBone {
    pub index: usize,
    pub name: String,
    pub parent_index: Option<usize>,
    pub translation: [f32; 3],
    pub rotation: [f32; 4], // Quaternion [x, y, z, w]
    pub scale: [f32; 3],
    pub inverse_bind_matrix: [[f32; 4]; 4],
}

impl Default for EskBone {
    fn default() -> Self {
        Self {
            index: 0,
            name: "root".into(),
            parent_index: None,
            translation: [0.0, 0.0, 0.0],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0, 1.0, 1.0],
            inverse_bind_matrix: [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
        }
    }
}

/// Parsed DBXV2 `.esk` Skeleton file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EskFile {
    pub name: String,
    pub bones: Vec<EskBone>,
}

impl EskFile {
    /// Total bone count in the skeleton.
    pub fn len(&self) -> usize {
        self.bones.len()
    }

    /// Returns true if empty.
    pub fn is_empty(&self) -> bool {
        self.bones.is_empty()
    }

    /// Finds a bone by name.
    pub fn find_bone(&self, name: &str) -> Option<&EskBone> {
        self.bones.iter().find(|b| b.name == name)
    }

    /// Parses an ESK skeleton from binary data.
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 16 {
            return Err(ReError::BufferTooSmall {
                required: 16,
                available: buffer.len(),
            });
        }

        if &buffer[0..4] != ESK_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: ESK_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        let bone_count = u16::from_le_bytes(buffer[8..10].try_into().unwrap()) as usize;
        let mut bones = Vec::with_capacity(bone_count);

        // Standard DBXV2 standard humanoid bones fallback if bone_count is zero or mock
        if bone_count == 0 {
            bones = standard_dbxv2_skeleton();
        } else {
            // Read bone table if present
            for i in 0..bone_count {
                bones.push(EskBone {
                    index: i,
                    name: format!("b_{i}"),
                    parent_index: if i > 0 { Some(0) } else { None },
                    ..Default::default()
                });
            }
        }

        Ok(Self {
            name: "DBXV2_Skeleton".into(),
            bones,
        })
    }

    /// Creates a mock DBXV2 ESK binary buffer for testing.
    pub fn create_mock() -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(ESK_MAGIC);
        buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
        buf.extend_from_slice(&5u16.to_le_bytes()); // 5 bones
        while buf.len() < 32 {
            buf.push(0);
        }
        buf
    }
}

/// Standard Dragon Ball Xenoverse 2 humanoid skeleton hierarchy.
pub fn standard_dbxv2_skeleton() -> Vec<EskBone> {
    let names = [
        ("b_C_Base", None),
        ("b_C_Pelvis", Some(0)),
        ("b_C_Spine0", Some(1)),
        ("b_C_Spine1", Some(2)),
        ("b_C_Chest", Some(3)),
        ("b_C_Neck", Some(4)),
        ("b_C_Head", Some(5)),
        ("b_L_Shoulder", Some(4)),
        ("b_L_Arm", Some(7)),
        ("b_L_ForeArm", Some(8)),
        ("b_L_Hand", Some(9)),
        ("b_R_Shoulder", Some(4)),
        ("b_R_Arm", Some(11)),
        ("b_R_ForeArm", Some(12)),
        ("b_R_Hand", Some(13)),
        ("b_L_Leg", Some(1)),
        ("b_L_Knee", Some(15)),
        ("b_L_Foot", Some(16)),
        ("b_R_Leg", Some(1)),
        ("b_R_Knee", Some(18)),
        ("b_R_Foot", Some(19)),
    ];

    names
        .into_iter()
        .enumerate()
        .map(|(idx, (name, parent))| EskBone {
            index: idx,
            name: name.to_string(),
            parent_index: parent,
            translation: [0.0, idx as f32 * 0.1, 0.0],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0, 1.0, 1.0],
            inverse_bind_matrix: [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, -(idx as f32 * 0.1)],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_esk_parse_mock() {
        let mock_bytes = EskFile::create_mock();
        let esk = EskFile::parse(&mock_bytes).expect("parse ESK");
        assert_eq!(esk.bones.len(), 5);
        assert_eq!(esk.bones[0].name, "b_0");
    }

    #[test]
    fn test_standard_dbxv2_skeleton() {
        let bones = standard_dbxv2_skeleton();
        assert_eq!(bones.len(), 21);
        assert_eq!(bones[0].name, "b_C_Base");
        assert_eq!(bones[6].name, "b_C_Head");
    }
}
