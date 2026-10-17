// SPDX-License-Identifier: Apache-2.0
//! Microsoft Defender status through WMI (`ROOT\Microsoft\Windows\Defender`,
//! `MSFT_MpComputerStatus` and `MSFT_MpThreat`) instead of `powershell.exe
//! Get-MpComputerStatus`. The COM query runs in-process in a scoped apartment.

use std::io;

use serde_json::Value;

/// Defender state: `AntivirusEnabled`, `RealTimeProtectionEnabled`, `BehaviorMonitorEnabled`,
/// `TamperProtected`, `AntivirusSignatureVersion`, `LastQuickScanStartUtc`,
/// `LastFullScanStartUtc` (RFC 3339 UTC or null) and `ThreatCount` (known threats, or null when
/// the threat catalogue is not readable).
pub fn get_defender_status() -> io::Result<Value> {
    imp::status()
}

#[cfg(windows)]
mod imp {
    use std::io;

    use serde_json::{Value, json};
    use windows::{
        Win32::System::{
            Com::{
                CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoSetProxyBlanket,
                EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
            },
            Variant::{
                VARIANT, VT_BOOL, VT_BSTR, VT_I2, VT_I4, VT_I8, VT_UI1, VT_UI2, VT_UI4, VT_UI8,
                VariantClear,
            },
            Wmi::{
                IEnumWbemClassObject, IWbemClassObject, IWbemLocator, IWbemServices,
                WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY, WBEM_INFINITE, WbemLocator,
            },
        },
        core::{BSTR, PCWSTR},
    };

    use crate::{
        timefmt::cim_datetime_to_rfc3339,
        win32::{ComScope, hresult_error, pcwstr, wide},
    };

    /// `RPC_C_AUTHN_WINNT` / `RPC_C_AUTHZ_NONE` (`rpcdce.h`).
    const RPC_C_AUTHN_WINNT: u32 = 10;
    const RPC_C_AUTHZ_NONE: u32 = 0;

    const NAMESPACE: &str = r"ROOT\Microsoft\Windows\Defender";

    fn connect() -> io::Result<IWbemServices> {
        // SAFETY: in-process WMI locator; COM is initialised by the caller's `ComScope`.
        let locator: IWbemLocator =
            unsafe { CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER) }
                .map_err(|error| hresult_error(&error, "create the WMI locator"))?;
        let empty = BSTR::new();
        // SAFETY: local connection with the caller's credentials.
        let services = unsafe {
            locator.ConnectServer(
                &BSTR::from(NAMESPACE),
                &empty,
                &empty,
                &empty,
                0,
                &empty,
                None,
            )
        }
        .map_err(|error| {
            let mut mapped =
                hresult_error(&error, &format!("connect to WMI namespace {NAMESPACE}"));
            // WBEM_E_INVALID_NAMESPACE: Defender is not installed (or replaced by another AV).
            if error.code().0 as u32 == 0x8004_100E {
                mapped = io::Error::new(io::ErrorKind::NotFound, mapped.to_string());
            }
            mapped
        })?;
        // SAFETY: impersonation is required by the Defender provider; `services` is a proxy.
        unsafe {
            CoSetProxyBlanket(
                &services,
                RPC_C_AUTHN_WINNT,
                RPC_C_AUTHZ_NONE,
                PCWSTR::null(),
                RPC_C_AUTHN_LEVEL_CALL,
                RPC_C_IMP_LEVEL_IMPERSONATE,
                None,
                EOAC_NONE,
            )
        }
        .map_err(|error| hresult_error(&error, "CoSetProxyBlanket"))?;
        Ok(services)
    }

    fn query(services: &IWbemServices, wql: &str) -> io::Result<IEnumWbemClassObject> {
        // SAFETY: WQL query on a connected namespace.
        unsafe {
            services.ExecQuery(
                &BSTR::from("WQL"),
                &BSTR::from(wql),
                WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY,
                None,
            )
        }
        .map_err(|error| hresult_error(&error, &format!("WMI query `{wql}`")))
    }

    /// The next object of an enumeration, `None` at its end.
    fn next(enumerator: &IEnumWbemClassObject) -> io::Result<Option<IWbemClassObject>> {
        let mut objects = [None];
        let mut returned = 0u32;
        // SAFETY: room for one object; `returned` receives the count.
        let hr = unsafe { enumerator.Next(WBEM_INFINITE, &mut objects, &mut returned) };
        if hr.is_err() {
            return Err(hresult_error(
                &windows::core::Error::from(hr),
                "WMI enumeration",
            ));
        }
        let [object] = objects;
        Ok(if returned == 0 { None } else { object })
    }

    /// A property as JSON: booleans, integers and strings map directly, NULL/EMPTY to null.
    fn property(object: &IWbemClassObject, name: &str) -> io::Result<Value> {
        let wide_name = wide(name);
        let mut variant = VARIANT::default();
        // SAFETY: `variant` receives an owned copy of the property value.
        unsafe { object.Get(pcwstr(&wide_name), 0, &mut variant, None, None) }
            .map_err(|error| hresult_error(&error, &format!("read WMI property {name}")))?;
        // SAFETY: the `vt` tag selects the live union member; the variant is cleared after use.
        let value = unsafe {
            let inner = &variant.Anonymous.Anonymous;
            match inner.vt {
                VT_BOOL => Value::Bool(inner.Anonymous.boolVal.0 != 0),
                VT_BSTR => Value::String(inner.Anonymous.bstrVal.to_string()),
                VT_UI1 => Value::from(inner.Anonymous.bVal),
                VT_I2 => Value::from(inner.Anonymous.iVal),
                VT_UI2 => Value::from(inner.Anonymous.uiVal),
                VT_I4 => Value::from(inner.Anonymous.lVal),
                VT_UI4 => Value::from(inner.Anonymous.ulVal),
                VT_I8 => Value::from(inner.Anonymous.llVal),
                VT_UI8 => Value::from(inner.Anonymous.ullVal),
                _ => Value::Null,
            }
        };
        // SAFETY: releases the BSTR/array owned by the variant.
        let _ = unsafe { VariantClear(&mut variant) };
        Ok(value)
    }

    fn timestamp(value: Value) -> Value {
        value
            .as_str()
            .and_then(cim_datetime_to_rfc3339)
            .map_or(Value::Null, Value::String)
    }

    pub(super) fn status() -> io::Result<Value> {
        let _com = ComScope::enter(COINIT_MULTITHREADED)?;
        let services = connect()?;
        let statuses = query(
            &services,
            "SELECT AntivirusEnabled, RealTimeProtectionEnabled, BehaviorMonitorEnabled, \
             IsTamperProtected, AntivirusSignatureVersion, QuickScanStartTime, FullScanStartTime \
             FROM MSFT_MpComputerStatus",
        )?;
        let status = next(&statuses)?.ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                "MSFT_MpComputerStatus returned no instance",
            )
        })?;
        // Counting the threat catalogue is best effort: some policies hide it from non-admins.
        let threat_count =
            query(&services, "SELECT ThreatID FROM MSFT_MpThreat").and_then(|threats| {
                let mut count = 0u64;
                while next(&threats)?.is_some() {
                    count += 1;
                }
                Ok(count)
            });
        Ok(json!({
            "AntivirusEnabled": property(&status, "AntivirusEnabled")?,
            "RealTimeProtectionEnabled": property(&status, "RealTimeProtectionEnabled")?,
            "BehaviorMonitorEnabled": property(&status, "BehaviorMonitorEnabled")?,
            "TamperProtected": property(&status, "IsTamperProtected")?,
            "AntivirusSignatureVersion": property(&status, "AntivirusSignatureVersion")?,
            "LastQuickScanStartUtc": timestamp(property(&status, "QuickScanStartTime")?),
            "LastFullScanStartUtc": timestamp(property(&status, "FullScanStartTime")?),
            "ThreatCount": threat_count.ok(),
        }))
    }
}

#[cfg(not(windows))]
mod imp {
    use std::io;

    use serde_json::Value;

    pub(super) fn status() -> io::Result<Value> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Defender is Windows-only",
        ))
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(windows))]
    #[test]
    fn defender_is_unsupported_off_windows() {
        assert_eq!(
            super::get_defender_status()
                .expect_err("unsupported")
                .kind(),
            std::io::ErrorKind::Unsupported
        );
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires Windows Defender"]
    fn defender_status_reads_mp_computer_status() {
        let status = super::get_defender_status().expect("query MSFT_MpComputerStatus");
        for field in [
            "AntivirusEnabled",
            "RealTimeProtectionEnabled",
            "BehaviorMonitorEnabled",
        ] {
            assert!(status[field].is_boolean(), "{field}: {status}");
        }
        assert!(status["TamperProtected"].is_boolean(), "{status}");
        let version = status["AntivirusSignatureVersion"]
            .as_str()
            .expect("signature version");
        assert!(version.split('.').count() == 4, "{version}");
        for field in ["LastQuickScanStartUtc", "LastFullScanStartUtc"] {
            assert!(
                status[field].is_null()
                    || status[field]
                        .as_str()
                        .is_some_and(|value| value.ends_with('Z')),
                "{field}: {status}"
            );
        }
        assert!(
            status["ThreatCount"].is_null() || status["ThreatCount"].is_u64(),
            "{status}"
        );
    }
}
