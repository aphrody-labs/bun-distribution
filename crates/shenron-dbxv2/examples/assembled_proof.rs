// SPDX-License-Identifier: Apache-2.0
//! Proof: EMD (+ESK, EMB) -> `model_assembled_json` -> serde -> the real `AssembledModel` -> GLB.
//! Usage: assembled_proof <name> <emd> [emb] [esk]  (paths of decoded game files, nothing is written)

use std::{env, fs};

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let [name, emd, rest @ ..] = args.as_slice() else {
        eprintln!("usage: assembled_proof <name> <emd> [emb|-] [esk|-]");
        std::process::exit(2);
    };
    let read = |i: usize| rest.get(i).filter(|p| *p != "-").map(|p| fs::read(p).expect("read"));
    let (emd, emb, esk) = (fs::read(emd).expect("read emd"), read(0), read(1));
    let json = bun_re::game::api::model_assembled_json(name, &emd, emb.as_deref(), esk.as_deref())
        .expect("adapter");
    let bytes = serde_json::to_vec(&json).expect("json");
    let model = shenron_dbxv2::assembled::from_json(&bytes).expect("deserialise into AssembledModel");
    let skinned = model.primitives.iter().filter(|p| p.skin.is_some()).count();
    println!("json bytes: {}", bytes.len());
    println!(
        "AssembledModel: primitives={} vertices={} triangles={} skinned_primitives={} bones={}",
        model.primitives.len(),
        model.total_vertex_count(),
        model.total_triangle_count(),
        skinned,
        model.skeleton.as_ref().map_or(0, |s| s.bones.len()),
    );
    let glb = model.to_glb();
    println!("to_glb: {} bytes, magic {:?}", glb.len(), std::str::from_utf8(&glb[..4]).unwrap_or("?"));
    let reference = bun_re::game::api::model_glb(name, &emd, emb.as_deref(), esk.as_deref());
    println!("bun_re model_glb: {:?} bytes", reference.map(|g| g.len()));
}
