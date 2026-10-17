// SPDX-License-Identifier: Apache-2.0
use crate::execpolicy::{ApprovalPolicy, Policy, PolicyParser};
use std::path::Path;
#[derive(Clone)]
pub(crate) struct DispatchPolicy(Policy);
impl DispatchPolicy {
    pub(crate) fn from_file(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if !path.is_absolute() {
            return Err("execution policy path must be absolute".into());
        };
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("failed to read execution policy: {e}"))?;
        PolicyParser::new()
            .parse(&content)
            .map(Self)
            .map_err(|e| e.to_string())
    }
    pub(crate) fn allows(&self, tool: &str) -> Result<(), String> {
        let result = self
            .0
            .evaluate_with_approval(&[tool.into()], ApprovalPolicy::Never);
        result.is_allowed().then_some(()).ok_or_else(|| {
            result
                .explanation
                .unwrap_or_else(|| format!("tool `{tool}` is forbidden by execution policy"))
        })
    }
}
