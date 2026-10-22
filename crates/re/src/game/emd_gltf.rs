// SPDX-License-Identifier: Apache-2.0
//! Export a parsed DBXV2 `.emd` object to a binary glTF (GLB), so a Xenoverse model goes through
//! the same renderer as the Inazuma Eleven models (`aphrody-nie-render3d` / `nie render glb-png`).
//!
//! Each EMD submesh becomes one glTF mesh primitive with `POSITION`, `NORMAL` and `TEXCOORD_0`
//! and `UNSIGNED_INT` indices (triangles). Skinning, tangents, colours and materials are dropped:
//! this is a geometry bridge for visual inspection, not a faithful asset conversion.

use serde_json::{Value, json};

use super::formats::EmdFile;

const FLOAT: u32 = 5126;
const UNSIGNED_INT: u32 = 5125;
const ARRAY_BUFFER: u32 = 34962;
const ELEMENT_ARRAY_BUFFER: u32 = 34963;
const TRIANGLES: u32 = 4;

/// Encode `emd` as a self-contained GLB (glТF 2.0 binary).
#[must_use]
pub fn emd_to_glb(emd: &EmdFile) -> Vec<u8> {
    let mut bin: Vec<u8> = Vec::new();
    let mut buffer_views: Vec<Value> = Vec::new();
    let mut accessors: Vec<Value> = Vec::new();
    let mut meshes: Vec<Value> = Vec::new();
    let mut nodes: Vec<Value> = Vec::new();

    // Append `data` to the binary buffer as a bufferView, 4-byte aligned, and return its index.
    let mut push_view = |bin: &mut Vec<u8>, buffer_views: &mut Vec<Value>, data: &[u8], target: u32| -> usize {
        while bin.len() % 4 != 0 {
            bin.push(0);
        }
        let offset = bin.len();
        bin.extend_from_slice(data);
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": data.len(),
            "target": target,
        }));
        buffer_views.len() - 1
    };

    for part in &emd.parts {
        for mesh in &part.meshes {
            let mut primitives: Vec<Value> = Vec::new();
            for submesh in &mesh.submeshes {
                if submesh.vertices.is_empty() || submesh.indices.is_empty() {
                    continue;
                }
                let count = submesh.vertices.len();
                let mut positions = Vec::with_capacity(count * 12);
                let mut normals = Vec::with_capacity(count * 12);
                let mut uvs = Vec::with_capacity(count * 8);
                let (mut min, mut max) = ([f32::MAX; 3], [f32::MIN; 3]);
                for vertex in &submesh.vertices {
                    for axis in 0..3 {
                        let value = vertex.position[axis];
                        min[axis] = min[axis].min(value);
                        max[axis] = max[axis].max(value);
                    }
                    positions.extend_from_slice(bytemuck_f32x3(vertex.position).as_slice());
                    normals.extend_from_slice(bytemuck_f32x3(vertex.normal).as_slice());
                    uvs.extend_from_slice(&vertex.uv[0].to_le_bytes());
                    uvs.extend_from_slice(&vertex.uv[1].to_le_bytes());
                }
                let mut indices = Vec::with_capacity(submesh.indices.len() * 4);
                for index in &submesh.indices {
                    indices.extend_from_slice(&index.to_le_bytes());
                }

                let pos_view = push_view(&mut bin, &mut buffer_views, &positions, ARRAY_BUFFER);
                accessors.push(json!({
                    "bufferView": pos_view, "componentType": FLOAT, "count": count,
                    "type": "VEC3", "min": min, "max": max,
                }));
                let pos_acc = accessors.len() - 1;

                let nrm_view = push_view(&mut bin, &mut buffer_views, &normals, ARRAY_BUFFER);
                accessors.push(json!({
                    "bufferView": nrm_view, "componentType": FLOAT, "count": count, "type": "VEC3",
                }));
                let nrm_acc = accessors.len() - 1;

                let uv_view = push_view(&mut bin, &mut buffer_views, &uvs, ARRAY_BUFFER);
                accessors.push(json!({
                    "bufferView": uv_view, "componentType": FLOAT, "count": count, "type": "VEC2",
                }));
                let uv_acc = accessors.len() - 1;

                let idx_view = push_view(&mut bin, &mut buffer_views, &indices, ELEMENT_ARRAY_BUFFER);
                accessors.push(json!({
                    "bufferView": idx_view, "componentType": UNSIGNED_INT,
                    "count": submesh.indices.len(), "type": "SCALAR",
                }));
                let idx_acc = accessors.len() - 1;

                primitives.push(json!({
                    "attributes": { "POSITION": pos_acc, "NORMAL": nrm_acc, "TEXCOORD_0": uv_acc },
                    "indices": idx_acc,
                    "mode": TRIANGLES,
                }));
            }
            if primitives.is_empty() {
                continue;
            }
            meshes.push(json!({ "name": mesh.name, "primitives": primitives }));
            nodes.push(json!({ "name": mesh.name, "mesh": meshes.len() - 1 }));
        }
    }

    let gltf = json!({
        "asset": { "version": "2.0", "generator": "bunre dbxv2 emd-glb" },
        "scene": 0,
        "scenes": [ { "nodes": (0..nodes.len()).collect::<Vec<_>>() } ],
        "nodes": nodes,
        "meshes": meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [ { "byteLength": bin.len() } ],
    });

    package_glb(&serde_json::to_vec(&gltf).unwrap_or_default(), &bin)
}

fn bytemuck_f32x3(values: [f32; 3]) -> [u8; 12] {
    let mut out = [0u8; 12];
    for (slot, value) in out.chunks_exact_mut(4).zip(values) {
        slot.copy_from_slice(&value.to_le_bytes());
    }
    out
}

/// Wrap a glTF JSON document and its binary buffer into the GLB container.
fn package_glb(json: &[u8], bin: &[u8]) -> Vec<u8> {
    fn pad(chunk: &mut Vec<u8>, fill: u8) {
        while chunk.len() % 4 != 0 {
            chunk.push(fill);
        }
    }
    let mut json_chunk = json.to_vec();
    pad(&mut json_chunk, b' ');
    let mut bin_chunk = bin.to_vec();
    pad(&mut bin_chunk, 0);

    let total = 12 + 8 + json_chunk.len() + 8 + bin_chunk.len();
    let mut glb = Vec::with_capacity(total);
    glb.extend_from_slice(b"glTF");
    glb.extend_from_slice(&2u32.to_le_bytes());
    glb.extend_from_slice(&(total as u32).to_le_bytes());
    glb.extend_from_slice(&(json_chunk.len() as u32).to_le_bytes());
    glb.extend_from_slice(b"JSON");
    glb.extend_from_slice(&json_chunk);
    glb.extend_from_slice(&(bin_chunk.len() as u32).to_le_bytes());
    glb.extend_from_slice(b"BIN\0");
    glb.extend_from_slice(&bin_chunk);
    glb
}
