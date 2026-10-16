// SPDX-License-Identifier: Apache-2.0
//! Typed adapters to the same protocol checks Bun uses.
use crate::{JevError, Request, Response, protocol};
fn value<T: serde::Serialize>(value: &T) -> Result<serde_json::Value, JevError> {
    let bytes =
        serde_json::to_vec(value).map_err(|error| JevError::InvalidRequest(error.to_string()))?;
    protocol::parse(&bytes).map_err(JevError::InvalidRequest)
}
pub fn check_request(request: &Request) -> Result<(), JevError> {
    protocol::request(&value(request)?).map_err(JevError::InvalidRequest)
}
pub fn check_response(request: &Request, response: &Response) -> Result<(), JevError> {
    protocol::response(&value(response)?, &value(request)?).map_err(JevError::Format)
}
