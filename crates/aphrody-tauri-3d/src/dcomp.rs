// SPDX-License-Identifier: Apache-2.0
//! DirectComposition host for a Tauri window (Windows).
//!
//! A DComp target is bound to the window's `HWND` *below* its child windows
//! (`topmost = false`), so the WebView2 child that Tauri hosts is composited
//! on top of our visual. The visual receives the wgpu DX12 swapchain
//! (`SurfaceTargetUnsafe::CompositionVisual`), which — unlike an `HWND`
//! swapchain — supports `CompositeAlphaMode::PreMultiplied`: pixels the 3D
//! scene leaves transparent show the desktop through a transparent window.

use std::ffi::c_void;

use windows::{
    Win32::{
        Foundation::HWND,
        Graphics::{
            DirectComposition::{
                DCompositionCreateDevice, IDCompositionDevice, IDCompositionTarget,
                IDCompositionVisual,
            },
            Dxgi::IDXGIDevice,
        },
    },
    core::Interface,
};

/// The DirectComposition device, target and root visual of one window.
pub(crate) struct Composition {
    device: IDCompositionDevice,
    _target: IDCompositionTarget,
    visual: IDCompositionVisual,
}

// SAFETY: DirectComposition device objects are free-threaded: every call on
// the device, target and visual is serialised by DComp itself, and the
// plugin additionally only touches a `Composition` under the layers mutex.
unsafe impl Send for Composition {}
// SAFETY: see `Send`; shared references never mutate without the mutex.
unsafe impl Sync for Composition {}

impl Composition {
    /// Create a DComp device, bind a target under the children of `hwnd`
    /// and set a fresh visual as its root.
    pub(crate) fn new(hwnd: isize) -> windows::core::Result<Self> {
        // SAFETY: `hwnd` is the live top-level window handle Tauri reported;
        // the COM objects are created and owned here and released on drop.
        unsafe {
            let device: IDCompositionDevice = DCompositionCreateDevice(None::<&IDXGIDevice>)?;
            let target = device.CreateTargetForHwnd(HWND(hwnd as *mut c_void), false)?;
            let visual = device.CreateVisual()?;
            target.SetRoot(&visual)?;
            device.Commit()?;
            Ok(Self { device, _target: target, visual })
        }
    }

    /// The `IDCompositionVisual*` wgpu presents into.
    pub(crate) fn visual_ptr(&self) -> *mut c_void {
        self.visual.as_raw()
    }

    /// Commit pending visual-tree changes (after wgpu set the content).
    pub(crate) fn commit(&self) {
        // SAFETY: plain COM call on a live device.
        if let Err(error) = unsafe { self.device.Commit() } {
            log::warn!("DirectComposition commit failed: {error}");
        }
    }
}
