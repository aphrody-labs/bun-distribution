// SPDX-License-Identifier: Apache-2.0
//! Strongly-typed client request dispatch for Tier-1 app-server methods.

use serde::{Deserialize, Serialize};

use crate::{
    rpc::{JSONRPCRequest, RequestId},
    types::*,
};

/// All requests supported by the app-server from a client.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum ClientRequest {
    #[serde(rename = "initialize")]
    Initialize {
        id: RequestId,
        params: InitializeParams,
    },
    #[serde(rename = "thread/start")]
    ThreadStart {
        id: RequestId,
        params: ThreadStartParams,
    },
    #[serde(rename = "thread/resume")]
    ThreadResume {
        id: RequestId,
        params: ThreadResumeParams,
    },
    #[serde(rename = "thread/fork")]
    ThreadFork {
        id: RequestId,
        params: ThreadForkParams,
    },
    #[serde(rename = "thread/list")]
    ThreadList {
        id: RequestId,
        #[serde(default)]
        params: ThreadListParams,
    },
    #[serde(rename = "thread/read")]
    ThreadRead {
        id: RequestId,
        params: ThreadReadParams,
    },
    #[serde(rename = "thread/archive")]
    ThreadArchive {
        id: RequestId,
        params: ThreadArchiveParams,
    },
    #[serde(rename = "thread/unarchive")]
    ThreadUnarchive {
        id: RequestId,
        params: ThreadUnarchiveParams,
    },
    #[serde(rename = "thread/close")]
    ThreadClose {
        id: RequestId,
        params: ThreadCloseParams,
    },
    #[serde(rename = "thread/compact/start")]
    ThreadCompactStart {
        id: RequestId,
        params: ThreadCompactStartParams,
    },
    #[serde(rename = "turn/start")]
    TurnStart {
        id: RequestId,
        params: TurnStartParams,
    },
    #[serde(rename = "turn/steer")]
    TurnSteer {
        id: RequestId,
        params: TurnSteerParams,
    },
    #[serde(rename = "turn/interrupt")]
    TurnInterrupt {
        id: RequestId,
        params: TurnInterruptParams,
    },
    #[serde(rename = "turn/events")]
    TurnEvents {
        id: RequestId,
        params: TurnEventsParams,
    },
    #[serde(rename = "model/list")]
    ModelList {
        id: RequestId,
        #[serde(default)]
        params: ModelListParams,
    },
    #[serde(rename = "config/read")]
    ConfigRead {
        id: RequestId,
        #[serde(default)]
        params: ConfigReadParams,
    },
    #[serde(rename = "account/login/start")]
    AccountLoginStart {
        id: RequestId,
        params: LoginAccountParams,
    },
    #[serde(rename = "account/read")]
    AccountRead {
        id: RequestId,
        #[serde(default)]
        params: GetAccountParams,
    },
    #[serde(rename = "account/logout")]
    AccountLogout { id: RequestId },
    #[serde(rename = "mcpServerStatus/list")]
    McpServerStatusList {
        id: RequestId,
        #[serde(default)]
        params: ListMcpServerStatusParams,
    },
    #[serde(rename = "tools/list")]
    ToolsList {
        id: RequestId,
        #[serde(default)]
        params: ToolsListParams,
    },
    #[serde(rename = "notifications/drain")]
    NotificationsDrain {
        id: RequestId,
        #[serde(default)]
        params: NotificationsDrainParams,
    },
    #[serde(rename = "shutdown")]
    Shutdown {
        id: RequestId,
        #[serde(default)]
        params: ShutdownParams,
    },
    // Aphrody extended methods
    #[serde(rename = "aphrody/status")]
    AphrodyStatus {
        id: RequestId,
        #[serde(default)]
        params: AphrodyStatusParams,
    },
    #[serde(rename = "aphrody/rag/search")]
    RagSearch {
        id: RequestId,
        params: RagSearchParams,
    },
    #[serde(rename = "aphrody/rag/context")]
    RagContext {
        id: RequestId,
        params: RagContextParams,
    },
    #[serde(rename = "aphrody/rag/status")]
    RagStatus {
        id: RequestId,
        params: RagStatusParams,
    },
    #[serde(rename = "aphrody/llama/status")]
    LlamaStatus {
        id: RequestId,
        params: LlamaStatusParams,
    },
    #[serde(rename = "aphrody/train/status")]
    TrainStatus {
        id: RequestId,
        params: TrainStatusParams,
    },
}

impl ClientRequest {
    /// Return the request identifier.
    #[must_use]
    pub fn id(&self) -> &RequestId {
        match self {
            Self::Initialize { id, .. }
            | Self::ThreadStart { id, .. }
            | Self::ThreadResume { id, .. }
            | Self::ThreadFork { id, .. }
            | Self::ThreadList { id, .. }
            | Self::ThreadRead { id, .. }
            | Self::ThreadArchive { id, .. }
            | Self::ThreadUnarchive { id, .. }
            | Self::ThreadClose { id, .. }
            | Self::ThreadCompactStart { id, .. }
            | Self::TurnStart { id, .. }
            | Self::TurnSteer { id, .. }
            | Self::TurnInterrupt { id, .. }
            | Self::TurnEvents { id, .. }
            | Self::ModelList { id, .. }
            | Self::ConfigRead { id, .. }
            | Self::AccountLoginStart { id, .. }
            | Self::AccountRead { id, .. }
            | Self::AccountLogout { id }
            | Self::McpServerStatusList { id, .. }
            | Self::ToolsList { id, .. }
            | Self::NotificationsDrain { id, .. }
            | Self::Shutdown { id, .. }
            | Self::AphrodyStatus { id, .. }
            | Self::RagSearch { id, .. }
            | Self::RagContext { id, .. }
            | Self::RagStatus { id, .. }
            | Self::LlamaStatus { id, .. }
            | Self::TrainStatus { id, .. } => id,
        }
    }

    /// Return the wire method name.
    #[must_use]
    pub const fn method_name(&self) -> &'static str {
        match self {
            Self::Initialize { .. } => "initialize",
            Self::ThreadStart { .. } => "thread/start",
            Self::ThreadResume { .. } => "thread/resume",
            Self::ThreadFork { .. } => "thread/fork",
            Self::ThreadList { .. } => "thread/list",
            Self::ThreadRead { .. } => "thread/read",
            Self::ThreadArchive { .. } => "thread/archive",
            Self::ThreadUnarchive { .. } => "thread/unarchive",
            Self::ThreadClose { .. } => "thread/close",
            Self::ThreadCompactStart { .. } => "thread/compact/start",
            Self::TurnStart { .. } => "turn/start",
            Self::TurnSteer { .. } => "turn/steer",
            Self::TurnInterrupt { .. } => "turn/interrupt",
            Self::TurnEvents { .. } => "turn/events",
            Self::ModelList { .. } => "model/list",
            Self::ConfigRead { .. } => "config/read",
            Self::AccountLoginStart { .. } => "account/login/start",
            Self::AccountRead { .. } => "account/read",
            Self::AccountLogout { .. } => "account/logout",
            Self::McpServerStatusList { .. } => "mcpServerStatus/list",
            Self::ToolsList { .. } => "tools/list",
            Self::NotificationsDrain { .. } => "notifications/drain",
            Self::Shutdown { .. } => "shutdown",
            Self::AphrodyStatus { .. } => "aphrody/status",
            Self::RagSearch { .. } => "aphrody/rag/search",
            Self::RagContext { .. } => "aphrody/rag/context",
            Self::RagStatus { .. } => "aphrody/rag/status",
            Self::LlamaStatus { .. } => "aphrody/llama/status",
            Self::TrainStatus { .. } => "aphrody/train/status",
        }
    }

    /// Convert from a generic wire [`JSONRPCRequest`].
    ///
    /// # Errors
    /// Returns a [`serde_json::Error`] if the method is unsupported or payload does not match
    /// schema.
    pub fn from_jsonrpc(req: JSONRPCRequest) -> Result<Self, serde_json::Error> {
        let mut obj = serde_json::Map::new();
        obj.insert("method".to_string(), serde_json::Value::String(req.method));
        obj.insert("id".to_string(), serde_json::to_value(req.id)?);
        if let Some(p) = req.params {
            obj.insert("params".to_string(), p);
        }
        serde_json::from_value(serde_json::Value::Object(obj))
    }
}
