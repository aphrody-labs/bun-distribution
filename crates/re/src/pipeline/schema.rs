// SPDX-License-Identifier: Apache-2.0
//! JSON Schemas (draft 2020-12) for the pipeline contract, emitted to `crates/re/schema/*.json`.

use serde_json::{Value, json};

fn s() -> Value {
    json!({"type": "string"})
}
fn u() -> Value {
    json!({"type": "integer", "minimum": 0})
}
fn b() -> Value {
    json!({"type": "boolean"})
}
fn arr(items: Value) -> Value {
    json!({"type": "array", "items": items})
}
fn en(vals: &[&str]) -> Value {
    json!({"type": "string", "enum": vals})
}
fn opt(v: Value) -> Value {
    json!({"anyOf": [v, {"type": "null"}]})
}
fn obj(props: &[(&str, Value)], required: &[&str]) -> Value {
    let mut p = serde_json::Map::new();
    for (k, v) in props {
        p.insert((*k).to_string(), v.clone());
    }
    json!({"type": "object", "properties": p, "required": required, "additionalProperties": false})
}

const STAGES: &[&str] = &[
    "acquire",
    "identify",
    "unpack",
    "analyze",
    "lift",
    "decompile",
    "rebuild",
    "verify",
];
const STATUSES: &[&str] = &["ok", "partial", "unavailable", "skipped", "failed"];
const KINDS: &[&str] = &[
    "pe",
    "elf",
    "macho",
    "apk",
    "zip",
    "iso",
    "uefi",
    "bios",
    "rom",
    "fdt",
    "compressed",
    "raw",
];

fn artifact() -> Value {
    obj(
        &[("kind", s()), ("path", s()), ("bytes", u())],
        &["kind", "path", "bytes"],
    )
}

fn stage_report() -> Value {
    obj(
        &[
            ("stage", en(STAGES)),
            ("adapter", s()),
            ("status", en(STATUSES)),
            ("detail", s()),
            ("artifacts", arr(artifact())),
            (
                "metrics",
                json!({"type": "object", "additionalProperties": u()}),
            ),
            (
                "output",
                json!({"description": "Stage payload: AcquireOutput, IdentifyOutput, UnpackOutput, TriageReport, LiftOutput or VerifyOutput."}),
            ),
        ],
        &[
            "stage",
            "adapter",
            "status",
            "detail",
            "artifacts",
            "metrics",
            "output",
        ],
    )
}

fn with_meta(id: &str, title: &str, mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.insert(
            "$schema".into(),
            json!("https://json-schema.org/draft/2020-12/schema"),
        );
        o.insert(
            "$id".into(),
            json!(format!("https://aphrody.com/schema/re/{id}.json")),
        );
        o.insert("title".into(), json!(title));
    }
    v
}

fn operand() -> Value {
    json!({"oneOf": [
        obj(&[("kind", json!({"const": "reg"})), ("name", s()), ("bits", u()), ("high", b())], &["kind", "name", "bits", "high"]),
        obj(&[("kind", json!({"const": "imm"})), ("value", json!({"type": "integer"}))], &["kind", "value"]),
        obj(&[("kind", json!({"const": "mem"})), ("base", opt(s())), ("index", opt(s())), ("scale", u()), ("disp", json!({"type": "integer"})), ("bits", u())],
            &["kind", "base", "index", "scale", "disp", "bits"]),
    ]})
}

fn target() -> Value {
    json!({"oneOf": [
        obj(&[("kind", json!({"const": "direct"})), ("addr", u())], &["kind", "addr"]),
        obj(&[("kind", json!({"const": "import"})), ("index", u()), ("name", s())], &["kind", "index", "name"]),
        obj(&[("kind", json!({"const": "indirect"})), ("operand", operand())], &["kind", "operand"]),
    ]})
}

fn val() -> Value {
    json!({"oneOf": [
        obj(&[("k", json!({"const": "imm"})), ("v", u())], &["k", "v"]),
        obj(&[("k", json!({"const": "reg"})), ("r", u())], &["k", "r"]),
        obj(&[("k", json!({"const": "tmp"})), ("t", u())], &["k", "t"]),
        obj(&[("k", json!({"const": "flag"})), ("f", u())], &["k", "f"]),
    ]})
}

/// Guest-semantics statement (see `pipeline::sem`).
fn stmt() -> Value {
    let alu = [
        "add", "sub", "and", "or", "xor", "mul", "mul_hi_u", "mul_hi_s", "shl", "shr", "sar",
        "ror", "eq", "ne", "ltu", "lts", "leu", "les", "div_u", "rem_u", "div_s", "rem_s", "sext8",
        "sext16", "not",
    ];
    let body = json!({"type": "array", "items": {"$ref": "#/$defs/stmt"}});
    json!({"oneOf": [
        obj(&[("s", json!({"const": "op"})), ("t", u()), ("op", en(&alu)), ("a", val()), ("b", val())], &["s", "t", "op", "a", "b"]),
        obj(&[("s", json!({"const": "sel"})), ("t", u()), ("c", val()), ("a", val()), ("b", val())], &["s", "t", "c", "a", "b"]),
        obj(&[("s", json!({"const": "set"})), ("r", u()), ("v", val())], &["s", "r", "v"]),
        obj(&[("s", json!({"const": "set_flag"})), ("f", u()), ("v", val())], &["s", "f", "v"]),
        obj(&[("s", json!({"const": "load"})), ("t", u()), ("bits", u()), ("addr", val()), ("kind", u())], &["s", "t", "bits", "addr", "kind"]),
        obj(&[("s", json!({"const": "store"})), ("bits", u()), ("addr", val()), ("v", val()), ("kind", u())], &["s", "bits", "addr", "v", "kind"]),
        obj(&[("s", json!({"const": "call"})), ("f", s()), ("args", arr(val())), ("t", u())], &["s", "f", "args"]),
        obj(&[("s", json!({"const": "if"})), ("c", val()), ("then", body.clone()), ("els", body)], &["s", "c", "then"]),
        obj(&[("s", json!({"const": "exit"}))], &["s"]),
        obj(&[("s", json!({"const": "fallback"})), ("why", s())], &["s", "why"]),
    ]})
}

fn insn() -> Value {
    let ops = [
        "nop", "mov", "lea", "bin", "un", "cmp", "test", "push", "pop", "leave", "setcc", "cmovcc",
        "call", "jmp", "jcc", "ret", "unlifted", "guest",
    ];
    json!({
        "type": "object",
        "properties": {
            "addr": u(), "len": u(), "text": s(), "op": en(&ops),
            "dst": operand(), "src": operand(), "a": operand(), "b": operand(),
            "ext": en(&["none", "zero", "sign"]),
            "kind": {"type": "string"},
            "cond": en(&["o", "no", "b", "ae", "e", "ne", "be", "a", "s", "ns", "l", "ge", "le", "g"]),
            "target": {"anyOf": [target(), u()]},
            "pop": u(), "reason": s(),
            "raw": u(), "body": {"type": "array", "items": {"$ref": "#/$defs/stmt"}}
        },
        "required": ["addr", "len", "text", "op"]
    })
}

fn ir() -> Value {
    let mut v = obj(
        &[
            ("schema_version", u()),
            ("format", en(&["pe", "elf", "gba", "psx", "nes"])),
            (
                "arch",
                en(&["x86", "x86_64", "aarch64", "armv4t", "r3000a", "6502"]),
            ),
            (
                "abi",
                obj(
                    &[
                        ("regs", arr(s())),
                        ("link", s()),
                        ("sp", s()),
                        ("ret", s()),
                        ("machine", s()),
                        ("flags", arr(s())),
                        ("isas", arr(s())),
                    ],
                    &["regs", "link", "sp", "ret"],
                ),
            ),
            ("bits", u()),
            ("image_base", u()),
            ("entry", u()),
            ("image_end", u()),
            (
                "imports",
                arr(obj(
                    &[("name", s()), ("lib", opt(s())), ("slot", u())],
                    &["name", "lib", "slot"],
                )),
            ),
            (
                "sections",
                arr(obj(
                    &[
                        ("name", s()),
                        ("vaddr", u()),
                        ("vsize", u()),
                        ("file_offset", u()),
                        ("file_size", u()),
                        ("exec", b()),
                        ("write", b()),
                    ],
                    &[
                        "name",
                        "vaddr",
                        "vsize",
                        "file_offset",
                        "file_size",
                        "exec",
                        "write",
                    ],
                )),
            ),
            (
                "functions",
                arr(obj(
                    &[
                        ("addr", u()),
                        ("name", opt(s())),
                        ("truncated", b()),
                        ("isa", u()),
                        (
                            "blocks",
                            arr(obj(
                                &[
                                    ("addr", u()),
                                    ("fallthrough", opt(u())),
                                    ("insns", arr(insn())),
                                ],
                                &["addr", "fallthrough", "insns"],
                            )),
                        ),
                    ],
                    &["addr", "name", "blocks", "truncated"],
                )),
            ),
        ],
        &[
            "schema_version",
            "format",
            "arch",
            "bits",
            "image_base",
            "entry",
            "image_end",
            "imports",
            "sections",
            "functions",
        ],
    );
    if let Some(o) = v.as_object_mut() {
        o.insert("$defs".into(), json!({ "stmt": stmt() }));
    }
    v
}

fn adapter() -> Value {
    obj(
        &[
            ("id", s()),
            ("stage", en(STAGES)),
            (
                "kind",
                en(&["builtin", "crate", "vendor", "command", "env"]),
            ),
            ("owner", s()),
            ("handles", arr(s())),
            ("status", en(&["ready", "registered", "unavailable"])),
            ("reason", opt(s())),
        ],
        &[
            "id", "stage", "kind", "owner", "handles", "status", "reason",
        ],
    )
}

fn identify_output() -> Value {
    obj(
        &[
            ("kind", en(KINDS)),
            ("format", s()),
            ("arch", opt(s())),
            ("platform", opt(s())),
            ("entry", opt(u())),
            ("liftable", b()),
            ("container", b()),
            ("notes", arr(s())),
        ],
        &[
            "kind",
            "format",
            "arch",
            "platform",
            "entry",
            "liftable",
            "container",
            "notes",
        ],
    )
}

fn pipeline_report() -> Value {
    let mut v = obj(
        &[
            ("schema_version", u()),
            ("input", s()),
            ("target", en(&["os", "bios", "firmware"])),
            ("outdir", s()),
            ("stages", arr(stage_report())),
            ("summary", en(&["ok", "partial", "failed"])),
        ],
        &[
            "schema_version",
            "input",
            "target",
            "outdir",
            "stages",
            "summary",
        ],
    );
    if let Some(o) = v.as_object_mut() {
        o.insert(
            "$defs".into(),
            json!({"identifyOutput": identify_output(), "adapter": adapter()}),
        );
    }
    v
}

/// All schemas as `(file name, document)`.
#[must_use]
pub fn schemas() -> Vec<(&'static str, Value)> {
    vec![
        (
            "pipeline-report.json",
            with_meta(
                "pipeline-report",
                "Bun OS RE pipeline report",
                pipeline_report(),
            ),
        ),
        (
            "stage-report.json",
            with_meta(
                "stage-report",
                "Bun OS RE pipeline stage report",
                stage_report(),
            ),
        ),
        (
            "ir.json",
            with_meta("ir", "Bun OS RE lifted IR module", ir()),
        ),
        (
            "adapter.json",
            with_meta("adapter", "Bun OS RE pipeline stage adapter", adapter()),
        ),
        (
            "identify-output.json",
            with_meta(
                "identify-output",
                "Identify stage output",
                identify_output(),
            ),
        ),
    ]
}

/// Write every schema into `dir`.
///
/// # Errors
/// Propagates I/O and serialization failures.
pub fn emit_schemas(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for (name, v) in schemas() {
        let mut text = serde_json::to_string_pretty(&v).map_err(std::io::Error::other)?;
        text.push('\n');
        std::fs::write(dir.join(name), text)?;
    }
    Ok(())
}
