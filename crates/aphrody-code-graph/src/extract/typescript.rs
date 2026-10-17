// SPDX-License-Identifier: Apache-2.0
//! TypeScript and JavaScript structural extraction through the repository's Oxc parser.
//!
//! Symbols get ids from the full path stem, so two `index.ts` files never share a node. Imports
//! (`import`, `export * from`, `require("…")`) are recorded with their specifier and resolved
//! against the corpus at assembly; a call to an imported name keeps the specifier so it can only
//! reach the module it came from.

use std::collections::{HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Class, ExportAllDeclaration, Expression, Function,
    ImportDeclaration, ImportDeclarationSpecifier, MethodDefinition, ModuleExportName, PropertyKey,
    TSInterfaceDeclaration, TSMethodSignature, TSTypeAliasDeclaration, VariableDeclarator,
};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_span::SourceType;
use oxc_syntax::scope::ScopeFlags;

use super::{
    FileExtract, ImportKind, NodeClass, RawCall, RawEdge, RawImport, RawNode,
    ids::{file_stem, make_id},
};
use crate::graph::Confidence;

struct Extractor<'a> {
    rel: &'a str,
    stem: String,
    file_id: String,
    source: &'a str,
    out: FileExtract,
    seen: HashSet<String>,
    owners: Vec<String>,
    /// Local binding -> (module specifier, imported name; `*` for a namespace).
    imported: HashMap<String, (String, String)>,
}

fn require_specifier<'b>(init: Option<&'b Expression<'_>>) -> Option<&'b str> {
    let Some(Expression::CallExpression(call)) = init else {
        return None;
    };
    let Expression::Identifier(callee) = &call.callee else {
        return None;
    };
    if callee.name.as_str() != "require" {
        return None;
    }
    match call.arguments.first() {
        Some(Argument::StringLiteral(s)) => Some(s.value.as_str()),
        _ => None,
    }
}

impl Extractor<'_> {
    fn line(&self, offset: u32) -> usize {
        self.source.as_bytes()[..(offset as usize).min(self.source.len())]
            .iter()
            .filter(|b| **b == b'\n')
            .count()
            + 1
    }

    fn add_symbol(&mut self, label: String, offset: u32, class: NodeClass) -> String {
        let id = make_id(&[&self.stem, &label]);
        if self.seen.insert(id.clone()) {
            let loc = format!("L{}", self.line(offset));
            self.out.nodes.push(RawNode {
                id: id.clone(),
                label,
                file: self.rel.to_owned(),
                loc: loc.clone(),
                class,
            });
            self.out.edges.push(RawEdge {
                src: self.file_id.clone(),
                dst: id.clone(),
                relation: "contains".to_owned(),
                confidence: Confidence::Extracted,
                score: 1.0,
                file: self.rel.to_owned(),
                loc,
                context: None,
            });
        }
        id
    }

    fn add_function(&mut self, name: &str, offset: u32) -> String {
        self.add_symbol(format!("{name}()"), offset, NodeClass::Function)
    }

    fn add_type(&mut self, name: &str, offset: u32) -> String {
        self.add_symbol(name.to_owned(), offset, NodeClass::Type)
    }

    fn add_method(&mut self, owner: String, name: &str, offset: u32) -> String {
        let label = format!(".{name}()");
        let id = make_id(&[&owner, &label]);
        if self.seen.insert(id.clone()) {
            let loc = format!("L{}", self.line(offset));
            self.out.nodes.push(RawNode {
                id: id.clone(),
                label,
                file: self.rel.to_owned(),
                loc: loc.clone(),
                class: NodeClass::Function,
            });
            self.out.edges.push(RawEdge {
                src: owner,
                dst: id.clone(),
                relation: "method".to_owned(),
                confidence: Confidence::Extracted,
                score: 1.0,
                file: self.rel.to_owned(),
                loc,
                context: None,
            });
        }
        id
    }

    fn record_import(&mut self, specifier: &str, names: Vec<String>, offset: u32) {
        let loc = format!("L{}", self.line(offset));
        self.out.imports.push(RawImport {
            specifier: specifier.to_owned(),
            names,
            loc,
            kind: ImportKind::Module,
        });
    }

    fn push_call(&mut self, name: &str, method: bool, module: Option<String>, offset: u32) {
        let Some(from) = self.owners.last().cloned() else {
            return;
        };
        let loc = format!("L{}", self.line(offset));
        self.out.calls.push(RawCall {
            from,
            name: name.to_owned(),
            method,
            file: self.rel.to_owned(),
            loc,
            path: None,
            module,
        });
    }
}

impl<'a> Visit<'a> for Extractor<'a> {
    fn visit_variable_declarator(&mut self, declaration: &VariableDeclarator<'a>) {
        if let Some(specifier) = require_specifier(declaration.init.as_ref()) {
            let specifier = specifier.to_owned();
            let mut names = Vec::new();
            match &declaration.id {
                BindingPattern::BindingIdentifier(identifier) => {
                    self.imported
                        .insert(identifier.name.to_string(), (specifier.clone(), "*".into()));
                }
                BindingPattern::ObjectPattern(pattern) => {
                    for property in &pattern.properties {
                        let PropertyKey::StaticIdentifier(key) = &property.key else {
                            continue;
                        };
                        let local = match &property.value {
                            BindingPattern::BindingIdentifier(id) => id.name.to_string(),
                            BindingPattern::AssignmentPattern(p) => match &p.left {
                                BindingPattern::BindingIdentifier(id) => id.name.to_string(),
                                _ => continue,
                            },
                            _ => continue,
                        };
                        names.push(key.name.to_string());
                        self.imported
                            .insert(local, (specifier.clone(), key.name.to_string()));
                    }
                }
                _ => {}
            }
            self.record_import(&specifier, names, declaration.span.start);
            walk::walk_variable_declarator(self, declaration);
            return;
        }
        if let (
            BindingPattern::BindingIdentifier(identifier),
            Some(Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)),
        ) = (&declaration.id, &declaration.init)
        {
            let owner = self.add_function(identifier.name.as_str(), declaration.span.start);
            self.owners.push(owner);
            walk::walk_variable_declarator(self, declaration);
            self.owners.pop();
        } else {
            walk::walk_variable_declarator(self, declaration);
        }
    }

    fn visit_class(&mut self, class: &Class<'a>) {
        if let Some(name) = &class.id {
            let owner = self.add_type(name.name.as_str(), class.span.start);
            self.owners.push(owner);
            walk::walk_class(self, class);
            self.owners.pop();
        } else {
            walk::walk_class(self, class);
        }
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition<'a>) {
        let name = match &method.key {
            PropertyKey::StaticIdentifier(name) => name.name.as_str(),
            PropertyKey::PrivateIdentifier(name) => name.name.as_str(),
            _ => "computed",
        };
        if let Some(owner) = self.owners.last().cloned() {
            let id = self.add_method(owner, name, method.span.start);
            self.owners.push(id);
            walk::walk_method_definition(self, method);
            self.owners.pop();
        } else {
            walk::walk_method_definition(self, method);
        }
    }

    fn visit_ts_interface_declaration(&mut self, declaration: &TSInterfaceDeclaration<'a>) {
        let owner = self.add_type(declaration.id.name.as_str(), declaration.span.start);
        self.owners.push(owner);
        walk::walk_ts_interface_declaration(self, declaration);
        self.owners.pop();
    }

    fn visit_ts_method_signature(&mut self, method: &TSMethodSignature<'a>) {
        let name = match &method.key {
            PropertyKey::StaticIdentifier(name) => name.name.as_str(),
            PropertyKey::PrivateIdentifier(name) => name.name.as_str(),
            _ => "computed",
        };
        if let Some(owner) = self.owners.last().cloned() {
            self.add_method(owner, name, method.span.start);
        }
        walk::walk_ts_method_signature(self, method);
    }

    fn visit_ts_type_alias_declaration(&mut self, declaration: &TSTypeAliasDeclaration<'a>) {
        self.add_type(declaration.id.name.as_str(), declaration.span.start);
        walk::walk_ts_type_alias_declaration(self, declaration);
    }

    fn visit_function(&mut self, function: &Function<'a>, flags: ScopeFlags) {
        if let Some(name) = &function.id {
            let owner = self.add_function(name.name.as_str(), function.span.start);
            self.owners.push(owner);
            walk::walk_function(self, function, flags);
            self.owners.pop();
        } else {
            walk::walk_function(self, function, flags);
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        match &call.callee {
            Expression::Identifier(name) => {
                let callee = name.name.as_str();
                match self.imported.get(callee).cloned() {
                    Some((module, imported)) => {
                        let target = if imported == "*" || imported == "default" {
                            callee.to_owned()
                        } else {
                            imported
                        };
                        self.push_call(&target, false, Some(module), call.span.start);
                    }
                    None if callee != "require" => {
                        self.push_call(callee, false, None, call.span.start)
                    }
                    None => {}
                }
            }
            Expression::StaticMemberExpression(member) => match &member.object {
                // `ns.fn()` on a namespace import or a `require()` binding.
                Expression::Identifier(object) => {
                    if let Some((module, imported)) =
                        self.imported.get(object.name.as_str()).cloned()
                        && (imported == "*" || imported == "default")
                    {
                        self.push_call(
                            member.property.name.as_str(),
                            false,
                            Some(module),
                            call.span.start,
                        );
                    }
                }
                Expression::ThisExpression(_) => {
                    self.push_call(member.property.name.as_str(), true, None, call.span.start);
                }
                _ => {}
            },
            _ => {}
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_import_declaration(&mut self, import: &ImportDeclaration<'a>) {
        let specifier_text = import.source.value.to_string();
        let mut names = Vec::new();
        if let Some(specifiers) = &import.specifiers {
            for specifier in specifiers {
                let (imported, local) = match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(s) => (
                        match &s.imported {
                            ModuleExportName::IdentifierName(name) => name.name.to_string(),
                            ModuleExportName::StringLiteral(name) => name.value.to_string(),
                            ModuleExportName::IdentifierReference(name) => name.name.to_string(),
                        },
                        s.local.name.to_string(),
                    ),
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                        ("default".to_owned(), s.local.name.to_string())
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => {
                        ("*".to_owned(), s.local.name.to_string())
                    }
                };
                if imported != "*" {
                    names.push(if imported == "default" {
                        local.clone()
                    } else {
                        imported.clone()
                    });
                }
                self.imported
                    .insert(local, (specifier_text.clone(), imported));
            }
        }
        self.record_import(&specifier_text, names, import.span.start);
        walk::walk_import_declaration(self, import);
    }

    fn visit_export_all_declaration(&mut self, export: &ExportAllDeclaration<'a>) {
        self.record_import(export.source.value.as_str(), Vec::new(), export.span.start);
        walk::walk_export_all_declaration(self, export);
    }
}

fn parse_source_types(rel_path: &str) -> Vec<SourceType> {
    let Ok(base) = SourceType::from_path(rel_path) else {
        return Vec::new();
    };
    // Plain `.js` routinely holds JSX (React sources, fixtures); try JSX first, then strict JS,
    // then TSX for Flow-annotated sources (Oxc has no Flow parser; most annotations are valid TS).
    if base.is_javascript() {
        let mut types = if base.is_jsx() {
            vec![base]
        } else {
            vec![base.with_jsx(true), base]
        };
        types.push(base.with_typescript(true).with_jsx(true));
        types
    } else {
        vec![base]
    }
}

/// Extract named functions and plain calls from one JS/TS source file.
#[must_use]
pub fn extract(rel_path: &str, source: &[u8]) -> FileExtract {
    let Ok(source) = std::str::from_utf8(source) else {
        return FileExtract {
            error: Some("source is not valid UTF-8".to_owned()),
            ..FileExtract::default()
        };
    };
    let types = parse_source_types(rel_path);
    if types.is_empty() {
        return FileExtract::default();
    }
    let allocator = Allocator::default();
    let mut parsed = None;
    let mut first_error = None;
    for source_type in types {
        let attempt = Parser::new(&allocator, source, source_type).parse();
        if attempt.fatal_error {
            if first_error.is_none() {
                first_error = attempt
                    .diagnostics
                    .errors()
                    .next()
                    .map(|e| e.message.to_string());
            }
            continue;
        }
        parsed = Some(attempt);
        break;
    }
    let Some(parsed) = parsed else {
        return FileExtract {
            error: Some(format!(
                "Oxc could not parse the source file: {}",
                first_error.unwrap_or_default()
            )),
            ..FileExtract::default()
        };
    };
    let file_id = make_id(&[rel_path]);
    let file_name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    let mut extractor = Extractor {
        rel: rel_path,
        stem: file_stem(rel_path).to_owned(),
        file_id: file_id.clone(),
        source,
        out: FileExtract::default(),
        seen: HashSet::new(),
        owners: Vec::new(),
        imported: HashMap::new(),
    };
    extractor.seen.insert(file_id.clone());
    extractor.out.nodes.push(RawNode {
        id: file_id,
        label: file_name.to_owned(),
        file: rel_path.to_owned(),
        loc: "L1".to_owned(),
        class: NodeClass::File,
    });
    extractor.visit_program(&parsed.program);
    extractor.out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_named_functions_calls_and_module_imports() {
        let source = b"import { helper } from './helper';\nexport function run() { helper(); }\n";
        let file = extract("src/main.ts", source);
        assert!(file.error.is_none());
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == "main.ts" && node.id == "src_main_ts")
        );
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == "run()" && node.id == "src_main_run")
        );
        assert_eq!(file.imports.len(), 1);
        assert_eq!(
            (
                file.imports[0].specifier.as_str(),
                file.imports[0].names.as_slice()
            ),
            ("./helper", &["helper".to_owned()][..])
        );
        let call = &file.calls[0];
        assert_eq!(
            (
                call.from.as_str(),
                call.name.as_str(),
                call.module.as_deref()
            ),
            ("src_main_run", "helper", Some("./helper"))
        );
    }

    #[test]
    fn require_bindings_and_namespace_members_keep_their_module() {
        let source = b"const { validate: check } = require(\"internal/validators\");\nconst fs = require('node:fs');\nfunction f() { check(); fs.readFileSync(); }\n";
        let file = extract("src/js/node/x.ts", source);
        let calls: Vec<(&str, Option<&str>)> = file
            .calls
            .iter()
            .map(|c| (c.name.as_str(), c.module.as_deref()))
            .collect();
        assert_eq!(
            calls,
            [
                ("validate", Some("internal/validators")),
                ("readFileSync", Some("node:fs"))
            ]
        );
        assert_eq!(file.imports.len(), 2);
    }

    #[test]
    fn plain_js_with_jsx_parses() {
        let file = extract(
            "fixtures/a.js",
            b"function Component({x}) { return <div>{x}</div>; }\n",
        );
        assert!(file.error.is_none(), "{:?}", file.error);
        assert!(file.nodes.iter().any(|n| n.label == "Component()"));
        let flow = extract(
            "fixtures/flow.js",
            b"// @flow\nfunction Component(props: {x: number}): React.Node { return <div>{props.x}</div>; }\n",
        );
        assert!(flow.error.is_none(), "{:?}", flow.error);
        assert!(flow.nodes.iter().any(|n| n.label == "Component()"));
    }

    #[test]
    fn recognizes_js_and_ts_variants_but_not_unrelated_files() {
        for path in [
            "a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx", "a.mts", "a.cts",
        ] {
            assert_eq!(
                super::super::Language::of_path(path),
                Some(super::super::Language::TypeScript)
            );
        }
        assert_eq!(super::super::Language::of_path("a.py"), None);
    }

    #[test]
    fn extracts_classes_methods_interfaces_and_type_aliases() {
        let source = b"class Box { scale(value: number) { return value * 2; } }\ninterface Shape { area(): number }\ntype Id = string;\n";
        let file = extract("models.ts", source);
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == "Box" && node.class == NodeClass::Type)
        );
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == ".scale()" && node.class == NodeClass::Function)
        );
        assert!(file.edges.iter().any(|edge| edge.relation == "method"));
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == "Shape" && node.class == NodeClass::Type)
        );
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == "Id" && node.class == NodeClass::Type)
        );
    }

    #[test]
    fn extracts_named_arrow_functions_from_bindings() {
        let file = extract(
            "arrows.ts",
            b"export const twice = (value: number) => value * 2;\nconst f = function () {};\n",
        );
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == "twice()" && node.class == NodeClass::Function)
        );
        assert!(file.nodes.iter().any(|node| node.label == "f()"));
    }
}
