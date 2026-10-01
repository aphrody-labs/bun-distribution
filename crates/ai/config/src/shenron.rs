// SPDX-License-Identifier: Apache-2.0
//! Sanitized Shenron configuration contracts shared by CLI and native consumers.

/// Local file presence only: no credential parsing or claim of remote authentication.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
pub struct ShenronAuthPresence {
    pub configured: bool,
    pub admin_credentials_present: bool,
}

impl ShenronAuthPresence {
    #[must_use]
    pub fn from_home(home: &std::path::Path) -> Self {
        let admin_credentials_present = home.join("admin_credentials.json").is_file();
        Self {
            configured: admin_credentials_present || home.join("config.json").is_file(),
            admin_credentials_present,
        }
    }
}

#[cfg(test)]
mod auth_presence_tests {
    use super::ShenronAuthPresence;

    #[test]
    fn local_auth_presence_preserves_file_contract_without_reading_secrets() {
        let home = tempfile::tempdir().unwrap();
        let check = |configured, admin_credentials_present| {
            let value = serde_json::to_value(ShenronAuthPresence::from_home(home.path())).unwrap();
            assert_eq!(
                value,
                serde_json::json!({"configured": configured,
                "admin_credentials_present": admin_credentials_present})
            );
        };
        check(false, false);
        std::fs::write(home.path().join("config.json"), "not parsed private config").unwrap();
        check(true, false);
        std::fs::write(home.path().join("admin_credentials.json"), "secret fixture not valid JSON")
            .unwrap();
        check(true, true);
        std::fs::remove_file(home.path().join("config.json")).unwrap();
        check(true, true);
        std::fs::remove_file(home.path().join("admin_credentials.json")).unwrap();
        std::fs::create_dir(home.path().join("admin_credentials.json")).unwrap();
        check(false, false);
    }
}
