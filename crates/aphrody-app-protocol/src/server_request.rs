// SPDX-License-Identifier: Apache-2.0
//! Server-to-client approval and elicitation requests.

use serde::{Deserialize, Serialize};

use crate::{
    rpc::{JSONRPCRequest, RequestId},
    types::*,
};

/// A request sent by the server to the client that expects an approval or input response.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum ServerRequest {
    #[serde(rename = "item/commandExecution/requestApproval")]
    CommandExecutionApproval {
        id: RequestId,
        params: CommandExecutionRequestApprovalParams,
    },
    #[serde(rename = "item/fileChange/requestApproval")]
    FileChangeApproval {
        id: RequestId,
        params: FileChangeRequestApprovalParams,
    },
    #[serde(rename = "item/permissions/requestApproval")]
    PermissionsApproval {
        id: RequestId,
        params: PermissionsRequestApprovalParams,
    },
    #[serde(rename = "item/tool/requestUserInput")]
    ToolRequestUserInput {
        id: RequestId,
        params: ToolRequestUserInputParams,
    },
}

impl ServerRequest {
    /// Return the request identifier.
    #[must_use]
    pub fn id(&self) -> &RequestId {
        match self {
            Self::CommandExecutionApproval { id, .. }
            | Self::FileChangeApproval { id, .. }
            | Self::PermissionsApproval { id, .. }
            | Self::ToolRequestUserInput { id, .. } => id,
        }
    }

    /// Return the wire method name.
    #[must_use]
    pub const fn method_name(&self) -> &'static str {
        match self {
            Self::CommandExecutionApproval { .. } => "item/commandExecution/requestApproval",
            Self::FileChangeApproval { .. } => "item/fileChange/requestApproval",
            Self::PermissionsApproval { .. } => "item/permissions/requestApproval",
            Self::ToolRequestUserInput { .. } => "item/tool/requestUserInput",
        }
    }

    /// Convert into generic wire [`JSONRPCRequest`].
    ///
    /// # Errors
    /// Returns a [`serde_json::Error`] if serialization fails.
    pub fn to_jsonrpc(&self) -> Result<JSONRPCRequest, serde_json::Error> {
        let val = serde_json::to_value(self)?;
        let method = val
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        let params = val.get("params").cloned();
        Ok(JSONRPCRequest::new(self.id().clone(), method, params))
    }
}
