// SPDX-License-Identifier: Apache-2.0
//! OVH IAM (API v2): keeps the service account's policy `aphrody-automation` covering every
//! resource of the account through the resource groups `aphrody-all`, `aphrody-all-2`, ...
//!
//! Limits handled by the planner (verified live on the account): at most 10 resources per group
//! (so a new group opens when one is full) and the `account` resource cannot join a group, so the
//! policy lists it directly next to the group URNs.

use std::collections::BTreeSet;

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};

use crate::client::{AuthMode, OvhClient};

pub const POLICY_NAME: &str = "aphrody-automation";
pub const GROUP_NAME: &str = "aphrody-all";
pub const POLICY_DESCRIPTION: &str =
    "Aphrody CLI service account: full autonomous management of the OVH account (aphrody ovh)";
/// Maximum resources of one resource group.
pub const GROUP_CAPACITY: usize = 10;
/// Maximum resources referenced by one policy (the account plus the group URNs).
pub const MAX_POLICY_RESOURCES: usize = 10;
const ACCOUNT_KIND: &str = "account";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IamResource {
    pub id: String,
    pub urn: String,
    pub kind: String,
    pub name: String,
}

impl IamResource {
    pub fn from_json(raw: &Value) -> Option<Self> {
        let text = |key: &str| {
            raw.get(key)
                .and_then(Value::as_str)
                .map(ToString::to_string)
        };
        Some(Self {
            id: text("id")?,
            urn: text("urn")?,
            kind: text("type").unwrap_or_default(),
            name: text("name").unwrap_or_default(),
        })
    }

    pub fn is_account(&self) -> bool {
        self.kind == ACCOUNT_KIND
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IamGroup {
    pub id: String,
    pub name: String,
    pub urn: String,
    /// Member resource ids, in the order OVH reports them.
    pub resource_ids: Vec<String>,
}

impl IamGroup {
    pub fn from_json(raw: &Value) -> Option<Self> {
        let text = |key: &str| {
            raw.get(key)
                .and_then(Value::as_str)
                .map(ToString::to_string)
        };
        Some(Self {
            id: text("id")?,
            name: text("name")?,
            urn: text("urn").unwrap_or_default(),
            resource_ids: raw
                .get("resources")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|r| r.get("id").and_then(Value::as_str))
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_default(),
        })
    }

    /// Groups this module owns: `aphrody-all` and `aphrody-all-N`.
    pub fn is_managed(&self) -> bool {
        self.name == GROUP_NAME
            || self
                .name
                .strip_prefix("aphrody-all-")
                .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IamPolicy {
    pub id: String,
    pub name: String,
    pub identities: Vec<String>,
    pub resource_urns: Vec<String>,
    /// `allow: [{action: "*"}]` with no deny or except rule.
    pub allow_all: bool,
}

impl IamPolicy {
    pub fn from_json(raw: &Value) -> Option<Self> {
        let strings = |pointer: &str, key: Option<&str>| -> Vec<String> {
            raw.pointer(pointer)
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|item| match key {
                            Some(k) => item.get(k).and_then(Value::as_str),
                            None => item.as_str(),
                        })
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_default()
        };
        let allow_actions = strings("/permissions/allow", Some("action"));
        let has_rules = |key: &str| {
            raw.pointer(&format!("/permissions/{key}"))
                .and_then(Value::as_array)
                .is_some_and(|rules| !rules.is_empty())
        };
        Some(Self {
            id: raw.get("id").and_then(Value::as_str)?.to_string(),
            name: raw.get("name").and_then(Value::as_str)?.to_string(),
            identities: strings("/identities", None),
            resource_urns: strings("/resources", Some("urn")),
            allow_all: allow_actions == ["*"] && !has_rules("deny") && !has_rules("except"),
        })
    }
}

/// Name of the n-th managed group: `aphrody-all`, `aphrody-all-2`, `aphrody-all-3`, ...
pub fn group_name(index: usize) -> String {
    if index == 0 {
        GROUP_NAME.to_string()
    } else {
        format!("{GROUP_NAME}-{}", index + 1)
    }
}

/// Desired content of one managed group.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupPlan {
    pub name: String,
    pub existing: Option<IamGroup>,
    pub resource_ids: Vec<String>,
}

impl GroupPlan {
    pub fn needs_write(&self) -> bool {
        match &self.existing {
            None => true,
            Some(group) => {
                let current: BTreeSet<&String> = group.resource_ids.iter().collect();
                let wanted: BTreeSet<&String> = self.resource_ids.iter().collect();
                current != wanted
            }
        }
    }
}

/// Spread every non-account resource over the managed groups.
///
/// Existing memberships that are still valid stay where they are (no churn); resources that
/// disappeared are dropped; new ones fill the free slots in group order, then open new groups.
/// Groups that end up empty are not planned (they keep existing untouched).
pub fn plan_groups(resources: &[IamResource], groups: &[IamGroup]) -> Vec<GroupPlan> {
    let wanted: BTreeSet<&str> = resources
        .iter()
        .filter(|r| !r.is_account())
        .map(|r| r.id.as_str())
        .collect();

    let mut managed: Vec<&IamGroup> = groups.iter().filter(|g| g.is_managed()).collect();
    managed.sort_by(|a, b| {
        a.name
            .len()
            .cmp(&b.name.len())
            .then_with(|| a.name.cmp(&b.name))
    });

    let mut assigned: BTreeSet<&str> = BTreeSet::new();
    let mut plans: Vec<GroupPlan> = managed
        .iter()
        .map(|group| {
            let mut kept = Vec::new();
            for id in &group.resource_ids {
                if wanted.contains(id.as_str()) && assigned.insert(id.as_str()) {
                    kept.push(id.clone());
                }
            }
            GroupPlan {
                name: group.name.clone(),
                existing: Some((*group).clone()),
                resource_ids: kept,
            }
        })
        .collect();

    let mut pending: Vec<&IamResource> = resources
        .iter()
        .filter(|r| !r.is_account() && !assigned.contains(r.id.as_str()))
        .collect();
    pending.sort_by(|a, b| a.urn.cmp(&b.urn));

    for resource in pending {
        if let Some(plan) = plans
            .iter_mut()
            .find(|p| p.resource_ids.len() < GROUP_CAPACITY)
        {
            plan.resource_ids.push(resource.id.clone());
            continue;
        }
        let name = (0..)
            .map(group_name)
            .find(|candidate| {
                !groups.iter().any(|g| &g.name == candidate)
                    && !plans.iter().any(|p| &p.name == candidate)
            })
            .unwrap_or_else(|| group_name(plans.len()));
        plans.push(GroupPlan {
            name,
            existing: None,
            resource_ids: vec![resource.id.clone()],
        });
    }

    plans.retain(|p| !p.resource_ids.is_empty());
    plans
}

/// Desired policy: the account plus every managed group, for the given identities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyPlan {
    pub existing: Option<IamPolicy>,
    pub identities: Vec<String>,
    pub resource_urns: Vec<String>,
    pub needs_write: bool,
}

pub fn plan_policy(
    existing: Option<&IamPolicy>,
    account_urn: &str,
    group_urns: &[String],
    current_identities: &[String],
) -> Result<PolicyPlan> {
    let mut resource_urns = vec![account_urn.to_string()];
    resource_urns.extend(group_urns.iter().cloned());
    if resource_urns.len() > MAX_POLICY_RESOURCES {
        bail!(
            "policy would reference {} resources (account + {} groups), limit is {MAX_POLICY_RESOURCES}",
            resource_urns.len(),
            group_urns.len()
        );
    }

    let mut identities: Vec<String> = existing.map(|p| p.identities.clone()).unwrap_or_default();
    for identity in current_identities {
        if !identities.contains(identity) {
            identities.push(identity.clone());
        }
    }
    if identities.is_empty() {
        bail!(
            "no identity to attach to the policy: authenticate with the service account (OAuth2)"
        );
    }

    let needs_write = match existing {
        None => true,
        Some(policy) => {
            let current: BTreeSet<&String> = policy.resource_urns.iter().collect();
            let wanted: BTreeSet<&String> = resource_urns.iter().collect();
            current != wanted || identities.len() != policy.identities.len() || !policy.allow_all
        }
    };
    Ok(PolicyPlan {
        existing: existing.cloned(),
        identities,
        resource_urns,
        needs_write,
    })
}

/// Request body of the policy (`POST /iam/policy`, `PUT /iam/policy/{id}`). Optional fields of an
/// existing policy (permission groups, conditions, expiry) are carried over.
pub fn policy_body(plan: &PolicyPlan, existing_raw: Option<&Value>) -> Value {
    let mut body = json!({
        "name": POLICY_NAME,
        "description": POLICY_DESCRIPTION,
        "identities": plan.identities,
        "permissions": { "allow": [{ "action": "*" }] },
        "resources": plan.resource_urns.iter().map(|urn| json!({ "urn": urn })).collect::<Vec<_>>(),
    });
    if let (Some(raw), Some(map)) = (existing_raw, body.as_object_mut()) {
        for key in ["permissionsGroups", "conditions", "expiredAt"] {
            match raw.get(key) {
                Some(Value::Null) | None => {}
                Some(Value::Array(items)) if items.is_empty() => {}
                Some(value) => {
                    map.insert(key.to_string(), value.clone());
                }
            }
        }
    }
    body
}

/// Request body of a resource group.
pub fn group_body(name: &str, resources: &[IamResource]) -> Value {
    json!({
        "name": name,
        "resources": resources.iter().map(|r| json!({ "id": r.id, "urn": r.urn })).collect::<Vec<_>>(),
    })
}

/// Outcome of [`IamManager::sync`].
#[derive(Debug, Clone)]
pub struct SyncReport {
    pub groups: Vec<GroupPlan>,
    pub policy: PolicyPlan,
    pub resource_count: usize,
    pub applied: bool,
}

pub struct IamManager<'a> {
    client: &'a OvhClient,
}

impl<'a> IamManager<'a> {
    pub fn new(client: &'a OvhClient) -> Self {
        Self { client }
    }

    pub async fn list_resources(&self) -> Result<Vec<IamResource>> {
        let raw: Vec<Value> = self.client.get_v2("/iam/resource").await?;
        Ok(raw.iter().filter_map(IamResource::from_json).collect())
    }

    pub async fn list_groups(&self) -> Result<Vec<IamGroup>> {
        let raw: Vec<Value> = self
            .client
            .get_v2("/iam/resourceGroup?details=true")
            .await?;
        Ok(raw.iter().filter_map(IamGroup::from_json).collect())
    }

    /// The managed policy and its raw JSON, when it exists.
    pub async fn find_policy(&self) -> Result<Option<(IamPolicy, Value)>> {
        let list: Vec<Value> = self.client.get_v2("/iam/policy").await?;
        let id = list
            .iter()
            .find(|p| p.get("name").and_then(Value::as_str) == Some(POLICY_NAME))
            .and_then(|p| p.get("id").and_then(Value::as_str));
        let Some(id) = id else { return Ok(None) };
        let raw: Value = self.client.get_v2(&format!("/iam/policy/{id}")).await?;
        let policy = IamPolicy::from_json(&raw)
            .ok_or_else(|| anyhow!("unreadable IAM policy {POLICY_NAME}"))?;
        Ok(Some((policy, raw)))
    }

    /// Identities of the credential in use (`GET /auth/details`).
    pub async fn current_identities(&self) -> Result<Vec<String>> {
        if self.client.auth_mode() != AuthMode::OAuth2 {
            return Ok(Vec::new());
        }
        let details: Value = self.client.get("/auth/details").await?;
        Ok(details
            .get("identities")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Plan, and with `apply` write, the groups then the policy. Read-only without `apply`.
    pub async fn sync(&self, apply: bool) -> Result<SyncReport> {
        let resources = self.list_resources().await?;
        let account = resources
            .iter()
            .find(|r| r.is_account())
            .ok_or_else(|| anyhow!("the account resource is not listed by IAM"))?;
        let groups = self.list_groups().await?;
        let existing = self.find_policy().await?;
        let identities = self.current_identities().await?;

        let plans = plan_groups(&resources, &groups);
        let mut group_urns = Vec::with_capacity(plans.len());
        for plan in &plans {
            let members: Vec<IamResource> = plan
                .resource_ids
                .iter()
                .filter_map(|id| resources.iter().find(|r| &r.id == id).cloned())
                .collect();
            let body = group_body(&plan.name, &members);
            match &plan.existing {
                Some(group) => {
                    if apply && plan.needs_write() {
                        let _: Value = self
                            .client
                            .put_v2(&format!("/iam/resourceGroup/{}", group.id), Some(body))
                            .await?;
                    }
                    group_urns.push(group.urn.clone());
                }
                None if apply => {
                    let created: Value = self
                        .client
                        .post_v2("/iam/resourceGroup", Some(body))
                        .await?;
                    let urn = created
                        .get("urn")
                        .and_then(Value::as_str)
                        .ok_or_else(|| anyhow!("group {} created without urn", plan.name))?;
                    group_urns.push(urn.to_string());
                }
                None => group_urns.push(format!("<new group {}>", plan.name)),
            }
        }

        let policy = plan_policy(
            existing.as_ref().map(|(p, _)| p),
            &account.urn,
            &group_urns,
            &identities,
        )?;
        if apply && policy.needs_write {
            let body = policy_body(&policy, existing.as_ref().map(|(_, raw)| raw));
            let _: Value = match &policy.existing {
                Some(p) => {
                    self.client
                        .put_v2(&format!("/iam/policy/{}", p.id), Some(body))
                        .await?
                }
                None => self.client.post_v2("/iam/policy", Some(body)).await?,
            };
        }
        Ok(SyncReport {
            groups: plans,
            policy,
            resource_count: resources.len(),
            applied: apply,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resource(n: usize, kind: &str) -> IamResource {
        IamResource {
            id: format!("id-{n:02}"),
            urn: format!("urn:v1:eu:resource:{kind}:r{n:02}"),
            kind: kind.into(),
            name: format!("r{n:02}"),
        }
    }

    fn account() -> IamResource {
        IamResource {
            id: "00000000-0000-0000-0000-000000000000".into(),
            urn: "urn:v1:eu:resource:account:eu0000-ovh".into(),
            kind: "account".into(),
            name: "eu0000-ovh".into(),
        }
    }

    fn group(name: &str, ids: &[&str]) -> IamGroup {
        IamGroup {
            id: format!("gid-{name}"),
            name: name.into(),
            urn: format!("urn:v1:eu:resourceGroup:gid-{name}"),
            resource_ids: ids.iter().map(ToString::to_string).collect(),
        }
    }

    #[test]
    fn group_names_are_sequential() {
        assert_eq!(group_name(0), "aphrody-all");
        assert_eq!(group_name(1), "aphrody-all-2");
        assert_eq!(group_name(2), "aphrody-all-3");
        assert!(group("aphrody-all-2", &[]).is_managed());
        assert!(group("aphrody-all", &[]).is_managed());
        assert!(!group("aphrody-all-x", &[]).is_managed());
        assert!(!group("other", &[]).is_managed());
    }

    #[test]
    fn account_never_enters_a_group_and_ten_fill_one_group() {
        let mut resources = vec![account()];
        resources.extend((1..=10).map(|n| resource(n, "domain")));
        let plans = plan_groups(&resources, &[]);
        assert_eq!(plans.len(), 1);
        assert_eq!(plans[0].name, "aphrody-all");
        assert_eq!(plans[0].resource_ids.len(), 10);
        assert!(
            !plans[0]
                .resource_ids
                .iter()
                .any(|id| id.starts_with("0000"))
        );
        assert!(plans[0].needs_write());
    }

    #[test]
    fn the_eleventh_resource_opens_a_second_group() {
        let mut resources = vec![account()];
        resources.extend((1..=11).map(|n| resource(n, "domain")));
        let ids: Vec<String> = (1..=10).map(|n| format!("id-{n:02}")).collect();
        let id_refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        let groups = vec![group("aphrody-all", &id_refs)];
        let plans = plan_groups(&resources, &groups);
        assert_eq!(plans.len(), 2);
        assert!(!plans[0].needs_write(), "first group is unchanged");
        assert_eq!(plans[1].name, "aphrody-all-2");
        assert_eq!(plans[1].resource_ids, vec!["id-11".to_string()]);
        assert!(plans[1].existing.is_none() && plans[1].needs_write());
    }

    #[test]
    fn removed_resources_leave_and_new_ones_fill_free_slots() {
        let resources = vec![account(), resource(1, "vps"), resource(3, "vps")];
        let groups = vec![group("aphrody-all", &["id-01", "id-02"])];
        let plans = plan_groups(&resources, &groups);
        assert_eq!(plans.len(), 1);
        assert_eq!(
            plans[0].resource_ids,
            vec!["id-01".to_string(), "id-03".to_string()]
        );
        assert!(plans[0].needs_write());
        // Only the account left: nothing to group.
        assert!(plan_groups(&[account()], &groups).is_empty());
    }

    #[test]
    fn an_up_to_date_group_needs_no_write() {
        let resources = vec![account(), resource(1, "vps"), resource(2, "vps")];
        let groups = vec![group("aphrody-all", &["id-02", "id-01"])];
        let plans = plan_groups(&resources, &groups);
        assert!(!plans[0].needs_write());
    }

    fn policy(resources: &[&str], identities: &[&str], allow_all: bool) -> IamPolicy {
        IamPolicy {
            id: "pid".into(),
            name: POLICY_NAME.into(),
            identities: identities.iter().map(ToString::to_string).collect(),
            resource_urns: resources.iter().map(ToString::to_string).collect(),
            allow_all,
        }
    }

    #[test]
    fn policy_creation_lists_the_account_then_the_groups() {
        let identity = "urn:v1:eu:identity:credential:eu0000-ovh/oauth2-fixture".to_string();
        let plan = plan_policy(
            None,
            "urn:acc",
            &["urn:g1".to_string(), "urn:g2".to_string()],
            std::slice::from_ref(&identity),
        )
        .unwrap();
        assert!(plan.needs_write);
        assert_eq!(plan.resource_urns, vec!["urn:acc", "urn:g1", "urn:g2"]);
        let body = policy_body(&plan, None);
        assert_eq!(body["name"], POLICY_NAME);
        assert_eq!(body["permissions"]["allow"][0]["action"], "*");
        assert_eq!(body["resources"][1]["urn"], "urn:g1");
        assert_eq!(body["identities"][0], identity.as_str());
    }

    #[test]
    fn policy_in_sync_is_left_alone_and_identities_are_unioned() {
        let existing = policy(&["urn:acc", "urn:g1"], &["id-a"], true);
        let in_sync = plan_policy(
            Some(&existing),
            "urn:acc",
            &["urn:g1".to_string()],
            &["id-a".to_string()],
        )
        .unwrap();
        assert!(!in_sync.needs_write);

        let widened = plan_policy(
            Some(&existing),
            "urn:acc",
            &["urn:g1".to_string(), "urn:g2".to_string()],
            &["id-a".to_string(), "id-b".to_string()],
        )
        .unwrap();
        assert!(widened.needs_write);
        assert_eq!(widened.identities, vec!["id-a", "id-b"]);

        let narrowed = policy(&["urn:acc", "urn:g1"], &["id-a"], false);
        assert!(
            plan_policy(Some(&narrowed), "urn:acc", &["urn:g1".to_string()], &[])
                .unwrap()
                .needs_write
        );
    }

    #[test]
    fn policy_limits_and_missing_identity_are_refused() {
        let nine: Vec<String> = (0..9).map(|n| format!("urn:g{n}")).collect();
        assert!(plan_policy(None, "urn:acc", &nine, &["id".to_string()]).is_ok());
        let ten: Vec<String> = (0..10).map(|n| format!("urn:g{n}")).collect();
        assert!(plan_policy(None, "urn:acc", &ten, &["id".to_string()]).is_err());
        assert!(plan_policy(None, "urn:acc", &[], &[]).is_err());
    }

    #[test]
    fn policy_update_keeps_optional_fields() {
        let plan = plan_policy(None, "urn:acc", &[], &["id".to_string()]).unwrap();
        let raw = json!({
            "permissionsGroups": [{ "urn": "urn:pg" }],
            "conditions": null,
            "expiredAt": null
        });
        let body = policy_body(&plan, Some(&raw));
        assert_eq!(body["permissionsGroups"][0]["urn"], "urn:pg");
        assert!(body.get("conditions").is_none() && body.get("expiredAt").is_none());
    }

    #[test]
    fn parses_policy_and_group_payloads() {
        let policy = IamPolicy::from_json(&json!({
            "id": "p1", "name": POLICY_NAME, "identities": ["i1"],
            "resources": [{ "urn": "urn:acc" }, { "urn": "urn:g" }],
            "permissions": { "allow": [{ "action": "*" }] }
        }))
        .unwrap();
        assert!(policy.allow_all);
        assert_eq!(policy.resource_urns, vec!["urn:acc", "urn:g"]);
        let restricted = IamPolicy::from_json(&json!({
            "id": "p1", "name": "x",
            "permissions": { "allow": [{ "action": "*" }], "except": [{ "action": "a:b" }] }
        }))
        .unwrap();
        assert!(!restricted.allow_all);
        let group = IamGroup::from_json(&json!({
            "id": "g1", "name": GROUP_NAME, "urn": "urn:g",
            "resources": [{ "id": "r1" }, { "id": "r2" }]
        }))
        .unwrap();
        assert_eq!(group.resource_ids, vec!["r1", "r2"]);
    }
}
