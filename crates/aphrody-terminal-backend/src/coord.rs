// SPDX-License-Identifier: Apache-2.0
//! Terminal compatibility surface over the canonical OS mailbox proxy.
pub use aphrody_a2a_coord::proxy::{
    CoordBody, CoordError, CoordProxy, CoordResponseKind, DEFAULT_TAIL_INTERVAL, HttpResponse,
    NDJSON_CONTENT_TYPE, SSE_CONTENT_TYPE,
};
