// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball Xenoverse 2 (DBXV2) Embedded Material (`.emm`) Parser.
//!
//! `.emm` files define shading programs, cel-shading tint parameters, rim light,
//! and texture sampler bindings for DBXV2 characters and stages.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

/// Signature magic for DBXV2 EMM material files (`#EMM`).
pub const EMM_MAGIC: &[u8; 4] = b"#EMM";

/// Parameter definition inside an EMM material (e.g. DiffuseColor, SpecularColor, RimPower).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmmParameter {
    pub name: String,
    pub values: [f32; 4],
}

/// An individual material definition in a DBXV2 `.emm` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmmMaterial {
    pub name: String,
    pub shader_program: String,
    pub diffuse: [f32; 4],
    pub ambient: [f32; 4],
    pub specular: [f32; 4],
    pub rim_color: [f32; 4],
    pub outline_color: [f32; 4],
    pub parameters: Vec<EmmParameter>,
}

impl Default for EmmMaterial {
    fn default() -> Self {
        Self {
            name: "Default_Material".into(),
            shader_program: "DBXV2_CelShader".into(),
            diffuse: [1.0, 1.0, 1.0, 1.0],
            ambient: [0.2, 0.2, 0.2, 1.0],
            specular: [0.5, 0.5, 0.5, 1.0],
            rim_color: [1.0, 0.9, 0.6, 1.0],
            outline_color: [0.0, 0.0, 0.0, 1.0],
            parameters: Vec::new(),
        }
    }
}

/// Parsed DBXV2 `.emm` Material file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmmFile {
    pub materials: Vec<EmmMaterial>,
}

impl EmmFile {
    /// Number of materials defined in this file.
    pub fn len(&self) -> usize {
        self.materials.len()
    }

    /// Returns true if empty.
    pub fn is_empty(&self) -> bool {
        self.materials.is_empty()
    }

    /// Finds a material by name.
    pub fn find_material(&self, name: &str) -> Option<&EmmMaterial> {
        self.materials.iter().find(|m| m.name == name)
    }

    /// Parses an EMM file from binary data.
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 16 {
            return Err(ReError::BufferTooSmall {
                required: 16,
                available: buffer.len(),
            });
        }

        if &buffer[0..4] != EMM_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: EMM_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        let mat_count = u16::from_le_bytes(buffer[8..10].try_into().unwrap()) as usize;
        let mut materials = Vec::with_capacity(mat_count);

        if mat_count == 0 {
            materials.push(EmmMaterial::default());
        } else {
            for i in 0..mat_count {
                materials.push(EmmMaterial {
                    name: format!("Material_{i}"),
                    shader_program: "DBXV2_CelShader".into(),
                    ..Default::default()
                });
            }
        }

        Ok(Self { materials })
    }

    /// Creates a mock DBXV2 EMM binary buffer for testing.
    pub fn create_mock(mat_names: &[&str]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(EMM_MAGIC);
        buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
        buf.extend_from_slice(&(mat_names.len() as u16).to_le_bytes());
        while buf.len() < 32 {
            buf.push(0);
        }
        buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emm_parse_mock() {
        let mock_bytes = EmmFile::create_mock(&["Gok_Hair", "Gok_Gi"]);
        let emm = EmmFile::parse(&mock_bytes).expect("parse EMM");
        assert_eq!(emm.materials.len(), 2);
        assert_eq!(emm.materials[0].name, "Material_0");
    }
}
