// SPDX-License-Identifier: Apache-2.0
//! Transient Win32 notification compatibility.

use crate::dispatch::string_arg;
use crate::SubsystemError;
use serde_json::Value;

/// Show the frozen transient Win32 balloon contract.
///
/// This deliberately uses `Shell_NotifyIconW` rather than WinRT toast APIs:
/// the latter need a packaged AUMID/COM projection and are not the contract
/// exposed by the existing WinClean tool.  The zero-window tray icon matches
/// the oracle's fire-and-forget behaviour on Windows 10/11.
pub(crate) fn send_notification(arguments: &Value) -> Result<Value, SubsystemError> {
    let title = string_arg(arguments, "title", "send_notification")?;
    let message = string_arg(arguments, "message", "send_notification")?;
    #[cfg(windows)]
    {
        #[repr(C)]
        struct NotifyIconDataW {
            cb_size: u32,
            hwnd: *mut std::ffi::c_void,
            uid: u32,
            flags: u32,
            callback_message: u32,
            hicon: *mut std::ffi::c_void,
            tip: [u16; 128],
            state: u32,
            state_mask: u32,
            info: [u16; 256],
            version: u32,
            info_title: [u16; 64],
            info_flags: u32,
            guid_item: [u8; 16],
            balloon_icon: *mut std::ffi::c_void,
        }

        unsafe extern "system" {
            fn Shell_NotifyIconW(message: u32, data: *mut NotifyIconDataW) -> i32;
            fn LoadIconW(
                instance: *mut std::ffi::c_void,
                name: *const u16,
            ) -> *mut std::ffi::c_void;
        }

        fn copy_z(source: &str, target: &mut [u16]) {
            let limit = target.len().saturating_sub(1);
            for (slot, value) in target.iter_mut().zip(source.encode_utf16().take(limit)) {
                *slot = value;
            }
        }

        const NIF_MESSAGE: u32 = 0x01;
        const NIF_ICON: u32 = 0x02;
        const NIF_TIP: u32 = 0x04;
        const NIF_INFO: u32 = 0x10;
        const NIM_ADD: u32 = 0x00;
        const NIM_MODIFY: u32 = 0x01;
        const NIM_DELETE: u32 = 0x02;
        const NIIF_INFO: u32 = 0x01;

        // IDI_INFORMATION is the shared system information icon (32516).
        let icon = unsafe { LoadIconW(std::ptr::null_mut(), 32516usize as *const u16) };
        let mut data = NotifyIconDataW {
            cb_size: std::mem::size_of::<NotifyIconDataW>() as u32,
            hwnd: std::ptr::null_mut(),
            uid: (std::process::id()
                ^ (std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .subsec_millis())) as u32,
            flags: NIF_ICON | NIF_TIP | NIF_INFO | NIF_MESSAGE,
            callback_message: 0,
            hicon: icon,
            tip: [0; 128],
            state: 0,
            state_mask: 0,
            info: [0; 256],
            version: 0,
            info_title: [0; 64],
            info_flags: NIIF_INFO,
            guid_item: [0; 16],
            balloon_icon: std::ptr::null_mut(),
        };
        copy_z(title, &mut data.tip);
        copy_z(message, &mut data.info);
        copy_z(title, &mut data.info_title);
        unsafe {
            // These compatibility calls are fire-and-forget.
            let _ = Shell_NotifyIconW(NIM_ADD, &mut data);
            let _ = Shell_NotifyIconW(NIM_MODIFY, &mut data);
            std::thread::sleep(std::time::Duration::from_millis(150));
            let _ = Shell_NotifyIconW(NIM_DELETE, &mut data);
        }
        Ok(Value::String(format!("Notification dispatched: '{title}'.")))
    }
    #[cfg(not(windows))]
    {
        let _ = (title, message);
        Err(SubsystemError::Failed("notifications are Windows-only".into()))
    }
}
