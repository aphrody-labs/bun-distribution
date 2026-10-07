// SPDX-License-Identifier: Apache-2.0
//! TypeScript and JavaScript structural extraction through the repository's Oxc parser.

use std::collections::{HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    BindingPattern, CallExpression, Class, Expression, Function, ImportDeclaration,
    ImportDeclarationSpecifier, MethodDefinition, ModuleExportName, PropertyKey,
    TSInterfaceDeclaration, TSMethodSignature, TSTypeAliasDeclaration, VariableDeclarator,
};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_span::SourceType;
use oxc_syntax::scope::ScopeFlags;

use super::{
    FileExtract, NodeClass, RawCall, RawEdge, RawNode,
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
    imported: HashMap<String, String>,
}

impl Extractor<'_> {
    fn line(&self, offset: u32) -> usize {
        self.source.as_bytes()[..(offset as usize).min(self.source.len())]
            .iter()
            .filter(|b| **b == b'\n')
            .count()
            + 1
    }

    fn add_function(&mut self, name: &str, offset: u32) -> String {
        let label = format!("{name}()");
        let id = make_id(&[&self.stem, &label]);
        if self.seen.insert(id.clone()) {
            self.out.nodes.push(RawNode {
                id: id.clone(),
                label,
                file: self.rel.to_owned(),
                loc: format!("L{}", self.line(offset)),
                class: NodeClass::Function,
            });
            self.out.edges.push(RawEdge {
                src: self.file_id.clone(),
                dst: id.clone(),
                relation: "contains".to_owned(),
                confidence: Confidence::Extracted,
                score: 1.0,
                file: self.rel.to_owned(),
                loc: format!("L{}", self.line(offset)),
                context: None,
            });
        }
        id
    }

    fn module_stem(&self, module: &str) -> String {
        let path =
            module.rsplit('/').find(|part| !part.is_empty() && *part != ".").unwrap_or(module);
        file_stem(path).trim_start_matches('.').to_owned()
    }

    fn add_type(&mut self, name: &str, offset: u32) -> String {
        let id = make_id(&[&self.stem, name]);
        if self.seen.insert(id.clone()) {
            self.out.nodes.push(RawNode {
                id: id.clone(),
                label: name.to_owned(),
                file: self.rel.to_owned(),
                loc: format!("L{}", self.line(offset)),
                class: NodeClass::Type,
            });
            self.out.edges.push(RawEdge {
                src: self.file_id.clone(),
                dst: id.clone(),
                relation: "contains".to_owned(),
                confidence: Confidence::Extracted,
                score: 1.0,
                file: self.rel.to_owned(),
                loc: format!("L{}", self.line(offset)),
                context: None,
            });
        }
        id
    }
}

impl<'a> Visit<'a> for Extractor<'a> {
    fn visit_variable_declarator(&mut self, declaration: &VariableDeclarator<'a>) {
        if let (
            BindingPattern::BindingIdentifier(identifier),
            Some(Expression::ArrowFunctionExpression(_)),
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
            let label = format!(".{name}()");
            let id = make_id(&[&owner, &label]);
            if self.seen.insert(id.clone()) {
                self.out.nodes.push(RawNode {
                    id: id.clone(),
                    label,
                    file: self.rel.to_owned(),
                    loc: format!("L{}", self.line(method.span.start)),
                    class: NodeClass::Function,
                });
                self.out.edges.push(RawEdge {
                    src: owner,
                    dst: id.clone(),
                    relation: "method".to_owned(),
                    confidence: Confidence::Extracted,
                    score: 1.0,
                    file: self.rel.to_owned(),
                    loc: format!("L{}", self.line(method.span.start)),
                    context: None,
                });
            }
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
            let label = format!(".{name}()");
            let id = make_id(&[&owner, &label]);
            if self.seen.insert(id.clone()) {
                self.out.nodes.push(RawNode {
                    id: id.clone(),
                    label,
                    file: self.rel.to_owned(),
                    loc: format!("L{}", self.line(method.span.start)),
                    class: NodeClass::Function,
                });
                self.out.edges.push(RawEdge {
                    src: owner,
                    dst: id,
                    relation: "method".to_owned(),
                    confidence: Confidence::Extracted,
                    score: 1.0,
                    file: self.rel.to_owned(),
                    loc: format!("L{}", self.line(method.span.start)),
                    context: None,
                });
            }
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
        if let (Some(from), Expression::Identifier(name)) = (self.owners.last(), &call.callee) {
            let callee = name.name.as_str();
            let loc = format!("L{}", self.line(call.span.start));
            if let Some(target) = self.imported.get(callee) {
                self.out.edges.push(RawEdge {
                    src: from.clone(),
                    dst: target.clone(),
                    relation: "calls".to_owned(),
                    confidence: Confidence::Extracted,
                    score: 1.0,
                    file: self.rel.to_owned(),
                    loc,
                    context: Some("call".to_owned()),
                });
            } else {
                self.out.calls.push(RawCall {
                    from: from.clone(),
                    name: callee.to_owned(),
                    method: false,
                    file: self.rel.to_owned(),
                    loc,
                });
            }
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_import_declaration(&mut self, import: &ImportDeclaration<'a>) {
        let stem = self.module_stem(import.source.value.as_str());
        let line = format!("L{}", self.line(import.span.start));
        self.out.edges.push(RawEdge {
            src: self.file_id.clone(),
            dst: make_id(&[&stem]),
            relation: "imports_from".to_owned(),
            confidence: Confidence::Extracted,
            score: 1.0,
            file: self.rel.to_owned(),
            loc: line.clone(),
            context: Some("import".to_owned()),
        });
        if let Some(specifiers) = &import.specifiers {
            for specifier in specifiers {
                let imported = match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        match &specifier.imported {
                            ModuleExportName::IdentifierName(name) => name.name.as_str(),
                            ModuleExportName::StringLiteral(name) => name.value.as_str(),
                            ModuleExportName::IdentifierReference(name) => name.name.as_str(),
                        }
                    },
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(_) => "default",
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => "*",
                };
                let local = match specifier {
                    ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                        specifier.local.name.as_str()
                    },
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                        specifier.local.name.as_str()
                    },
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                        specifier.local.name.as_str()
                    },
                };
                if imported != "*" {
                    self.imported
                        .insert(local.to_owned(), make_id(&[&stem, &format!("{imported}()")]));
                }
                self.out.edges.push(RawEdge {
                    src: self.file_id.clone(),
                    dst: make_id(&[&stem, imported]),
                    relation: "imports".to_owned(),
                    confidence: Confidence::Extracted,
                    score: 1.0,
                    file: self.rel.to_owned(),
                    loc: line.clone(),
                    context: Some("import".to_owned()),
                });
            }
        }
        walk::walk_import_declaration(self, import);
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
    let Ok(source_type) = SourceType::from_path(rel_path) else { return FileExtract::default() };
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.fatal_error {
        return FileExtract {
            error: Some("Oxc could not parse the source file".to_owned()),
            ..FileExtract::default()
        };
    }
    let file_id = make_id(&[file_stem(rel_path)]);
    let file_name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    let mut extractor = Extractor {
        rel: rel_path,
        stem: file_stem(file_name).to_owned(),
        file_id: file_id.clone(),
        source,
        out: FileExtract::default(),
        seen: HashSet::new(),
        owners: Vec::new(),
        imported: HashMap::new(),
    };
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
        assert!(file.nodes.iter().any(|node| node.label == "main.ts"));
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == "run()" && node.class == NodeClass::Function)
        );
        assert!(
            file.edges.iter().any(|edge| edge.relation == "imports_from" && edge.dst == "helper")
        );
        assert!(
            file.edges.iter().any(|edge| edge.relation == "imports" && edge.dst == "helper_helper")
        );
        assert!(file.edges.iter().any(|edge| edge.relation == "calls"
            && edge.src == "main_run"
            && edge.dst == "helper_helper"));
    }

    #[test]
    fn recognizes_js_and_ts_variants_but_not_unrelated_files() {
        for path in ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.tsx", "a.mts", "a.cts"] {
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
        assert!(file.nodes.iter().any(|node| node.label == "Box" && node.class == NodeClass::Type));
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == ".scale()" && node.class == NodeClass::Function)
        );
        assert!(file.edges.iter().any(|edge| edge.relation == "method"));
        assert!(
            file.nodes.iter().any(|node| node.label == "Shape" && node.class == NodeClass::Type)
        );
        assert!(file.nodes.iter().any(|node| node.label == "Id" && node.class == NodeClass::Type));
    }

    #[test]
    fn extracts_named_arrow_functions_from_bindings() {
        let file = extract("arrows.ts", b"export const twice = (value: number) => value * 2;\n");
        assert!(
            file.nodes
                .iter()
                .any(|node| node.label == "twice()" && node.class == NodeClass::Function)
        );
    }
}
