// Copyright 2026 aphrody-code
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//! Extraction des specifiers d'import/require + construction d'un
//! `ImportGraph` (binding local → specifier source) via AST oxc.
//!
//! `extract_specifiers` reste pour la couche `node_imports` (rewriting du
//! string littéral). `build_import_graph` produit la structure consommée par
//! `engine.rs` / `bun_apis.rs` pour filtrer les `api/*` par `import_from`
//! (résout PS1).

use aphrody_n2b_registry::{BindingKind, ImportBinding, ImportGraph};
use oxc_allocator::Allocator;
use oxc_ast::ast::{
    BindingPattern, Declaration, Expression, ImportDeclarationSpecifier, Statement,
    VariableDeclarator,
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, ops::Range};

#[derive(Debug, Clone)]
pub struct Specifier {
    pub value: String,
    /// Offset byte du premier char du specifier (après la quote).
    pub inner_start: u32,
    pub inner_len: u32,
}

/// N2B's view of the `PageArtifact` JSON hand-off produced by Aphrody Web
/// (`aphrody_web_service::page_artifact`). The serialized shape is the contract: N2B sits in a
/// lower layer than aphrody-web (docs/REPO-LAYERING.md) and never links it. Only
/// the fields N2B reads are declared; the producer may add more.
#[derive(Debug, Clone, Deserialize)]
pub struct PageArtifact {
    pub url: String,
    #[serde(default)]
    pub extracted: ArtifactContent,
    #[serde(default)]
    pub scripts: Vec<PageScript>,
}

/// Normalized content summary of a [`PageArtifact`].
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ArtifactContent {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub canonical: Option<String>,
    #[serde(default)]
    pub simhash: String,
    #[serde(default)]
    pub word_count: usize,
}

/// One JavaScript unit discovered while crawling HTML. External scripts keep their resolved URL
/// and are never fetched by N2B.
#[derive(Debug, Clone, Deserialize)]
pub struct PageScript {
    /// Absolute URL for `src`, or `None` for inline source.
    pub url: Option<String>,
    /// Inline source only.
    pub source: Option<String>,
    /// `true` for module scripts.
    #[serde(default)]
    pub module: bool,
}

/// Static N2B view of one script handed off by the browser/crawler pipeline.
/// External scripts are intentionally reported but not fetched here: network
/// acquisition belongs to Aphrody Web/Browser, while N2B remains parse-only.
#[derive(Debug, Clone, Serialize)]
pub struct WebScriptAnalysis {
    pub url: Option<String>,
    pub module: bool,
    pub source_available: bool,
    pub specifiers: Vec<String>,
}

/// Analyses inline JavaScript from a shared web artifact with OXC. This is the
/// explicit Aphrody Web/Browser → N2B hand-off: rendered HTML is reused, but its
/// scripts are never executed by N2B.
pub fn analyze_page_artifact(artifact: &PageArtifact) -> Vec<WebScriptAnalysis> {
    artifact
        .scripts
        .iter()
        .enumerate()
        .map(|(index, script)| {
            let source_available = script.source.is_some();
            let path =
                script.url.clone().unwrap_or_else(|| format!("{}#inline-{index}.js", artifact.url));
            let specifiers = script
                .source
                .as_deref()
                .map(|source| {
                    extract_specifiers(&path, source).into_iter().map(|item| item.value).collect()
                })
                .unwrap_or_default();
            WebScriptAnalysis {
                url: script.url.clone(),
                module: script.module,
                source_available,
                specifiers,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Visitor CJS — uniquement pour require()
// ---------------------------------------------------------------------------

struct RequireCollect {
    out: Vec<Specifier>,
}

impl RequireCollect {
    fn push_string_literal(&mut self, lit: &oxc_ast::ast::StringLiteral) {
        let value = lit.value.as_str().to_string();
        let inner_start = lit.span.start + 1;
        let inner_len = value.len() as u32;
        self.out.push(Specifier { value, inner_start, inner_len });
    }
}

impl<'a> Visit<'a> for RequireCollect {
    fn visit_call_expression(&mut self, it: &oxc_ast::ast::CallExpression<'a>) {
        let is_require =
            matches!(&it.callee, Expression::Identifier(ident) if ident.name.as_str() == "require");
        if is_require && let Some(oxc_ast::ast::Argument::StringLiteral(lit)) = it.arguments.first()
        {
            self.push_string_literal(lit);
        }
        oxc_ast_visit::walk::walk_call_expression(self, it);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn source_type_from_path(path: &str) -> SourceType {
    SourceType::from_path(path).unwrap_or_else(|_| SourceType::default())
}

#[inline]
fn is_string_quote(b: u8) -> bool {
    matches!(b, b'\'' | b'"' | b'`')
}

// ---------------------------------------------------------------------------
// API publique — extract_specifiers (rewriting node:* prefix)
// ---------------------------------------------------------------------------

pub fn extract_specifiers(path: &str, source: &str) -> Vec<Specifier> {
    let allocator = Allocator::default();
    let st = source_type_from_path(path);
    let ret = Parser::new(&allocator, source, st).parse();

    let module = &ret.module_record;
    let src_bytes = source.as_bytes();

    let cap = module.requested_modules.len() + module.dynamic_imports.len() + 4;
    let mut out: Vec<Specifier> = Vec::with_capacity(cap);

    for (name_str, occurrences) in &module.requested_modules {
        let value = name_str.as_str().to_string();
        for rm in occurrences.iter() {
            let inner_start = rm.span.start + 1;
            let raw_len = rm.span.end.saturating_sub(rm.span.start).saturating_sub(2);
            out.push(Specifier { value: value.clone(), inner_start, inner_len: raw_len });
        }
    }

    for di in module.dynamic_imports.iter() {
        let span = di.module_request;
        if span.start < span.end {
            let start = span.start as usize;
            if src_bytes.get(start).copied().is_some_and(is_string_quote) {
                let value_bytes = &src_bytes[start + 1..span.end as usize - 1];
                let value = std::str::from_utf8(value_bytes).unwrap_or("").to_string();
                let inner_start = span.start + 1;
                let inner_len = span.end.saturating_sub(span.start).saturating_sub(2);
                out.push(Specifier { value, inner_start, inner_len });
            }
        }
    }

    let mut cjs = RequireCollect { out: Vec::new() };
    for stmt in &ret.program.body {
        oxc_ast_visit::walk::walk_statement(&mut cjs, stmt);
    }
    out.extend(cjs.out);

    out
}

// ---------------------------------------------------------------------------
// API publique — build_import_graph (binding → specifier)
// ---------------------------------------------------------------------------

/// Visitor qui résout les bindings locaux → (specifier, kind).
pub(crate) struct SourceContext {
    pub imports: ImportGraph,
    pub ignored_starts: Vec<Range<u32>>,
    pub spawn_calls: Vec<usize>,
}

struct GraphCollect {
    graph: ImportGraph,
    ignored_starts: Vec<Range<u32>>,
    bindings: HashMap<String, usize>,
    calls: Vec<(usize, String, Option<String>)>,
}

impl GraphCollect {
    fn add(&mut self, name: String, specifier: String, kind: BindingKind) {
        self.graph.bindings.insert(name, ImportBinding { specifier, kind });
    }

    /// `const x = require("foo")` ou `const { a, b: c } = require("foo")`.
    /// Ne traite que le cas où l'argument est un string littéral statique.
    fn handle_variable_declarator<'a>(&mut self, vd: &VariableDeclarator<'a>) {
        let Some(init) = vd.init.as_ref() else {
            return;
        };
        // Forme directe : require("foo")
        let specifier = match init {
            Expression::CallExpression(call) => extract_require_arg(call),
            // Forme via membre : require("foo").default ou require("foo").x
            // Non supportée pour le moment (ajouterait de la complexité ; les
            // bindings résolus ici servent à filtrer les api/*, et ces formes
            // sont rares dans le code Node moderne).
            _ => None,
        };
        let Some(spec) = specifier else { return };
        self.bind_pattern(&vd.id, &spec);
    }

    /// Lie tous les noms du pattern de destructuration au specifier.
    fn bind_pattern(&mut self, pattern: &BindingPattern<'_>, specifier: &str) {
        match pattern {
            BindingPattern::BindingIdentifier(id) => {
                self.add(id.name.as_str().to_string(), specifier.to_string(), BindingKind::Require);
            },
            BindingPattern::ObjectPattern(op) => {
                for prop in &op.properties {
                    // `{ a }` → `a` (shorthand) ; `{ a: b }` → `b` (renamed)
                    self.bind_pattern(&prop.value, specifier);
                }
            },
            // Array/AssignmentPattern : non pertinents pour les bindings de require()
            _ => {},
        }
    }
}

fn extract_require_arg<'a>(call: &oxc_ast::ast::CallExpression<'a>) -> Option<String> {
    let is_require =
        matches!(&call.callee, Expression::Identifier(id) if id.name.as_str() == "require");
    if !is_require {
        return None;
    }
    let oxc_ast::ast::Argument::StringLiteral(lit) = call.arguments.first()? else {
        return None;
    };
    Some(lit.value.as_str().to_string())
}

impl<'a> Visit<'a> for GraphCollect {
    fn visit_binding_identifier(&mut self, it: &oxc_ast::ast::BindingIdentifier<'a>) {
        *self.bindings.entry(it.name.to_string()).or_default() += 1;
    }
    fn visit_string_literal(&mut self, it: &oxc_ast::ast::StringLiteral<'a>) {
        self.ignored_starts.push(it.span.start..it.span.end);
    }
    fn visit_template_element(&mut self, it: &oxc_ast::ast::TemplateElement<'a>) {
        self.ignored_starts.push(it.span.start..it.span.end);
    }
    fn visit_reg_exp_literal(&mut self, it: &oxc_ast::ast::RegExpLiteral<'a>) {
        self.ignored_starts.push(it.span.start..it.span.end);
    }
    fn visit_jsx_text(&mut self, it: &oxc_ast::ast::JSXText<'a>) {
        self.ignored_starts.push(it.span.start..it.span.end);
    }
    fn visit_static_member_expression(&mut self, it: &oxc_ast::ast::StaticMemberExpression<'a>) {
        // A property suffix is not a free identifier: Bun.spawn != spawn.
        self.ignored_starts.push(it.property.span.start..it.property.span.end);
        oxc_ast_visit::walk::walk_static_member_expression(self, it);
    }
    fn visit_call_expression(&mut self, it: &oxc_ast::ast::CallExpression<'a>) {
        match &it.callee {
            Expression::Identifier(id) => {
                self.calls.push((it.callee.span().start as usize, id.name.to_string(), None))
            },
            Expression::StaticMemberExpression(member) => {
                if let Expression::Identifier(id) = &member.object {
                    self.calls.push((
                        it.callee.span().start as usize,
                        id.name.to_string(),
                        Some(member.property.name.to_string()),
                    ));
                }
            },
            _ => {},
        }
        oxc_ast_visit::walk::walk_call_expression(self, it);
    }
    fn visit_import_declaration(&mut self, it: &oxc_ast::ast::ImportDeclaration<'a>) {
        self.ignored_starts.push(it.source.span.start..it.source.span.end);
        let specifier = it.source.value.as_str().to_string();
        let Some(specs) = it.specifiers.as_ref() else {
            // import "foo" (side-effect) — pas de binding local.
            return;
        };
        for s in specs {
            match s {
                ImportDeclarationSpecifier::ImportDefaultSpecifier(d) => {
                    self.add(
                        d.local.name.as_str().to_string(),
                        specifier.clone(),
                        BindingKind::Default,
                    );
                },
                ImportDeclarationSpecifier::ImportSpecifier(n) => {
                    let imported = n.imported.name().as_str().to_string();
                    self.add(
                        n.local.name.as_str().to_string(),
                        specifier.clone(),
                        BindingKind::Named { imported },
                    );
                },
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(ns) => {
                    self.add(
                        ns.local.name.as_str().to_string(),
                        specifier.clone(),
                        BindingKind::Namespace,
                    );
                },
            }
        }
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        self.handle_variable_declarator(it);
        oxc_ast_visit::walk::walk_variable_declarator(self, it);
    }
}

/// Construit le graphe d'imports d'un fichier JS/TS.
///
/// Couvre :
/// - `import x from "foo"` (Default)
/// - `import { a, b as c } from "foo"` (Named)
/// - `import * as ns from "foo"` (Namespace)
/// - `const x = require("foo")` (Require, identifier)
/// - `const { a, b: c } = require("foo")` (Require, destructuring)
///
/// Hors scope (Phase 2) : require() via membre (`require("foo").default`),
/// require() dynamique (argument variable). Ces formes laissent le binding
/// non résolu — `resolves()` retournera `false` et le finding api/* sera
/// silencieux par défaut. Le pattern dynamique est un cas Phase 5
/// (rule `globals/require-dynamic`).
pub fn build_import_graph(path: &str, source: &str) -> ImportGraph {
    build_source_context(path, source).imports
}

pub(crate) fn build_source_context(path: &str, source: &str) -> SourceContext {
    let allocator = Allocator::default();
    let st = source_type_from_path(path);
    let ret = Parser::new(&allocator, source, st).parse();

    let mut collect = GraphCollect {
        graph: ImportGraph::new(),
        ignored_starts: ret
            .program
            .comments
            .iter()
            .map(|c| c.span.start..c.span.end)
            .chain(ret.program.directives.iter().map(|d| d.span.start..d.span.end))
            .collect(),
        bindings: HashMap::new(),
        calls: Vec::new(),
    };

    // Statements top-level — couvre le cas commun (imports en tête de fichier
    // ou require() au top-level/dans un bloc). Le visitor traverse récursivement.
    for stmt in &ret.program.body {
        match stmt {
            Statement::ImportDeclaration(d) => collect.visit_import_declaration(d),
            Statement::VariableDeclaration(d) => {
                for decl in &d.declarations {
                    collect.visit_variable_declarator(decl);
                }
            },
            // Pour les require() imbriqués (try/catch, fonction d'init), on
            // descend via le walker générique.
            other => oxc_ast_visit::walk::walk_statement(&mut collect, other),
        }
        // Visit the export-from declarations which can re-export bindings.
        if let Statement::ExportDeclaration(end) = stmt
            && let Declaration::VariableDeclaration(vd) = &end.declaration
        {
            for decl in &vd.declarations {
                collect.visit_variable_declarator(decl);
            }
        }
    }

    let spawn_calls = collect
        .calls
        .iter()
        .filter_map(|(start, root, member)| {
            let binding = collect.graph.bindings.get(root)?;
            if binding.specifier.trim_start_matches("node:") != "child_process" {
                return None;
            }
            let declarations = collect.bindings.get(root).copied().unwrap_or_default();
            // Conservative when a local declaration shadows an import anywhere in
            // the file. Without scope resolution, never rewrite an ambiguous call.
            let allowed_declarations = usize::from(matches!(binding.kind, BindingKind::Require));
            if declarations > allowed_declarations {
                return None;
            }
            let is_spawn = match (&binding.kind, member.as_deref()) {
                (BindingKind::Named { imported }, None) => imported == "spawn",
                (
                    BindingKind::Namespace | BindingKind::Default | BindingKind::Require,
                    Some("spawn"),
                ) => true,
                (BindingKind::Require, None) => root == "spawn",
                _ => false,
            };
            is_spawn.then_some(*start)
        })
        .collect();
    SourceContext { imports: collect.graph, ignored_starts: collect.ignored_starts, spawn_calls }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_artifacts_are_analyzed_without_evaluating_their_scripts() {
        // The JSON aphrody_web_service::page_artifact serializes for this page (extra producer
        // fields such as `html` and `media_type` are ignored).
        let artifact: PageArtifact = serde_json::from_str(
            r#"{
                "url": "https://example.test/app",
                "html": "<script type=\"module\">...</script>",
                "extracted": { "title": "", "canonical": null, "simhash": "0", "word_count": 0, "text": "" },
                "scripts": [
                    { "url": null, "source": "import fs from \"node:fs\"; require(\"pkg\");", "media_type": "module", "module": true },
                    { "url": "https://example.test/assets/app.js", "source": null, "media_type": null, "module": false }
                ]
            }"#,
        )
        .unwrap();
        let analysis = analyze_page_artifact(&artifact);
        assert_eq!(analysis.len(), 2);
        assert!(analysis[0].source_available);
        assert!(analysis[0].module);
        assert_eq!(analysis[0].specifiers, ["node:fs", "pkg"]);
        assert!(!analysis[1].source_available);
        assert_eq!(analysis[1].url.as_deref(), Some("https://example.test/assets/app.js"));
    }
}
