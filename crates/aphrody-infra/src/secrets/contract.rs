// SPDX-License-Identifier: Apache-2.0
//! Schema contract validation for environment variables and secrets per service.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretRequirement {
    pub name: String,
    pub required: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceSecretContract {
    pub secrets: Vec<SecretRequirement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretsContractFile {
    pub schema_version: Option<u32>,
    pub services: BTreeMap<String, ServiceSecretContract>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretValidationReport {
    pub service: String,
    pub total_declared: usize,
    pub present_count: usize,
    pub missing_required: Vec<String>,
    pub empty_values: Vec<String>,
    pub status: String,
}

pub struct SecretsContract {
    pub file: SecretsContractFile,
}

impl SecretsContract {
    /// Load secrets contract specification from JSON file.
    pub fn load(path: &Path) -> Result<Self> {
        let content = fs::read_to_string(path)
            .with_context(|| format!("cannot read secrets contract file at {:?}", path))?;
        let file: SecretsContractFile = serde_json::from_str(&content)
            .with_context(|| format!("cannot parse secrets contract JSON at {:?}", path))?;
        Ok(Self { file })
    }

    /// Check a map of environment variables against the declared contract for a service.
    pub fn validate_service(
        &self,
        service: &str,
        env: &BTreeMap<String, String>,
    ) -> Result<SecretValidationReport> {
        let contract = self
            .file
            .services
            .get(service)
            .with_context(|| format!("service '{service}' not declared in secrets contract"))?;

        let mut missing_required = Vec::new();
        let mut empty_values = Vec::new();
        let mut present_count = 0;

        for req in &contract.secrets {
            match env.get(&req.name) {
                Some(val) if !val.trim().is_empty() => {
                    present_count += 1;
                }
                Some(_) => {
                    empty_values.push(req.name.clone());
                    if req.required {
                        missing_required.push(req.name.clone());
                    }
                }
                None => {
                    if req.required {
                        missing_required.push(req.name.clone());
                    }
                }
            }
        }

        let status = if !missing_required.is_empty() {
            "CRITICAL".to_string()
        } else if !empty_values.is_empty() {
            "WARNING".to_string()
        } else {
            "SECURE".to_string()
        };

        Ok(SecretValidationReport {
            service: service.to_string(),
            total_declared: contract.secrets.len(),
            present_count,
            missing_required,
            empty_values,
            status,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_contract_validation_logic() {
        let json_data = r#"{
            "services": {
                "test-api": {
                    "secrets": [
                        { "name": "DB_PASS", "required": true, "description": "Database Password" },
                        { "name": "OPTIONAL_KEY", "required": false, "description": "Optional Analytics Key" }
                    ]
                }
            }
        }"#;

        let file: SecretsContractFile = serde_json::from_str(json_data).unwrap();
        let contract = SecretsContract { file };

        let mut env = BTreeMap::new();
        env.insert("DB_PASS".to_string(), "supersecret".to_string());

        let report = contract.validate_service("test-api", &env).unwrap();
        assert_eq!(report.status, "SECURE");
        assert_eq!(report.missing_required.len(), 0);

        let empty_env = BTreeMap::new();
        let report_bad = contract.validate_service("test-api", &empty_env).unwrap();
        assert_eq!(report_bad.status, "CRITICAL");
        assert_eq!(report_bad.missing_required, vec!["DB_PASS"]);
    }
}
