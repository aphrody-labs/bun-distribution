// SPDX-License-Identifier: Apache-2.0
//! X Premium / Blue Verified — Upsells GraphQL and account flags.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Result, client::XClient};

const PREMIUM_MAX_WAIT: Duration = Duration::from_secs(120);

/// Known upsell surface keys on x.com.
pub const UPSELL_SURFACES: &[&str] =
    &["UserProfileName", "UserProfileHeader", "HomeSidebar", "PremiumNav", "HomeNav"];

pub use crate::surface::{PREMIUM_GRAPHQL_OPS, PRODUCT_SKUS};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PremiumAccountFlags {
    #[serde(default)]
    pub is_blue_verified: Option<bool>,
    #[serde(default)]
    pub premium_gifting_eligible: Option<bool>,
    #[serde(default)]
    pub creator_subscriptions_count: Option<u64>,
    #[serde(default)]
    pub super_follow_eligible: Option<bool>,
    #[serde(default)]
    pub super_followers_count: Option<u64>,
    #[serde(default)]
    pub is_super_follow_subscriber: Option<bool>,
    #[serde(default)]
    pub can_access_payments: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsellConfigEntry {
    pub key: String,
    #[serde(default)]
    pub product_category: Option<String>,
    #[serde(default)]
    pub charge_interval: Option<String>,
    #[serde(default)]
    pub is_hidden: Option<bool>,
    /// `attribution_params.referrer` of the surface.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution_referrer: Option<String>,
    /// The raw `destination` object (`product_category` and `charge_interval` are lifted out of it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub destination: Option<Value>,
    /// Key of the variant (or default content) the surface renders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant_key: Option<String>,
    /// Call-to-action label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_label: Option<String>,
    /// Primary label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PremiumUpsells {
    pub configs: Vec<UpsellConfigEntry>,
}

fn dig<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = v;
    for key in path {
        cur = cur.get(key)?;
    }
    Some(cur)
}

/// Parse `Upsells` → `viewer_v2.upsell_config_for_surfaces`.
pub fn parse_upsells_response(json: &Value) -> PremiumUpsells {
    let mut configs = Vec::new();
    let Some(arr) = dig(
        json,
        &["data", "viewer_v2", "user_results", "result", "upsell_config_for_surfaces", "configs"],
    )
    .and_then(|v| v.as_array()) else {
        return PremiumUpsells { configs };
    };

    for item in arr {
        let key = item.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let val = item.get("value");
        let def = val.and_then(|v| v.get("default_content"));
        let variant = val
            .and_then(|v| v.get("variant_config"))
            .and_then(|v| v.get("variants"))
            .and_then(|v| v.as_array())
            .and_then(|a| a.first());
        let content = variant.or(def);
        let destination = content.and_then(|c| c.get("destination"));
        let text = |value: Option<&Value>| value.and_then(Value::as_str).map(str::to_owned);
        let render = content.and_then(|c| c.get("render_properties"));
        configs.push(UpsellConfigEntry {
            key,
            product_category: text(destination.and_then(|d| d.get("product_category"))),
            charge_interval: text(destination.and_then(|d| d.get("charge_interval"))),
            is_hidden: def.and_then(|d| d.get("is_hidden")).and_then(|v| v.as_bool()),
            attribution_referrer: text(val.and_then(|v| v.pointer("/attribution_params/referrer"))),
            destination: destination.cloned(),
            variant_key: text(content.and_then(|c| c.get("key"))),
            action_label: text(
                render
                    .and_then(|r| r.get("action_label"))
                    .or_else(|| render.and_then(|r| r.pointer("/cta/action_label"))),
            ),
            primary_label: text(render.and_then(|r| r.get("primary_label"))),
        });
    }
    PremiumUpsells { configs }
}

/// Extract premium-related flags from Viewer + optional UserByScreenName JSON.
pub fn parse_premium_flags(viewer: &Value, user_by_screen: Option<&Value>) -> PremiumAccountFlags {
    let user = viewer
        .pointer("/data/viewer/user_results/result")
        .or_else(|| user_by_screen.and_then(|u| u.pointer("/data/user/result")));
    let viewer_root = viewer.get("data");
    PremiumAccountFlags {
        is_blue_verified: user.and_then(|u| u.get("is_blue_verified")).and_then(|v| v.as_bool()),
        premium_gifting_eligible: user
            .and_then(|u| u.get("premium_gifting_eligible"))
            .and_then(|v| v.as_bool()),
        creator_subscriptions_count: user
            .and_then(|u| u.get("creator_subscriptions_count"))
            .and_then(|v| v.as_u64()),
        super_follow_eligible: user
            .and_then(|u| u.get("super_follow_eligible"))
            .and_then(|v| v.as_bool()),
        super_followers_count: viewer_root
            .and_then(|r| r.pointer("/viewer/super_followers_count"))
            .and_then(|v| v.as_u64()),
        is_super_follow_subscriber: viewer_root
            .and_then(|r| r.get("is_super_follow_subscriber"))
            .and_then(|v| v.as_bool()),
        can_access_payments: viewer_root
            .and_then(|r| r.get("can_access_payments"))
            .and_then(|v| v.as_bool()),
    }
}

/// Variable templates for every operation of [`PREMIUM_GRAPHQL_OPS`] (full Premium coverage).
pub fn premium_variables(handle: &str, user_id: &str) -> serde_json::Map<String, Value> {
    use serde_json::json;
    let timeline = json!({ "userId": user_id, "count": 50, "includePromotedContent": false });
    let mut out = serde_json::Map::new();
    for (op, vars) in [
        ("Upsells", json!({})),
        ("Viewer", json!({ "withCommunitiesMemberships": true })),
        ("UserByScreenName", json!({ "screen_name": handle, "withSafetyModeUserFields": true })),
        ("UserCreatorSubscriptions", timeline.clone()),
        ("CreatorSubscriptionsTimeline", timeline.clone()),
        ("UserCreatorSubscribers", timeline.clone()),
        ("SuperFollowers", timeline),
        (
            "BlueVerifiedFollowers",
            json!({ "userId": user_id, "count": 20, "includePromotedContent": false }),
        ),
        (
            "UserArticlesTweets",
            json!({
                "userId": user_id,
                "count": 20,
                "includePromotedContent": true,
                "withVoice": true
            }),
        ),
        ("UsersVerifiedAvatars", json!({ "userIds": [user_id] })),
        ("EnableVerifiedPhoneLabel", json!({})),
        ("DisableVerifiedPhoneLabel", json!({})),
    ] {
        out.insert(op.to_owned(), vars);
    }
    out
}

impl XClient {
    /// Fetch parsed Upsells for the logged-in viewer.
    pub async fn premium_upsells(&self) -> Result<PremiumUpsells> {
        let json =
            self.graphql_waiting("Upsells", serde_json::json!({}), None, PREMIUM_MAX_WAIT).await?;
        Ok(parse_upsells_response(&json))
    }

    /// Upsells + Viewer + UserByScreenName in parallel.
    pub async fn premium_bundle(
        &self,
        handle: &str,
    ) -> Result<(PremiumUpsells, PremiumAccountFlags, Value, Value, Value)> {
        let (upsells, viewer, user) = tokio::join!(
            self.graphql_waiting("Upsells", serde_json::json!({}), None, PREMIUM_MAX_WAIT),
            self.graphql_waiting(
                "Viewer",
                serde_json::json!({ "withCommunitiesMemberships": true }),
                None,
                PREMIUM_MAX_WAIT
            ),
            self.graphql_waiting(
                "UserByScreenName",
                serde_json::json!({
                    "screen_name": handle,
                    "withSafetyModeUserFields": true
                }),
                None,
                PREMIUM_MAX_WAIT
            ),
        );
        let upsells = upsells?;
        let viewer = viewer?;
        let user = user?;
        let parsed = parse_upsells_response(&upsells);
        let flags = parse_premium_flags(&viewer, Some(&user));
        Ok((parsed, flags, upsells, viewer, user))
    }
}
