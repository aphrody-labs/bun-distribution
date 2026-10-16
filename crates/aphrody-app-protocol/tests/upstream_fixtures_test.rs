// SPDX-License-Identifier: Apache-2.0
use std::path::Path;

#[test]
fn test_fixtures_rev_matches_checkout() {
    let rev_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/upstream/FIXTURES_REV");
    let rev = std::fs::read_to_string(rev_path).expect("read FIXTURES_REV");
    assert_eq!(
        rev.trim(),
        "78245b47af2a7aafcabe025828ceecca69db4df1",
        "Unexpected FIXTURES_REV"
    );
}

#[test]
fn test_upstream_json_schemas_parse_valid() {
    let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/upstream");
    let entries = std::fs::read_dir(fixture_dir).expect("read fixture dir");

    let mut schema_count = 0;
    for entry in entries {
        let entry = entry.unwrap();
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let content = std::fs::read_to_string(&path).unwrap();
            let val: serde_json::Value = serde_json::from_str(&content).unwrap_or_else(|e| {
                panic!("Failed to parse JSON in {}: {e}", path.display());
            });
            assert!(
                val.is_object(),
                "Schema in {} must be an object",
                path.display()
            );
            schema_count += 1;
        }
    }
    assert!(
        schema_count >= 13,
        "Expected at least 13 upstream schemas, found {schema_count}"
    );
}
