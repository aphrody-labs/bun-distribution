// Copyright 2026 aphrody-code
// SPDX-License-Identifier: Apache-2.0

use aphrody_n2b_registry::{APIS, CLI, GLOBALS, MODULES, PACKAGES};
use regex::Regex;

/// Le champ `docs` (présent dans les 5 schémas d'entrée, cf. schema.rs)
/// sert de citation libre vers `docs/bun/**` ou `docs/node/**` (la base
/// de connaissance clonée depuis oven-sh/bun et nodejs/node — voir
/// docs/README.md). C'est la seule intégration native entre le registre
/// et cette doc : sans ce test, une citation `docs = "…docs/bun/x.mdx…"`
/// peut pourrir en silence dès que le fichier upstream bouge ou est
/// renommé (ce qui arrive à chaque régénération de docs/bun/).
#[test]
fn docs_field_citations_resolve() {
    use std::path::PathBuf;

    // $CARGO_MANIFEST_DIR pointe sur crates/compat/bun-docs/. Trois
    // parents au-dessus → racine du repo.
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("repo root")
        .to_path_buf();
    // Citations `docs/bun/<x>` resolve to the canonical Bun docs mirror
    // `docs/<category>/upstream-bun/<x>`; `docs/node/<x>` to the Node API
    // snapshot `docs/<category>/compat/n2b/node/<x>`.
    const CATEGORIES: [&str; 9] = [
        "apis",
        "architecture",
        "decisions",
        "guides",
        "operations",
        "plans",
        "products",
        "reference",
        "research",
    ];
    let resolves = |rel: &str| -> bool {
        let Some((kind, sub)) = rel.trim_start_matches("docs/").split_once('/') else {
            return false;
        };
        let owner = if kind == "bun" { "upstream-bun" } else { "compat/n2b/node" };
        CATEGORIES.iter().any(|c| repo_root.join("docs").join(c).join(owner).join(sub).is_file())
    };

    let path_re = Regex::new(r"docs/(?:bun|node)/[A-Za-z0-9_./-]+\.mdx?").unwrap();

    let all_docs_fields: Vec<(&str, &str)> = APIS
        .iter()
        .map(|e| (e.id.as_str(), e.docs.as_str()))
        .chain(PACKAGES.iter().map(|e| (e.id.as_str(), e.docs.as_str())))
        .chain(MODULES.iter().map(|e| (e.id.as_str(), e.docs.as_str())))
        .chain(CLI.iter().map(|e| (e.id.as_str(), e.docs.as_str())))
        .chain(GLOBALS.iter().map(|e| (e.id.as_str(), e.docs.as_str())))
        .collect();

    let mut checked = 0usize;
    for (id, docs) in all_docs_fields {
        for m in path_re.find_iter(docs) {
            checked += 1;
            let rel = m.as_str();
            assert!(
                resolves(rel),
                "{id}: docs = \"{docs}\" cite {rel}, introuvable sous docs/<category>/upstream-bun \
                 ou docs/<category>/compat/n2b/node (doc upstream renommée/déplacée)"
            );
        }
    }
    assert!(
        checked > 0,
        "aucune citation docs/bun|node/*.md(x) trouvée dans le registre — ce test est devenu \
         un no-op silencieux, vérifier que les entrées `docs = \"...\"` existantes n'ont pas \
         été supprimées"
    );
}
