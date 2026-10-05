// SPDX-License-Identifier: MIT
//! Module metadata and ESTree use Oxc's parser, module record and official serializers.

use oxc_allocator::Allocator;
use oxc_ast_visit::utf8_to_utf16::Utf8ToUtf16;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_syntax::module_record::ExportExportName;

pub(crate) struct AnalysisError {
    pub kind: &'static str,
    pub message: String,
}

impl AnalysisError {
    pub fn input(message: String) -> Self {
        Self { kind: "input", message }
    }
}

pub(crate) fn analyze(
    source: &str,
    filename: &str,
    include_program: bool,
) -> Result<serde_json::Value, AnalysisError> {
    let source_type =
        SourceType::from_path(filename).map_err(|error| AnalysisError::input(error.to_string()))?;
    let allocator = Allocator::default();
    let mut parsed = Parser::new(&allocator, source, source_type).parse();
    let mut diagnostics = parsed.diagnostics;
    if diagnostics.is_empty() {
        diagnostics.extend(
            SemanticBuilder::new_compiler()
                .with_check_syntax_error(true)
                .build(&parsed.program)
                .diagnostics,
        );
    }
    if !diagnostics.is_empty() {
        return Err(AnalysisError {
            kind: "syntax",
            message: diagnostics.iter().map(ToString::to_string).collect::<Vec<_>>().join("; "),
        });
    }

    let converter = Utf8ToUtf16::new(source);
    converter.convert_module_record(&mut parsed.module_record);
    if include_program {
        converter.convert_program_and_comments(&mut parsed.program);
        return serde_json::from_str(
            &parsed.program.to_estree_json(source_type.is_typescript(), false),
        )
        .map_err(|error| AnalysisError::input(error.to_string()));
    }

    // requested_modules records physical declarations, unlike indirect exports
    // which can reuse a previous import's source span after binding resolution.
    let mut requests = parsed
        .module_record
        .requested_modules
        .iter()
        .flat_map(|(name, occurrences)| {
            occurrences.iter().map(move |request| {
                (
                    request.span.start,
                    serde_json::json!({
                        "specifier": name.to_string(),
                        "start": request.span.start,
                        "end": request.span.end,
                        "typeOnly": request.is_type,
                        "isImport": request.is_import,
                    }),
                )
            })
        })
        .collect::<Vec<_>>();
    requests.sort_by_key(|(start, _)| *start);

    let record = &parsed.module_record;
    let mut entries = record
        .local_export_entries
        .iter()
        .chain(record.indirect_export_entries.iter())
        .chain(record.star_export_entries.iter())
        .filter_map(|entry| {
            let (name, span) = match &entry.export_name {
                ExportExportName::Name(name) => (name.name.to_string(), name.span),
                ExportExportName::Default(span) => ("default".to_owned(), *span),
                ExportExportName::Null if entry.import_name.is_all_but_default() => {
                    ("*".to_owned(), entry.span)
                },
                ExportExportName::Null => return None,
            };
            Some((
                span.start,
                serde_json::json!({
                    "name": name,
                    "start": span.start,
                    "end": span.end,
                    "typeOnly": entry.is_type,
                }),
            ))
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|(start, _)| *start);
    let mut exports = Vec::new();
    for (_, entry) in &entries {
        if !exports.contains(&entry["name"]) {
            exports.push(entry["name"].clone());
        }
    }
    Ok(serde_json::json!({
        "imports": requests.iter().map(|(_, request)| &request["specifier"]).collect::<Vec<_>>(),
        "exports": exports,
        "hasModuleSyntax": record.has_module_syntax,
        "spanEncoding": "utf16",
        "requests": requests.into_iter().map(|(_, request)| request).collect::<Vec<_>>(),
        "exportEntries": entries.into_iter().map(|(_, entry)| entry).collect::<Vec<_>>(),
    }))
}
