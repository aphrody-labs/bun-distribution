// SPDX-License-Identifier: Apache-2.0
//! Windows Event Log queries through the Windows Event Log API (`EvtQuery`, `EvtNext`,
//! `EvtRender`, `EvtFormatMessage`) instead of `wevtutil qe`. Events are returned newest first
//! (`EvtQueryReverseDirection`), rendered from the system properties, with the publisher's
//! formatted message when its metadata is available.

use std::io;

use serde_json::Value;

/// Query `channel` (optionally filtered by an XPath expression) for at most `max_events`
/// events, newest first.
pub fn query_event_log(
    channel: &str,
    max_events: u32,
    xpath_filter: Option<&str>,
) -> io::Result<Value> {
    if channel.trim().is_empty() || channel.chars().any(|c| c.is_control() || c == '"') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid event log channel",
        ));
    }
    let max_events = max_events.clamp(1, 1000);
    if let Some(filter) = xpath_filter
        && filter.chars().any(|c| c.is_control() || c == '"')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid event log XPath",
        ));
    }
    let query = xpath_filter
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("*");
    let entries = imp::query(channel.trim(), query, max_events as usize)?;
    Ok(serde_json::json!({
        "Channel": channel,
        "Count": entries.len(),
        "Truncated": entries.len() >= max_events as usize,
        "Entries": entries,
    }))
}

/// Standard event level names (`winmeta.xml`); level 0 (LogAlways) displays as Information.
#[cfg(any(windows, test))]
fn level_name(level: u8) -> String {
    match level {
        0 | 4 => "Information".to_owned(),
        1 => "Critical".to_owned(),
        2 => "Error".to_owned(),
        3 => "Warning".to_owned(),
        5 => "Verbose".to_owned(),
        other => format!("Level{other}"),
    }
}

#[cfg(windows)]
mod imp {
    use std::{collections::HashMap, io};

    use serde_json::{Value, json};
    use windows::{
        Win32::{
            Foundation::{
                ERROR_EVT_UNRESOLVED_VALUE_INSERT, ERROR_INSUFFICIENT_BUFFER, ERROR_NO_MORE_ITEMS,
            },
            System::EventLog::{
                EVT_HANDLE, EVT_VARIANT, EvtClose, EvtCreateRenderContext, EvtFormatMessage,
                EvtFormatMessageEvent, EvtNext, EvtOpenPublisherMetadata, EvtQuery,
                EvtQueryChannelPath, EvtQueryReverseDirection, EvtRender, EvtRenderContextSystem,
                EvtRenderEventValues, EvtSystemChannel, EvtSystemEventID, EvtSystemEventRecordId,
                EvtSystemLevel, EvtSystemProviderName, EvtSystemTimeCreated, EvtVarTypeByte,
                EvtVarTypeFileTime, EvtVarTypeString, EvtVarTypeUInt16, EvtVarTypeUInt64,
            },
        },
        core::PCWSTR,
    };

    use super::level_name;
    use crate::{
        timefmt::filetime_to_rfc3339,
        win32::{from_wide, from_wide_ptr, hresult_error, pcwstr, wide, win32_code},
    };

    /// Events fetched per `EvtNext` call.
    const BATCH: usize = 32;
    /// `EvtNext` timeout for local channels.
    const NEXT_TIMEOUT_MS: u32 = 10_000;

    /// An event log handle, closed on drop.
    struct Handle(EVT_HANDLE);

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: the handle came from an Evt* call and is closed exactly once.
            let _ = unsafe { EvtClose(self.0) };
        }
    }

    /// System properties of one event, rendered with a system render context.
    struct SystemValues(Vec<EVT_VARIANT>);

    impl SystemValues {
        fn render(context: &Handle, event: &Handle) -> io::Result<Self> {
            let mut used = 0u32;
            let mut count = 0u32;
            // SAFETY: size probe with no buffer.
            let probe = unsafe {
                EvtRender(
                    Some(context.0),
                    event.0,
                    EvtRenderEventValues.0,
                    0,
                    None,
                    &mut used,
                    &mut count,
                )
            };
            if let Err(error) = probe
                && win32_code(&error) != Some(ERROR_INSUFFICIENT_BUFFER)
            {
                return Err(hresult_error(&error, "EvtRender"));
            }
            let slots = (used as usize).div_ceil(std::mem::size_of::<EVT_VARIANT>());
            let mut values = vec![EVT_VARIANT::default(); slots.max(1)];
            let size = u32::try_from(values.len() * std::mem::size_of::<EVT_VARIANT>())
                .unwrap_or(u32::MAX);
            // SAFETY: `values` provides `size` bytes of EVT_VARIANT-aligned storage.
            unsafe {
                EvtRender(
                    Some(context.0),
                    event.0,
                    EvtRenderEventValues.0,
                    size,
                    Some(values.as_mut_ptr().cast()),
                    &mut used,
                    &mut count,
                )
            }
            .map_err(|error| hresult_error(&error, "EvtRender"))?;
            values.truncate((count as usize).min(values.len()));
            Ok(Self(values))
        }

        fn get(&self, index: i32, expected: i32) -> Option<&EVT_VARIANT> {
            let value = self.0.get(usize::try_from(index).ok()?)?;
            (value.Type == expected as u32).then_some(value)
        }

        fn string(&self, index: i32) -> Option<String> {
            let value = self.get(index, EvtVarTypeString.0)?;
            // SAFETY: the type tag says StringVal is the live union member; it points into the
            // render buffer owned by `self`.
            Some(unsafe { from_wide_ptr(value.Anonymous.StringVal.0) })
        }

        fn u64(&self, index: i32, expected: i32) -> Option<u64> {
            let value = self.get(index, expected)?;
            // SAFETY: the type tag selects the live union member.
            Some(unsafe {
                match expected {
                    t if t == EvtVarTypeByte.0 => u64::from(value.Anonymous.ByteVal),
                    t if t == EvtVarTypeUInt16.0 => u64::from(value.Anonymous.UInt16Val),
                    t if t == EvtVarTypeFileTime.0 => value.Anonymous.FileTimeVal,
                    _ => value.Anonymous.UInt64Val,
                }
            })
        }
    }

    /// Publisher metadata handles, opened once per provider (`None` when unavailable).
    #[derive(Default)]
    struct Publishers(HashMap<String, Option<Handle>>);

    impl Publishers {
        fn message(&mut self, provider: &str, event: &Handle) -> String {
            let publisher = self.0.entry(provider.to_owned()).or_insert_with(|| {
                let name = wide(provider);
                // SAFETY: `name` is NUL-terminated; locale 0 is the user's default language.
                unsafe { EvtOpenPublisherMetadata(None, pcwstr(&name), PCWSTR::null(), 0, 0) }
                    .ok()
                    .map(Handle)
            });
            let Some(publisher) = publisher else {
                return String::new();
            };
            let mut used = 0u32;
            // SAFETY: size probe with no buffer.
            let probe = unsafe {
                EvtFormatMessage(
                    Some(publisher.0),
                    Some(event.0),
                    0,
                    None,
                    EvtFormatMessageEvent.0,
                    None,
                    &mut used,
                )
            };
            if probe.is_ok() || used == 0 {
                return String::new();
            }
            let mut buffer = vec![0u16; used as usize];
            // SAFETY: `buffer` holds `used` UTF-16 units.
            let formatted = unsafe {
                EvtFormatMessage(
                    Some(publisher.0),
                    Some(event.0),
                    0,
                    None,
                    EvtFormatMessageEvent.0,
                    Some(&mut buffer),
                    &mut used,
                )
            };
            match formatted {
                Ok(()) => from_wide(&buffer).trim_end().to_owned(),
                // Missing insertion strings still produce the rest of the message.
                Err(error) if win32_code(&error) == Some(ERROR_EVT_UNRESOLVED_VALUE_INSERT) => {
                    from_wide(&buffer).trim_end().to_owned()
                }
                Err(_) => String::new(),
            }
        }
    }

    fn entry(context: &Handle, event: &Handle, publishers: &mut Publishers) -> io::Result<Value> {
        let values = SystemValues::render(context, event)?;
        let provider = values.string(EvtSystemProviderName.0).unwrap_or_default();
        let level = values.u64(EvtSystemLevel.0, EvtVarTypeByte.0);
        let message = if provider.is_empty() {
            String::new()
        } else {
            publishers.message(&provider, event)
        };
        Ok(json!({
            "RecordId": values.u64(EvtSystemEventRecordId.0, EvtVarTypeUInt64.0),
            "TimeCreatedUtc": values
                .u64(EvtSystemTimeCreated.0, EvtVarTypeFileTime.0)
                .map(filetime_to_rfc3339),
            "EventId": values.u64(EvtSystemEventID.0, EvtVarTypeUInt16.0),
            "Level": level,
            "LevelName": level.map(|level| level_name(level as u8)),
            "ProviderName": provider,
            "Channel": values.string(EvtSystemChannel.0).unwrap_or_default(),
            "Message": message,
        }))
    }

    pub(super) fn query(channel: &str, xpath: &str, max_events: usize) -> io::Result<Vec<Value>> {
        let channel_wide = wide(channel);
        let query_wide = wide(xpath);
        // SAFETY: both strings are NUL-terminated; local session.
        let results = unsafe {
            EvtQuery(
                None,
                pcwstr(&channel_wide),
                pcwstr(&query_wide),
                EvtQueryChannelPath.0 | EvtQueryReverseDirection.0,
            )
        }
        .map(Handle)
        .map_err(|error| hresult_error(&error, &format!("query event log '{channel}'")))?;
        // SAFETY: a system-properties render context needs no value paths.
        let context = unsafe { EvtCreateRenderContext(None, EvtRenderContextSystem.0) }
            .map(Handle)
            .map_err(|error| hresult_error(&error, "EvtCreateRenderContext"))?;
        let mut publishers = Publishers::default();
        let mut entries = Vec::new();
        while entries.len() < max_events {
            let mut batch = [0isize; BATCH];
            let wanted = BATCH.min(max_events - entries.len());
            let mut returned = 0u32;
            // SAFETY: `batch` receives up to `wanted` event handles.
            match unsafe {
                EvtNext(
                    results.0,
                    &mut batch[..wanted],
                    NEXT_TIMEOUT_MS,
                    0,
                    &mut returned,
                )
            } {
                Ok(()) => {}
                Err(error) if win32_code(&error) == Some(ERROR_NO_MORE_ITEMS) => break,
                Err(error) => return Err(hresult_error(&error, "EvtNext")),
            }
            // Take ownership of every returned handle first so all of them are closed.
            let events: Vec<Handle> = batch[..returned as usize]
                .iter()
                .map(|&raw| Handle(EVT_HANDLE(raw)))
                .collect();
            for event in &events {
                entries.push(entry(&context, event, &mut publishers)?);
            }
            if returned == 0 {
                break;
            }
        }
        Ok(entries)
    }
}

#[cfg(not(windows))]
mod imp {
    use std::io;

    use serde_json::Value;

    pub(super) fn query(_channel: &str, _xpath: &str, _max: usize) -> io::Result<Vec<Value>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "event log is Windows-only",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::{level_name, query_event_log};

    #[test]
    fn invalid_channels_and_filters_are_rejected() {
        for channel in ["", "  ", "bad\"channel", "bad\nchannel"] {
            assert_eq!(
                query_event_log(channel, 1, None).expect_err(channel).kind(),
                std::io::ErrorKind::InvalidInput
            );
        }
        assert_eq!(
            query_event_log("System", 1, Some("*[System[Level=\"2\"]]"))
                .expect_err("quote")
                .kind(),
            std::io::ErrorKind::InvalidInput
        );
    }

    #[test]
    fn standard_levels_have_names() {
        assert_eq!(level_name(2), "Error");
        assert_eq!(level_name(3), "Warning");
        assert_eq!(level_name(0), "Information");
        assert_eq!(level_name(9), "Level9");
    }

    #[cfg(windows)]
    #[test]
    fn system_log_returns_the_newest_event() {
        let result = query_event_log("System", 1, None).expect("query the System log");
        assert_eq!(result["Channel"], "System");
        assert_eq!(result["Count"], 1);
        assert_eq!(result["Truncated"], true);
        let entry = &result["Entries"][0];
        assert!(
            entry["RecordId"].as_u64().is_some_and(|id| id > 0),
            "{entry}"
        );
        assert!(entry["EventId"].as_u64().is_some(), "{entry}");
        assert!(entry["Level"].as_u64().is_some(), "{entry}");
        assert!(
            entry["LevelName"]
                .as_str()
                .is_some_and(|name| !name.is_empty()),
            "{entry}"
        );
        assert_eq!(entry["Channel"], "System");
        assert!(
            entry["ProviderName"]
                .as_str()
                .is_some_and(|name| !name.is_empty()),
            "{entry}"
        );
        let created = entry["TimeCreatedUtc"].as_str().expect("TimeCreatedUtc");
        assert!(created.len() == 28 && created.ends_with('Z'), "{created}");
    }

    #[cfg(windows)]
    #[test]
    fn filters_and_missing_channels_follow_wevtapi() {
        let newest_first = query_event_log(
            "System",
            5,
            Some("*[System[(Level=1 or Level=2 or Level=3 or Level=4 or Level=0)]]"),
        )
        .expect("filtered query");
        let ids: Vec<u64> = newest_first["Entries"]
            .as_array()
            .expect("entries")
            .iter()
            .filter_map(|entry| entry["RecordId"].as_u64())
            .collect();
        assert!(
            ids.windows(2).all(|pair| pair[0] > pair[1]),
            "newest first: {ids:?}"
        );
        let error = query_event_log("Aphrody-No-Such-Channel/Operational", 1, None)
            .expect_err("missing channel");
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
    }
}
