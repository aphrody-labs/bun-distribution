// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// Screenshot input.
//
// Behind a feature because `aphrody-capture` only has a real implementation on
// Windows: everywhere else its whole surface returns `Unsupported`. Making it a
// mandatory dependency would force a Linux consumer of `caption`, whose images
// come from disk, to link a crate that can do nothing for it.
//
// The capture is written to a temporary file rather than piped: llama.cpp's
// multimodal CLI takes `--image <path>`, and it is the process boundary
// (CLAUDE.md 7: llama.cpp is driven, not linked) that makes a file the cheapest
// honest interchange. The file is deleted when the guard drops.

use std::path::Path;

use crate::{
    Result, VisionError,
    describe::{Describer, VisionOptions, VisionReport},
};

/// A captured screenshot on disk, deleted when dropped.
pub struct Screenshot {
    file: tempfile::NamedTempFile,
}

impl Screenshot {
    /// The PNG path, valid for as long as this value lives.
    #[must_use]
    pub fn path(&self) -> &Path {
        self.file.path()
    }

    /// Persist the capture to `destination` instead of deleting it.
    ///
    /// # Errors
    ///
    /// [`VisionError::Io`] when the file cannot be moved.
    pub fn keep(self, destination: &Path) -> Result<()> {
        self.file.persist(destination).map(|_| ()).map_err(|error| VisionError::Io {
            path: destination.to_path_buf(),
            source: error.error,
        })
    }
}

/// Capture the primary monitor to a temporary PNG.
///
/// # Errors
///
/// [`VisionError::Capture`] on a platform without a capture backend, or when
/// the platform call fails; [`VisionError::Io`] when the file cannot be written.
pub fn capture_screen() -> Result<Screenshot> {
    write_png(&aphrody_capture::capture_primary_screen()?)
}

/// Capture the first visible window whose title contains `substr`.
///
/// # Errors
///
/// As [`capture_screen`], plus [`VisionError::Capture`] when no window matches.
pub fn capture_window(substr: &str) -> Result<Screenshot> {
    write_png(&aphrody_capture::capture_window_by_title(substr)?)
}

/// Titles of the visible top-level windows, in Z-order.
///
/// Exposed so a caller can pick a target before capturing rather than guess a
/// substring and get `NotFound`.
#[must_use]
pub fn window_titles() -> Vec<String> {
    aphrody_capture::list_windows().into_iter().map(|window| window.title).collect()
}

/// Describe what is on screen right now.
///
/// # Errors
///
/// As [`capture_screen`] and [`Describer::new`].
pub fn describe_screen(options: VisionOptions) -> Result<VisionReport> {
    // The describer is built *before* the capture: resolving a model can fail
    // on a missing pull, and failing after taking a screenshot would leave the
    // caller paying for a capture that was never looked at.
    let describer = Describer::new(options)?;
    let shot = capture_screen()?;
    describer.describe(shot.path())
}

/// Describe a window, matched by a substring of its title.
///
/// # Errors
///
/// As [`describe_screen`].
pub fn describe_window(substr: &str, options: VisionOptions) -> Result<VisionReport> {
    let describer = Describer::new(options)?;
    let shot = capture_window(substr)?;
    describer.describe(shot.path())
}

/// Write PNG bytes to a temporary file with a `.png` extension.
///
/// The extension is not cosmetic: image loaders downstream sniff it, and a
/// suffixless temp file has been enough to make a model refuse an image.
fn write_png(bytes: &[u8]) -> Result<Screenshot> {
    let mut file = tempfile::Builder::new()
        .prefix("aphrody-vision-")
        .suffix(".png")
        .tempfile()
        .map_err(|source| VisionError::Io { path: std::env::temp_dir(), source })?;
    std::io::Write::write_all(&mut file, bytes)
        .and_then(|()| std::io::Write::flush(&mut file))
        .map_err(|source| VisionError::Io { path: file.path().to_path_buf(), source })?;
    Ok(Screenshot { file })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_capture_lands_in_a_png_named_file() {
        let shot = write_png(b"\x89PNG\r\n\x1a\n").unwrap();
        assert_eq!(shot.path().extension().unwrap(), "png");
        assert_eq!(std::fs::read(shot.path()).unwrap(), b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn the_temporary_capture_is_gone_once_dropped() {
        let path = {
            let shot = write_png(&[0_u8; 16]).unwrap();
            shot.path().to_path_buf()
        };
        assert!(!path.exists(), "{}", path.display());
    }

    #[test]
    fn keeping_a_capture_moves_it_out_of_the_temporary_directory() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("screen.png");
        write_png(&[1_u8, 2, 3]).unwrap().keep(&target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), vec![1_u8, 2, 3]);
    }

    #[test]
    #[cfg(not(windows))]
    fn capture_is_refused_rather_than_faked_off_windows() {
        assert!(matches!(capture_screen(), Err(VisionError::Capture(_))));
    }

    #[test]
    #[cfg(windows)]
    fn window_titles_are_enumerable_on_windows() {
        // A desktop session always has at least one titled window; a headless
        // CI runner may not, so this only asserts the call does not panic.
        let _titles = window_titles();
    }
}
