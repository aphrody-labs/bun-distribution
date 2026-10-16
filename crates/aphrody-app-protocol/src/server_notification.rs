// SPDX-License-Identifier: Apache-2.0
//! Server-to-client streaming notifications.

use serde::{Deserialize, Serialize};

use crate::{rpc::JSONRPCNotification, types::*};

/// All notifications pushed by the server to the client.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
pub enum ServerNotification {
    #[serde(rename = "thread/started")]
    ThreadStarted(ThreadStartedNotification),
    #[serde(rename = "thread/status/changed")]
    ThreadStatusChanged(ThreadStatusChangedNotification),
    #[serde(rename = "thread/closed")]
    ThreadClosed(ThreadClosedNotification),
    #[serde(rename = "thread/archived")]
    ThreadArchived(ThreadArchivedNotification),
    #[serde(rename = "turn/started")]
    TurnStarted(TurnStartedNotification),
    #[serde(rename = "turn/completed")]
    TurnCompleted(TurnCompletedNotification),
    #[serde(rename = "turn/diff/updated")]
    TurnDiffUpdated(TurnDiffUpdatedNotification),
    #[serde(rename = "turn/plan/updated")]
    TurnPlanUpdated(TurnPlanUpdatedNotification),
    #[serde(rename = "item/started")]
    ItemStarted(ItemStartedNotification),
    #[serde(rename = "item/completed")]
    ItemCompleted(ItemCompletedNotification),
    #[serde(rename = "item/agentMessage/delta")]
    AgentMessageDelta(AgentMessageDeltaNotification),
    #[serde(rename = "item/plan/delta")]
    PlanDelta(PlanDeltaNotification),
    #[serde(rename = "item/commandExecution/outputDelta")]
    CommandExecutionOutputDelta(CommandExecutionOutputDeltaNotification),
    #[serde(rename = "command/exec/outputDelta")]
    CommandExecOutputDelta(CommandExecOutputDeltaNotification),
    #[serde(rename = "item/fileChange/outputDelta")]
    FileChangeOutputDelta(FileChangeOutputDeltaNotification),
    #[serde(rename = "error")]
    Error(ErrorNotification),
}

impl ServerNotification {
    /// Return the wire method name for this notification.
    #[must_use]
    pub const fn method_name(&self) -> &'static str {
        match self {
            Self::ThreadStarted(_) => "thread/started",
            Self::ThreadStatusChanged(_) => "thread/status/changed",
            Self::ThreadClosed(_) => "thread/closed",
            Self::ThreadArchived(_) => "thread/archived",
            Self::TurnStarted(_) => "turn/started",
            Self::TurnCompleted(_) => "turn/completed",
            Self::TurnDiffUpdated(_) => "turn/diff/updated",
            Self::TurnPlanUpdated(_) => "turn/plan/updated",
            Self::ItemStarted(_) => "item/started",
            Self::ItemCompleted(_) => "item/completed",
            Self::AgentMessageDelta(_) => "item/agentMessage/delta",
            Self::PlanDelta(_) => "item/plan/delta",
            Self::CommandExecutionOutputDelta(_) => "item/commandExecution/outputDelta",
            Self::CommandExecOutputDelta(_) => "command/exec/outputDelta",
            Self::FileChangeOutputDelta(_) => "item/fileChange/outputDelta",
            Self::Error(_) => "error",
        }
    }

    /// Convert into generic wire [`JSONRPCNotification`].
    ///
    /// # Errors
    /// Returns a [`serde_json::Error`] if serialization fails.
    pub fn to_jsonrpc(&self) -> Result<JSONRPCNotification, serde_json::Error> {
        let val = serde_json::to_value(self)?;
        let method = val
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        let params = val.get("params").cloned();
        Ok(JSONRPCNotification::new(method, params))
    }
}
