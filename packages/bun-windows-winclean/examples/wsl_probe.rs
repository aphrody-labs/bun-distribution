// SPDX-License-Identifier: Apache-2.0
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let distribution = std::env::args()
        .nth(1)
        .ok_or("pass an installed distribution name")?;
    let runtime = bun_windows_winclean::shared()?;
    for (tool, args) in [
        ("wsl_get_status", serde_json::json!({})),
        ("wsl_list_distributions", serde_json::json!({})),
        (
            "wsl_read_only_probe",
            serde_json::json!({"distribution": distribution, "probe": "system-info"}),
        ),
    ] {
        let result = runtime.call(tool, &args)?.json::<serde_json::Value>()?;
        println!("{tool}: {}", serde_json::to_string_pretty(&result)?);
        if result["Success"] != true {
            return Err(format!("{tool} failed").into());
        }
    }
    Ok(())
}
