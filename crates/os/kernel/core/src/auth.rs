// SPDX-License-Identifier: Apache-2.0
//! Optional authenticated kernel sessions and server-assigned tool scopes.

use std::{collections::HashSet, path::Path, sync::Arc};

use serde_json::Value;

/// The capability set assigned to a connected client after authentication.
#[derive(Clone, Debug)]
pub(crate) struct SessionScope {
    pub(crate) principal: String,
    tool_prefixes: Arc<Vec<String>>,
    pub(crate) register_subsystems: bool,
    pub(crate) publish_events: bool,
}

impl SessionScope {
    fn unrestricted() -> Self {
        Self {
            principal: "local-user".into(),
            tool_prefixes: Arc::new(vec!["*".into()]),
            register_subsystems: true,
            publish_events: true,
        }
    }

    pub(crate) fn allows_tool(&self, tool: &str) -> bool {
        self.tool_prefixes.iter().any(|prefix| prefix == "*" || tool.starts_with(prefix))
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Principal {
    scope: SessionScope,
    token: Arc<str>,
}

/// Authentication is disabled unless an operator explicitly supplies a policy file.
#[derive(Clone, Debug, Default)]
pub(crate) enum AuthPolicy {
    #[default]
    Disabled,
    Required(Arc<Vec<Principal>>),
}

impl AuthPolicy {
    /// Load the JSON policy below from an absolute local path:
    ///
    /// ```json
    /// {"principals":[{"id":"desktop","token":"secret","toolPrefixes":["get_"],
    /// "registerSubsystems":false,"publishEvents":false}]}
    /// ```
    ///
    /// Tokens are secrets and must not be committed or exposed through status APIs.
    pub(crate) fn from_file(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if !path.is_absolute() {
            return Err("authentication policy path must be absolute".into());
        }
        let source = std::fs::read_to_string(path)
            .map_err(|error| format!("failed to read authentication policy: {error}"))?;
        let value: Value = serde_json::from_str(&source)
            .map_err(|error| format!("invalid authentication policy JSON: {error}"))?;
        let principals = value
            .get("principals")
            .and_then(Value::as_array)
            .filter(|entries| !entries.is_empty())
            .ok_or("authentication policy requires a non-empty principals array")?;
        let mut ids = HashSet::new();
        let mut tokens = HashSet::new();
        let mut parsed = Vec::with_capacity(principals.len());
        for entry in principals {
            let id = entry
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| {
                    !id.is_empty()
                        && id.chars().all(|character| {
                            character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
                        })
                })
                .ok_or("principal id must contain only letters, digits, '-' or '_'")?;
            let token = entry
                .get("token")
                .and_then(Value::as_str)
                .filter(|token| !token.is_empty())
                .ok_or("principal token must not be empty")?;
            if !ids.insert(id.to_owned()) {
                return Err(format!("duplicate principal id: {id}"));
            }
            if !tokens.insert(token.to_owned()) {
                return Err("authentication policy contains duplicate tokens".into());
            }
            let tool_prefixes = entry
                .get("toolPrefixes")
                .and_then(Value::as_array)
                .ok_or("principal toolPrefixes must be an array")?
                .iter()
                .map(|prefix| {
                    prefix
                        .as_str()
                        .filter(|prefix| !prefix.is_empty())
                        .map(str::to_owned)
                        .ok_or("toolPrefixes entries must be non-empty strings")
                })
                .collect::<Result<Vec<_>, _>>()?;
            parsed.push(Principal {
                scope: SessionScope {
                    principal: id.to_owned(),
                    tool_prefixes: Arc::new(tool_prefixes),
                    register_subsystems: entry
                        .get("registerSubsystems")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    publish_events: entry
                        .get("publishEvents")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                },
                token: Arc::from(token),
            });
        }
        Ok(Self::Required(Arc::new(parsed)))
    }

    pub(crate) fn authenticate(&self, token: Option<&str>) -> Option<SessionScope> {
        match self {
            Self::Disabled => Some(SessionScope::unrestricted()),
            Self::Required(principals) => token.and_then(|token| {
                principals
                    .iter()
                    .find(|principal| principal.token.as_ref() == token)
                    .map(|principal| principal.scope.clone())
            }),
        }
    }

    pub(crate) const fn requires_authentication(&self) -> bool {
        matches!(self, Self::Required(_))
    }
}

pub(crate) fn token_from_initialize(params: &Value) -> Option<&str> {
    params
        .get("authToken")
        .or_else(|| params.pointer("/authorization/token"))
        .and_then(Value::as_str)
}
