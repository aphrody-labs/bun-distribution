// SPDX-License-Identifier: Apache-2.0
//! JSON of `shenron_dbxv2_model_assembled_json` -> the real `AssembledModel` of
//! `aphrody-nie-formats`, the type `aphrody-nie-model-serve` exports to GLB.

use aphrody_nie_formats::{
    assemble::{AssembledModel, MeshComponent, MeshPrimitive, PrimitiveSkin, Skeleton, SkeletonBone},
    g4mg::{Vec2, Vec3, Vec4},
    g4sk::LocalTrs,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct SkinJson {
    joints: Vec<[u16; 8]>,
    weights: Vec<[f32; 8]>,
}

#[derive(Deserialize)]
struct PrimitiveJson {
    component: String,
    source_index: usize,
    material_index: u8,
    material_name: String,
    texture_uri: String,
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    uv0: Vec<[f32; 2]>,
    colors: Vec<[f32; 4]>,
    indices: Vec<u32>,
    skin: Option<SkinJson>,
    piece: String,
}

#[derive(Deserialize)]
struct LocalJson {
    scale: [f32; 3],
    quat: [f32; 4],
    translation: [f32; 3],
}

#[derive(Deserialize)]
struct BoneJson {
    name: String,
    hash: u32,
    parent: Option<usize>,
    local: LocalJson,
    inverse_bind: [[f32; 4]; 4],
}

#[derive(Deserialize)]
struct SkeletonJson {
    source: String,
    bones: Vec<BoneJson>,
}

#[derive(Deserialize)]
struct ModelJson {
    internal_code: String,
    body_glb: String,
    face_glb: String,
    uniform_crc: u32,
    primitives: Vec<PrimitiveJson>,
    skeleton: Option<SkeletonJson>,
    report: serde_json::Value,
    strict_materials: bool,
}

fn component(name: &str) -> Result<MeshComponent, String> {
    Ok(match name {
        "Body" => MeshComponent::Body,
        "Face" => MeshComponent::Face,
        "Uniform" => MeshComponent::Uniform,
        "Keshin" => MeshComponent::Keshin,
        "Armed" => MeshComponent::Armed,
        "Generic" => MeshComponent::Generic,
        other => return Err(format!("unknown component `{other}`")),
    })
}

/// Build the `AssembledModel` described by the adapter JSON. `embedded_textures`, `aux_textures`
/// and animation lists are empty, as in the JSON.
pub fn from_json(json: &[u8]) -> Result<AssembledModel, String> {
    let model: ModelJson = serde_json::from_slice(json).map_err(|error| error.to_string())?;
    let primitives = model
        .primitives
        .into_iter()
        .map(|p| {
            Ok(MeshPrimitive {
                component: component(&p.component)?,
                source_index: p.source_index,
                material_index: p.material_index,
                material_name: p.material_name,
                texture_uri: p.texture_uri,
                positions: p.positions.iter().map(|v| Vec3 { x: v[0], y: v[1], z: v[2] }).collect(),
                normals: p.normals.iter().map(|v| Vec3 { x: v[0], y: v[1], z: v[2] }).collect(),
                uv0: p.uv0.iter().map(|v| Vec2 { u: v[0], v: v[1] }).collect(),
                colors: p
                    .colors
                    .iter()
                    .map(|v| Vec4 { x: v[0], y: v[1], z: v[2], w: v[3] })
                    .collect(),
                indices: p.indices,
                skin: p.skin.map(|s| PrimitiveSkin { joints: s.joints, weights: s.weights }),
                piece: p.piece,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let skeleton = model.skeleton.map(|s| Skeleton {
        source: s.source,
        bones: s
            .bones
            .into_iter()
            .map(|b| SkeletonBone {
                name: b.name,
                hash: b.hash,
                parent: b.parent,
                local: LocalTrs {
                    scale: b.local.scale,
                    quat: b.local.quat,
                    translation: b.local.translation,
                },
                inverse_bind: b.inverse_bind,
            })
            .collect(),
    });
    Ok(AssembledModel {
        internal_code: model.internal_code,
        body_glb: model.body_glb,
        face_glb: model.face_glb,
        uniform_crc: model.uniform_crc,
        primitives,
        embedded_textures: Vec::new(),
        skeleton,
        aux_textures: Vec::new(),
        report: model.report,
        strict_materials: model.strict_materials,
        animation_clips: Vec::new(),
        animation_excluded: Vec::new(),
    })
}
