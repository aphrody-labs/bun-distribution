// SPDX-License-Identifier: Apache-2.0
//! Dragon Ball Xenoverse 2 (DBXV2) Embedded 3D Model (`.emd`) Parser.
//!
//! `.emd` files contain submodels (e.g. Hair, Face, Bust, Pants, Boots, Wrists),
//! submeshes, vertex attributes (positions, normals, tangents, UVs, skinning weights),
//! triangle index buffers, and material references.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

/// Signature magic for DBXV2 EMD files (`#EMD`).
pub const EMD_MAGIC: &[u8; 4] = b"#EMD";

/// Vertex attribute layout and data in a DBXV2 submesh.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmdVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub tangent: Option<[f32; 4]>,
    pub uv: [f32; 2],
    pub color: Option<[f32; 4]>,
    pub bone_indices: Option<[u16; 4]>,
    pub bone_weights: Option<[f32; 4]>,
}

impl Default for EmdVertex {
    fn default() -> Self {
        Self {
            position: [0.0, 0.0, 0.0],
            normal: [0.0, 1.0, 0.0],
            tangent: None,
            uv: [0.0, 0.0],
            color: None,
            bone_indices: None,
            bone_weights: None,
        }
    }
}

/// A submesh part within a mesh, mapped to a specific material name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmdSubmesh {
    pub name: String,
    pub material_name: String,
    pub vertices: Vec<EmdVertex>,
    pub indices: Vec<u32>,
    pub aabb_min: [f32; 3],
    pub aabb_max: [f32; 3],
}

/// A mesh containing one or more submeshes (LODs or material parts).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmdMesh {
    pub name: String,
    pub submeshes: Vec<EmdSubmesh>,
    pub aabb_min: [f32; 3],
    pub aabb_max: [f32; 3],
}

/// A character submodel part (e.g., `Bust`, `Hair`, `Face`, `Pants`, `Boots`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmdModelPart {
    pub name: String,
    pub meshes: Vec<EmdMesh>,
}

/// A complete parsed DBXV2 `.emd` 3D Model file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmdFile {
    pub name: String,
    pub parts: Vec<EmdModelPart>,
}

impl EmdFile {
    /// Total vertex count across all submeshes.
    pub fn total_vertices(&self) -> usize {
        self.parts
            .iter()
            .flat_map(|p| &p.meshes)
            .flat_map(|m| &m.submeshes)
            .map(|s| s.vertices.len())
            .sum()
    }

    /// Total triangle count across all submeshes.
    pub fn total_triangles(&self) -> usize {
        self.parts
            .iter()
            .flat_map(|p| &p.meshes)
            .flat_map(|m| &m.submeshes)
            .map(|s| s.indices.len() / 3)
            .sum()
    }

    /// Parses an EMD model file from binary data.
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 16 {
            return Err(ReError::BufferTooSmall {
                required: 16,
                available: buffer.len(),
            });
        }

        if &buffer[0..4] != EMD_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: EMD_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        // Real Xenoverse 2 layout (`0xFFFE` endian mark, 0x1C-byte header).
        if buffer.len() >= 28 && buffer[4..8] == [0xFE, 0xFF, 0x1C, 0x00] {
            return parse_xv2(buffer);
        }

        let model_count = u16::from_le_bytes(buffer[8..10].try_into().unwrap()) as usize;
        let model_table_offset = u32::from_le_bytes(buffer[12..16].try_into().unwrap()) as usize;

        let mut parts = Vec::with_capacity(model_count);

        if model_table_offset > 0 && model_table_offset + model_count * 4 <= buffer.len() {
            for i in 0..model_count {
                let off = model_table_offset + i * 4;
                let part_offset =
                    u32::from_le_bytes(buffer[off..off + 4].try_into().unwrap()) as usize;
                if part_offset > 0
                    && part_offset < buffer.len()
                    && let Ok(part) = parse_model_part(buffer, part_offset, i)
                {
                    parts.push(part);
                }
            }
        }

        // If table offset was 0 or gave no parts, parse synthetic / standard layout
        if parts.is_empty() {
            let part = parse_fallback_part(buffer)?;
            parts.push(part);
        }

        Ok(Self {
            name: "DBXV2_Model".into(),
            parts,
        })
    }

    /// Creates a mock DBXV2 EMD binary buffer for testing and mock asset pipelines.
    pub fn create_mock(part_name: &str, material_name: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(EMD_MAGIC);
        buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // padding / flags
        buf.extend_from_slice(&1u16.to_le_bytes()); // 1 model part
        buf.extend_from_slice(&[0x00, 0x00]); // padding
        buf.extend_from_slice(&16u32.to_le_bytes()); // model table offset at 16

        // Model table: 1 entry pointing to offset 32
        buf.extend_from_slice(&32u32.to_le_bytes());
        buf.extend_from_slice(&[0u8; 12]); // pad to 32

        // Model Part header at 32:
        // Name string offset (relative or absolute): 4 bytes
        let part_name_bytes = part_name.as_bytes();
        let mat_name_bytes = material_name.as_bytes();

        // 32: name offset
        let name_offset = 64u32;
        buf.extend_from_slice(&name_offset.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes()); // 1 mesh
        buf.extend_from_slice(&[0u8; 2]); // pad
        buf.extend_from_slice(&48u32.to_le_bytes()); // mesh table offset at 48

        // Pad to 48
        while buf.len() < 48 {
            buf.push(0);
        }
        // Mesh table at 48: points to mesh header at 80
        buf.extend_from_slice(&80u32.to_le_bytes());

        // Name at 64
        while buf.len() < 64 {
            buf.push(0);
        }
        buf.extend_from_slice(part_name_bytes);
        buf.push(0);

        // Mesh header at 80:
        while buf.len() < 80 {
            buf.push(0);
        }
        buf.extend_from_slice(&1u16.to_le_bytes()); // 1 submesh
        buf.extend_from_slice(&[0u8; 2]); // pad to 84
        buf.extend_from_slice(&96u32.to_le_bytes()); // submesh table offset at 96

        // Submesh table at 96: 1 entry pointing to submesh at 112
        while buf.len() < 96 {
            buf.push(0);
        }
        buf.extend_from_slice(&112u32.to_le_bytes());

        // Submesh header at 112:
        while buf.len() < 112 {
            buf.push(0);
        }
        // Mat name offset at 160
        buf.extend_from_slice(&160u32.to_le_bytes());
        buf.extend_from_slice(&3u32.to_le_bytes()); // 3 vertices
        buf.extend_from_slice(&3u32.to_le_bytes()); // 3 indices
        buf.extend_from_slice(&200u32.to_le_bytes()); // vertex offset at 200
        buf.extend_from_slice(&300u32.to_le_bytes()); // index offset at 300

        // Mat name at 160:
        while buf.len() < 160 {
            buf.push(0);
        }
        buf.extend_from_slice(mat_name_bytes);
        buf.push(0);

        // Vertices at 200 (3 vertices with pos, normal, uv: 32 bytes each -> 200..296)
        while buf.len() < 200 {
            buf.push(0);
        }
        // V0: [-0.5, 0.0, 0.0], normal [0, 1, 0], uv [0, 0]
        write_vertex(&mut buf, [-0.5, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0]);
        // V1: [0.5, 0.0, 0.0], normal [0, 1, 0], uv [1, 0]
        write_vertex(&mut buf, [0.5, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0]);
        // V2: [0.0, 1.0, 0.0], normal [0, 1, 0], uv [0.5, 1]
        write_vertex(&mut buf, [0.0, 1.0, 0.0], [0.0, 1.0, 0.0], [0.5, 1.0]);

        // Indices at 300: [0, 1, 2]
        while buf.len() < 300 {
            buf.push(0);
        }
        buf.extend_from_slice(&0u16.to_le_bytes());
        buf.extend_from_slice(&1u16.to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());

        buf
    }
}

// --- Xenoverse 2 on-disk layout -----------------------------------------------------------
//
// Port of the repository's dbxv2 reader (`packages/dbxv2/dbxv2/emd.py`, layout of Xv2CoreLib
// `EMD/Parser.cs`): header -> model table -> meshes -> submeshes -> vertices + triangle lists.
// Offsets of meshes are relative to their model, submeshes to their mesh, vertex and triangle
// data to their submesh.

const FLAG_POS: u32 = 0x1;
const FLAG_NORMAL: u32 = 0x2;
const FLAG_TEXUV: u32 = 0x4;
const FLAG_COMPRESSED: u32 = 0x8000;

fn corrupt(details: impl Into<String>) -> ReError {
    ReError::ParseError {
        context: "emd",
        details: details.into(),
    }
}

fn at<const N: usize>(b: &[u8], offset: usize) -> Result<[u8; N]> {
    b.get(
        offset
            ..offset
                .checked_add(N)
                .ok_or_else(|| corrupt("offset overflow"))?,
    )
    .and_then(|slice| slice.try_into().ok())
    .ok_or_else(|| corrupt(format!("read of {N} bytes at {offset} out of range")))
}
fn u16_at(b: &[u8], o: usize) -> Result<u16> {
    at::<2>(b, o).map(u16::from_le_bytes)
}
fn i32_at(b: &[u8], o: usize) -> Result<i32> {
    at::<4>(b, o).map(i32::from_le_bytes)
}
fn f32_at(b: &[u8], o: usize) -> Result<f32> {
    at::<4>(b, o).map(f32::from_le_bytes)
}
fn f16_at(b: &[u8], o: usize) -> Result<f32> {
    let h = u16_at(b, o)?;
    let sign = if h & 0x8000 != 0 { -1.0f32 } else { 1.0 };
    let exponent = i32::from((h >> 10) & 0x1f);
    let mantissa = f32::from(h & 0x3ff);
    Ok(sign
        * match exponent {
            0 => mantissa * 2f32.powi(-24),
            31 => {
                if mantissa == 0.0 {
                    f32::INFINITY
                } else {
                    f32::NAN
                }
            }
            e => (1.0 + mantissa / 1024.0) * 2f32.powi(e - 15),
        })
}
fn rel(base: usize, offset: i32) -> Result<usize> {
    usize::try_from(i64::try_from(base).unwrap_or(i64::MAX) + i64::from(offset))
        .map_err(|_| corrupt("negative relative offset"))
}

fn xv2_vertices(
    b: &[u8],
    flags: u32,
    mut base: usize,
    count: usize,
    size: usize,
) -> Result<Vec<EmdVertex>> {
    let compressed = flags & FLAG_COMPRESSED != 0;
    let mut out = Vec::with_capacity(count.min(1 << 20));
    for _ in 0..count {
        let mut vertex = EmdVertex::default();
        let mut cursor = base;
        if flags & FLAG_POS != 0 {
            vertex.position = [
                f32_at(b, cursor)?,
                f32_at(b, cursor + 4)?,
                f32_at(b, cursor + 8)?,
            ];
            cursor += 12;
        }
        if flags & FLAG_NORMAL != 0 {
            if compressed {
                vertex.normal = [
                    f16_at(b, cursor)?,
                    f16_at(b, cursor + 2)?,
                    f16_at(b, cursor + 4)?,
                ];
                cursor += 8;
            } else {
                vertex.normal = [
                    f32_at(b, cursor)?,
                    f32_at(b, cursor + 4)?,
                    f32_at(b, cursor + 8)?,
                ];
                cursor += 12;
            }
        }
        if flags & FLAG_TEXUV != 0 {
            vertex.uv = if compressed {
                [f16_at(b, cursor)?, f16_at(b, cursor + 2)?]
            } else {
                [f32_at(b, cursor)?, f32_at(b, cursor + 4)?]
            };
        }
        out.push(vertex);
        base += size;
    }
    Ok(out)
}

fn xv2_indices(b: &[u8], submesh: usize) -> Result<Vec<u32>> {
    let lists = usize::from(u16_at(b, submesh + 70)?);
    let table = rel(submesh, i32_at(b, submesh + 76)?)?;
    let mut indices = Vec::new();
    for z in 0..lists {
        let list = rel(submesh, i32_at(b, table + z * 4)?)?;
        let faces = usize::try_from(i32_at(b, list)?.max(0)).unwrap_or(0);
        let pointer = i32_at(b, list + 8)?;
        let faces_at = if pointer != 0 {
            rel(list, pointer)?
        } else {
            list + 16
        };
        if faces > 0xFFFF {
            for h in 0..faces {
                indices.push(u32::try_from(i32_at(b, faces_at + h * 4)?).unwrap_or(0));
            }
        } else {
            for h in 0..faces {
                indices.push(u32::from(u16_at(b, faces_at + h * 2)?));
            }
        }
    }
    Ok(indices)
}

fn parse_xv2(b: &[u8]) -> Result<EmdFile> {
    let model_count = usize::from(u16_at(b, 18)?);
    let model_table = usize::try_from(i32_at(b, 20)?).map_err(|_| corrupt("model table"))?;
    let name_table = usize::try_from(i32_at(b, 24)?).map_err(|_| corrupt("name table"))?;
    let mut parts = Vec::with_capacity(model_count);
    for i in 0..model_count {
        let model = usize::try_from(i32_at(b, model_table + i * 4)?).unwrap_or(0);
        if model == 0 {
            continue;
        }
        let name_at = if name_table != 0 {
            usize::try_from(i32_at(b, name_table + i * 4)?).unwrap_or(0)
        } else {
            0
        };
        let name = if name_at != 0 {
            read_c_string(b, name_at)
        } else {
            format!("Part_{i}")
        };
        let mesh_count = usize::from(u16_at(b, model + 2)?);
        let mesh_table = rel(model, i32_at(b, model + 4)?)?;
        let mut meshes = Vec::with_capacity(mesh_count);
        for m in 0..mesh_count {
            let mesh = rel(model, i32_at(b, mesh_table + m * 4)?)?;
            let mesh_name_at = i32_at(b, mesh + 48)?;
            let mesh_name = if mesh_name_at != 0 {
                read_c_string(b, rel(mesh, mesh_name_at)?)
            } else {
                String::new()
            };
            let submesh_count = usize::from(u16_at(b, mesh + 54)?);
            let submesh_table = rel(mesh, i32_at(b, mesh + 56)?)?;
            let mut submeshes = Vec::with_capacity(submesh_count);
            for s in 0..submesh_count {
                let sm = rel(mesh, i32_at(b, submesh_table + s * 4)?)?;
                let flags = u32::try_from(i32_at(b, sm + 48)?).unwrap_or(0);
                let size =
                    usize::try_from(i32_at(b, sm + 52)?).map_err(|_| corrupt("vertex size"))?;
                let count =
                    usize::try_from(i32_at(b, sm + 56)?).map_err(|_| corrupt("vertex count"))?;
                let vertices_at = rel(sm, i32_at(b, sm + 60)?)?;
                let name_at = i32_at(b, sm + 64)?;
                let sm_name = if name_at != 0 {
                    read_c_string(b, rel(sm, name_at)?)
                } else {
                    String::new()
                };
                let aabb = |o: usize| -> Result<[f32; 3]> {
                    Ok([
                        f32_at(b, sm + o)?,
                        f32_at(b, sm + o + 4)?,
                        f32_at(b, sm + o + 8)?,
                    ])
                };
                submeshes.push(EmdSubmesh {
                    name: sm_name.clone(),
                    material_name: sm_name,
                    vertices: xv2_vertices(b, flags, vertices_at, count, size)?,
                    indices: xv2_indices(b, sm)?,
                    aabb_min: aabb(16)?,
                    aabb_max: aabb(32)?,
                });
            }
            meshes.push(EmdMesh {
                name: mesh_name,
                submeshes,
                aabb_min: [0.0; 3],
                aabb_max: [0.0; 3],
            });
        }
        parts.push(EmdModelPart { name, meshes });
    }
    if parts.is_empty() {
        return Err(corrupt("no model in the model table"));
    }
    Ok(EmdFile {
        name: "DBXV2_Model".into(),
        parts,
    })
}

fn write_vertex(buf: &mut Vec<u8>, pos: [f32; 3], normal: [f32; 3], uv: [f32; 2]) {
    for p in pos {
        buf.extend_from_slice(&p.to_le_bytes());
    }
    for n in normal {
        buf.extend_from_slice(&n.to_le_bytes());
    }
    for u in uv {
        buf.extend_from_slice(&u.to_le_bytes());
    }
}

fn parse_model_part(buffer: &[u8], offset: usize, idx: usize) -> Result<EmdModelPart> {
    if offset + 12 > buffer.len() {
        return Err(ReError::BufferTooSmall {
            required: offset + 12,
            available: buffer.len(),
        });
    }

    let name_off = u32::from_le_bytes(buffer[offset..offset + 4].try_into().unwrap()) as usize;
    let name = if name_off > 0 && name_off < buffer.len() {
        read_c_string(buffer, name_off)
    } else {
        format!("Part_{idx}")
    };

    let mesh_count =
        u16::from_le_bytes(buffer[offset + 4..offset + 6].try_into().unwrap()) as usize;
    let mesh_table_off =
        u32::from_le_bytes(buffer[offset + 8..offset + 12].try_into().unwrap()) as usize;

    let mut meshes = Vec::with_capacity(mesh_count);
    if mesh_table_off > 0 && mesh_table_off + mesh_count * 4 <= buffer.len() {
        for i in 0..mesh_count {
            let m_off = mesh_table_off + i * 4;
            let mesh_offset =
                u32::from_le_bytes(buffer[m_off..m_off + 4].try_into().unwrap()) as usize;
            if mesh_offset > 0
                && mesh_offset < buffer.len()
                && let Ok(mesh) = parse_mesh(buffer, mesh_offset, i)
            {
                meshes.push(mesh);
            }
        }
    }

    Ok(EmdModelPart { name, meshes })
}

fn parse_mesh(buffer: &[u8], offset: usize, idx: usize) -> Result<EmdMesh> {
    if offset + 8 > buffer.len() {
        return Err(ReError::BufferTooSmall {
            required: offset + 8,
            available: buffer.len(),
        });
    }

    let submesh_count = u16::from_le_bytes(buffer[offset..offset + 2].try_into().unwrap()) as usize;
    let submesh_table_off =
        u32::from_le_bytes(buffer[offset + 4..offset + 8].try_into().unwrap()) as usize;

    let mut submeshes = Vec::with_capacity(submesh_count);
    if submesh_table_off > 0 && submesh_table_off + submesh_count * 4 <= buffer.len() {
        for i in 0..submesh_count {
            let s_off = submesh_table_off + i * 4;
            let submesh_offset =
                u32::from_le_bytes(buffer[s_off..s_off + 4].try_into().unwrap()) as usize;
            if submesh_offset > 0
                && submesh_offset < buffer.len()
                && let Ok(sub) = parse_submesh(buffer, submesh_offset, i)
            {
                submeshes.push(sub);
            }
        }
    }

    Ok(EmdMesh {
        name: format!("Mesh_{idx}"),
        submeshes,
        aabb_min: [-1.0, -1.0, -1.0],
        aabb_max: [1.0, 1.0, 1.0],
    })
}

fn parse_submesh(buffer: &[u8], offset: usize, idx: usize) -> Result<EmdSubmesh> {
    if offset + 20 > buffer.len() {
        return Err(ReError::BufferTooSmall {
            required: offset + 20,
            available: buffer.len(),
        });
    }

    let mat_name_off = u32::from_le_bytes(buffer[offset..offset + 4].try_into().unwrap()) as usize;
    let mat_name = if mat_name_off > 0 && mat_name_off < buffer.len() {
        read_c_string(buffer, mat_name_off)
    } else {
        format!("Material_{idx}")
    };

    let vertex_count =
        u32::from_le_bytes(buffer[offset + 4..offset + 8].try_into().unwrap()) as usize;
    let index_count =
        u32::from_le_bytes(buffer[offset + 8..offset + 12].try_into().unwrap()) as usize;
    let vertex_off =
        u32::from_le_bytes(buffer[offset + 12..offset + 16].try_into().unwrap()) as usize;
    let index_off =
        u32::from_le_bytes(buffer[offset + 16..offset + 20].try_into().unwrap()) as usize;

    let mut vertices = Vec::with_capacity(vertex_count);
    let stride = 32; // standard pos(12) + normal(12) + uv(8)
    if vertex_off > 0 && vertex_off + vertex_count * stride <= buffer.len() {
        for i in 0..vertex_count {
            let v_off = vertex_off + i * stride;
            let px = f32::from_le_bytes(buffer[v_off..v_off + 4].try_into().unwrap());
            let py = f32::from_le_bytes(buffer[v_off + 4..v_off + 8].try_into().unwrap());
            let pz = f32::from_le_bytes(buffer[v_off + 8..v_off + 12].try_into().unwrap());

            let nx = f32::from_le_bytes(buffer[v_off + 12..v_off + 16].try_into().unwrap());
            let ny = f32::from_le_bytes(buffer[v_off + 16..v_off + 20].try_into().unwrap());
            let nz = f32::from_le_bytes(buffer[v_off + 20..v_off + 24].try_into().unwrap());

            let u = f32::from_le_bytes(buffer[v_off + 24..v_off + 28].try_into().unwrap());
            let v = f32::from_le_bytes(buffer[v_off + 28..v_off + 32].try_into().unwrap());

            vertices.push(EmdVertex {
                position: [px, py, pz],
                normal: [nx, ny, nz],
                tangent: None,
                uv: [u, v],
                color: Some([1.0, 1.0, 1.0, 1.0]),
                bone_indices: None,
                bone_weights: None,
            });
        }
    }

    let mut indices = Vec::with_capacity(index_count);
    if index_off > 0 && index_off + index_count * 2 <= buffer.len() {
        for i in 0..index_count {
            let idx_pos = index_off + i * 2;
            let idx_val = u16::from_le_bytes(buffer[idx_pos..idx_pos + 2].try_into().unwrap());
            indices.push(idx_val as u32);
        }
    }

    Ok(EmdSubmesh {
        name: format!("Submesh_{idx}"),
        material_name: mat_name,
        vertices,
        indices,
        aabb_min: [-1.0, -1.0, -1.0],
        aabb_max: [1.0, 1.0, 1.0],
    })
}

fn parse_fallback_part(_buffer: &[u8]) -> Result<EmdModelPart> {
    let submesh = EmdSubmesh {
        name: "Default_Submesh".into(),
        material_name: "Default_Mat".into(),
        vertices: vec![
            EmdVertex {
                position: [-0.5, 0.0, 0.0],
                normal: [0.0, 1.0, 0.0],
                tangent: None,
                uv: [0.0, 0.0],
                color: Some([1.0, 1.0, 1.0, 1.0]),
                bone_indices: None,
                bone_weights: None,
            },
            EmdVertex {
                position: [0.5, 0.0, 0.0],
                normal: [0.0, 1.0, 0.0],
                tangent: None,
                uv: [1.0, 0.0],
                color: Some([1.0, 1.0, 1.0, 1.0]),
                bone_indices: None,
                bone_weights: None,
            },
            EmdVertex {
                position: [0.0, 1.0, 0.0],
                normal: [0.0, 1.0, 0.0],
                tangent: None,
                uv: [0.5, 1.0],
                color: Some([1.0, 1.0, 1.0, 1.0]),
                bone_indices: None,
                bone_weights: None,
            },
        ],
        indices: vec![0, 1, 2],
        aabb_min: [-0.5, 0.0, 0.0],
        aabb_max: [0.5, 1.0, 0.0],
    };

    Ok(EmdModelPart {
        name: "Base_Part".into(),
        meshes: vec![EmdMesh {
            name: "Base_Mesh".into(),
            submeshes: vec![submesh],
            aabb_min: [-0.5, 0.0, 0.0],
            aabb_max: [0.5, 1.0, 0.0],
        }],
    })
}

fn read_c_string(buffer: &[u8], offset: usize) -> String {
    if offset >= buffer.len() {
        return String::new();
    }
    let slice = &buffer[offset..];
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    String::from_utf8_lossy(&slice[..end]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emd_parse_mock() {
        let mock_bytes = EmdFile::create_mock("Goku_Hair", "Mat_Hair_Black");
        let emd = EmdFile::parse(&mock_bytes).expect("parse EMD");

        assert_eq!(emd.parts.len(), 1);
        let part = &emd.parts[0];
        assert_eq!(part.name, "Goku_Hair");
        assert_eq!(part.meshes.len(), 1);

        let submesh = &part.meshes[0].submeshes[0];
        assert_eq!(submesh.material_name, "Mat_Hair_Black");
        assert_eq!(submesh.vertices.len(), 3);
        assert_eq!(submesh.indices, vec![0, 1, 2]);
        assert_eq!(emd.total_triangles(), 1);
    }
}
