// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/crates/file-opening-windows/src/lib.rs), adopted as the
// Aphrody Drive file explorer.
//! Windows: Shell association handlers (`SHAssocEnumHandlers`) list the recommended
//! applications for an extension; `IAssocHandler::Invoke` opens a file with one of them and
//! `ShellExecuteW("open")` with the default.

use std::{cell::Cell, path::Path};

use windows::{
    Win32::{
        System::Com::{
            COINIT_APARTMENTTHREADED, CoInitializeEx, CoTaskMemFree, IBindCtx, IDataObject,
        },
        UI::{
            Shell::{
                ASSOC_FILTER_RECOMMENDED, BHID_DataObject, IAssocHandler, IShellItem,
                SHAssocEnumHandlers, SHCreateItemFromParsingName, ShellExecuteW,
            },
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    },
    core::{HSTRING, PCWSTR, w},
};

use super::{FileOpener, OpenResult, OpenWithApp};

thread_local! {
    static COM_INITIALIZED: Cell<bool> = const { Cell::new(false) };
}

/// Initialize COM (single-threaded apartment) once per thread; the shell association APIs need it.
fn ensure_com_initialized() {
    COM_INITIALIZED.with(|initialized| {
        if !initialized.get() {
            // SAFETY: plain COM initialization of the calling thread; a repeated or
            // mode-mismatched call only returns an error code, which is ignored.
            let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            initialized.set(true);
        }
    });
}

/// `.ext` of a path, or `None` without an extension.
fn dotted_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| format!(".{extension}"))
}

/// The handler display name (the `CoTaskMem` string is freed).
fn handler_name(handler: &IAssocHandler) -> Result<String, String> {
    // SAFETY: GetName returns a CoTaskMem-allocated, NUL-terminated string owned by the caller.
    unsafe {
        let name = handler.GetName().map_err(|error| error.to_string())?;
        let text = name.to_string().map_err(|error| error.to_string());
        CoTaskMemFree(Some(name.0 as *const _));
        text
    }
}

/// Every recommended handler for `.ext`, in enumeration order.
fn handlers_for_extension(extension: &str) -> Result<Vec<IAssocHandler>, String> {
    // SAFETY: COM is initialized on this thread; the enumerator fills one slot per call.
    unsafe {
        let handlers = SHAssocEnumHandlers(&HSTRING::from(extension), ASSOC_FILTER_RECOMMENDED)
            .map_err(|error| error.to_string())?;
        let mut all = Vec::new();
        loop {
            let mut slot: [Option<IAssocHandler>; 1] = [None];
            let mut fetched = 0u32;
            if handlers.Next(&mut slot, Some(&mut fetched)).is_err() || fetched == 0 {
                break;
            }
            if let Some(handler) = slot[0].take() {
                all.push(handler);
            }
        }
        Ok(all)
    }
}

pub(super) struct WindowsFileOpener;

impl FileOpener for WindowsFileOpener {
    fn get_apps_for_file(&self, path: &Path) -> Result<Vec<OpenWithApp>, String> {
        ensure_com_initialized();
        let Some(extension) = dotted_extension(path) else { return Ok(Vec::new()) };
        let mut apps = Vec::new();
        for handler in handlers_for_extension(&extension)? {
            let name = handler_name(&handler)?;
            apps.push(OpenWithApp { id: name.clone(), name, icon: None });
        }
        apps.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(apps)
    }

    fn open_with_default(&self, path: &Path) -> Result<OpenResult, String> {
        ensure_com_initialized();
        if !path.exists() {
            return Ok(OpenResult::not_found(path));
        }
        let file = HSTRING::from(path.as_os_str());
        // SAFETY: every string argument is a valid NUL-terminated wide string for the call.
        let instance = unsafe {
            ShellExecuteW(None, w!("open"), &file, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
        };
        // ShellExecute returns a value greater than 32 on success.
        let code = instance.0 as isize;
        if code > 32 {
            Ok(OpenResult::Success)
        } else {
            Ok(OpenResult::PlatformError {
                message: format!("ShellExecute failed with code {code}"),
            })
        }
    }

    fn open_with_app(&self, path: &Path, app_id: &str) -> Result<OpenResult, String> {
        ensure_com_initialized();
        if !path.exists() {
            return Ok(OpenResult::not_found(path));
        }
        let Some(extension) = dotted_extension(path) else {
            return Ok(OpenResult::PlatformError { message: "File has no extension".to_string() });
        };
        for handler in handlers_for_extension(&extension)? {
            if handler_name(&handler)? != app_id {
                continue;
            }
            // SAFETY: COM is initialized; the shell item and data object live for the call.
            unsafe {
                let item: IShellItem = SHCreateItemFromParsingName(
                    &HSTRING::from(path.as_os_str()),
                    None::<&IBindCtx>,
                )
                .map_err(|error| error.to_string())?;
                let data: IDataObject = item
                    .BindToHandler(None::<&IBindCtx>, &BHID_DataObject)
                    .map_err(|error| error.to_string())?;
                handler.Invoke(&data).map_err(|error| error.to_string())?;
            }
            return Ok(OpenResult::Success);
        }
        Ok(OpenResult::AppNotFound { app_id: app_id.to_string() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_are_dotted() {
        assert_eq!(dotted_extension(Path::new(r"C:\a\b.txt")), Some(".txt".into()));
        assert_eq!(dotted_extension(Path::new(r"C:\a\Makefile")), None);
    }

    #[test]
    fn text_files_have_handlers_and_missing_files_are_reported() {
        let opener = WindowsFileOpener;
        // Every Windows install associates .txt (Notepad); the list must at least be readable.
        assert!(opener.get_apps_for_file(Path::new("x.txt")).is_ok());
        assert!(opener.get_apps_for_file(Path::new("noextension")).unwrap().is_empty());
        let missing = Path::new(r"C:\definitely\missing\file.txt");
        assert_eq!(opener.open_with_default(missing).unwrap(), OpenResult::not_found(missing));
        assert_eq!(
            opener.open_with_app(missing, "Notepad").unwrap(),
            OpenResult::not_found(missing)
        );
    }
}
