// SPDX-License-Identifier: Apache-2.0
use aphrody_a2a::{
    AgentCapabilities, AgentCard, AgentInterface, AgentSkill, HttpAuthSecurityScheme,
    SecurityScheme, TRANSPORT_PROTOCOL_JSONRPC, VERSION,
};
use aphrody_a2a_server::WELL_KNOWN_AGENT_CARD_PATH;

use crate::manifest::AiManifest;

/// Build an A2A 1.0 [`AgentCard`] from [`AiManifest`] + listener base URL.
#[must_use]
pub fn agent_card_from_manifest(manifest: &AiManifest, base_url: &str) -> AgentCard {
    agent_card_from_manifest_with_auth(manifest, base_url, false)
}

pub(crate) fn agent_card_from_manifest_with_auth(
    manifest: &AiManifest,
    base_url: &str,
    requires_bearer: bool,
) -> AgentCard {
    let cap = manifest.capabilities.clone().unwrap_or_default();
    let skills: Vec<AgentSkill> = manifest
        .skills
        .iter()
        .map(|s| AgentSkill {
            id: s.id.clone(),
            name: s.name.clone(),
            description: s.description.clone().unwrap_or_default(),
            tags: s.tags.clone(),
            examples: None,
            input_modes: Some(manifest.default_input_modes.clone()),
            output_modes: Some(manifest.default_output_modes.clone()),
            security_requirements: None,
        })
        .collect();

    let jsonrpc_url = base_url.to_owned();
    AgentCard {
        name: manifest
            .name
            .clone()
            .unwrap_or_else(|| "aphrody".to_owned()),
        description: manifest
            .description
            .clone()
            .unwrap_or_else(|| "Aphrody A2A agent — file JSONL + HTTP JSON-RPC".to_owned()),
        version: manifest.version.clone(),
        supported_interfaces: vec![AgentInterface::new(jsonrpc_url, TRANSPORT_PROTOCOL_JSONRPC)],
        capabilities: AgentCapabilities {
            streaming: Some(cap.streaming),
            push_notifications: Some(cap.push_notifications),
            extended_agent_card: Some(cap.extended_agent_card),
            extensions: None,
        },
        default_input_modes: if manifest.default_input_modes.is_empty() {
            vec!["text/plain".to_owned()]
        } else {
            manifest.default_input_modes.clone()
        },
        default_output_modes: if manifest.default_output_modes.is_empty() {
            vec!["text/plain".to_owned(), "application/json".to_owned()]
        } else {
            manifest.default_output_modes.clone()
        },
        skills,
        provider: manifest
            .provider
            .as_ref()
            .map(|p| aphrody_a2a::AgentProvider {
                organization: p.organization.clone(),
                url: p
                    .url
                    .clone()
                    .unwrap_or_else(|| "https://github.com/aphrody-labs/aphrody".to_owned()),
            }),
        documentation_url: manifest.documentation_url.clone(),
        icon_url: None,
        security_schemes: requires_bearer.then(|| {
            [(
                "bearer".to_owned(),
                SecurityScheme::HttpAuth(HttpAuthSecurityScheme {
                    scheme: "Bearer".to_owned(),
                    description: None,
                    bearer_format: None,
                }),
            )]
            .into_iter()
            .collect()
        }),
        security_requirements: requires_bearer
            .then(|| vec![[("bearer".to_owned(), vec![])].into_iter().collect()]),
        signatures: None,
    }
}

/// Well-known path constant re-export for docs/tests.
pub const AGENT_CARD_PATH: &str = WELL_KNOWN_AGENT_CARD_PATH;

/// Protocol version string advertised on the wire.
pub const WIRE_VERSION: &str = VERSION;

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> AiManifest {
        serde_json::from_value(serde_json::json!({
            "version": "1.0.0",
            "spec": "a2a",
            "id": "test@aphrody",
            "schema_version": "1",
            "kind": "agent",
            "name": "Test agent",
            "skills": [{ "id": "catalog", "name": "Catalog", "tags": ["site"] }]
        }))
        .unwrap()
    }

    #[test]
    fn protected_card_advertises_the_http_bearer_requirement() {
        let card = agent_card_from_manifest_with_auth(&manifest(), "http://127.0.0.1:1234", true);
        let json = serde_json::to_value(&card).unwrap();
        assert_eq!(
            json["securitySchemes"],
            serde_json::json!({ "bearer": { "httpAuthSecurityScheme": { "scheme": "Bearer" } } })
        );
        assert_eq!(
            json["securityRequirements"],
            serde_json::json!([{ "bearer": [] }])
        );
        assert_eq!(serde_json::from_value::<AgentCard>(json).unwrap(), card);
    }

    #[test]
    fn unprotected_card_preserves_the_existing_public_contract() {
        let manifest = manifest();
        let card = agent_card_from_manifest_with_auth(&manifest, "http://127.0.0.1:1234", false);
        assert_eq!(
            card,
            agent_card_from_manifest(&manifest, "http://127.0.0.1:1234")
        );
        let json = serde_json::to_value(card).unwrap();
        assert!(json.get("securitySchemes").is_none());
        assert!(json.get("securityRequirements").is_none());
        assert_eq!(json["skills"][0]["id"], "catalog");
        assert_eq!(
            json["supportedInterfaces"][0]["url"],
            "http://127.0.0.1:1234"
        );
    }
}
