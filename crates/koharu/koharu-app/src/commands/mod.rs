pub(crate) mod agent;
pub(crate) mod canvas;
pub(crate) mod editing;
pub(crate) mod fonts;
pub(crate) mod lifecycle;
pub(crate) mod output;
pub(crate) mod preferences;
pub(crate) mod processing;
pub(crate) mod project;

use parking_lot::Mutex;
use serde::Serialize;
use specta::Type;
use tauri::ipc::{Channel, IpcResponse};

#[derive(Debug, Type)]
#[specta(transparent)]
pub(crate) struct Error(#[specta(type = String)] anyhow::Error);

impl<E> From<E> for Error
where
    E: Into<anyhow::Error>,
{
    fn from(error: E) -> Self {
        Self(error.into())
    }
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&format!("{:#}", self.0))
    }
}

pub(crate) trait ChannelExt<T> {
    fn publish(&self, value: T);
}

impl<T: IpcResponse> ChannelExt<T> for Mutex<Option<Channel<T>>> {
    fn publish(&self, value: T) {
        let mut channel = self.lock();
        if channel
            .as_ref()
            .is_some_and(|channel| channel.send(value).is_err())
        {
            channel.take();
        }
    }
}

/// Defines the Koharu command list once: [`COMMAND_NAMES`], the [`bindings`] a host app
/// (the Aphrody desktop app, dynamic runtime) mounts, and the standalone app's CEF bindings.
/// Commands generic over the Tauri runtime carry an `<Rt>` marker, resolved to each builder's
/// local `Rt` alias (specta needs a concrete runtime).
macro_rules! koharu_commands {
    ($($module:ident :: $command:ident $(<$runtime:ident>)?),* $(,)?) => {
        /// Names of every Koharu IPC command, in registration order.
        pub const COMMAND_NAMES: &[&str] = &[$(stringify!($command)),*];

        /// tauri-specta builder for every Koharu IPC command on a host app's dynamic runtime.
        pub fn bindings() -> tauri_specta::Builder<tauri::DynRuntime> {
            use tauri_specta::{Builder, ErrorHandlingMode, collect_commands};
            type Rt = tauri::DynRuntime;
            Builder::new()
                .commands(collect_commands![$($module::$command $(::<$runtime>)?),*])
                .disable_serde_phases()
                .error_handling(ErrorHandlingMode::Throw)
        }

        /// tauri-specta builder for every Koharu IPC command on the CEF runtime.
        #[cfg(feature = "cef")]
        pub fn cef_bindings() -> tauri_specta::Builder<tauri_runtime_cef::CefRuntime> {
            use tauri_specta::{Builder, ErrorHandlingMode, collect_commands};
            type Rt = tauri_runtime_cef::CefRuntime;
            Builder::new()
                .commands(collect_commands![$($module::$command $(::<$runtime>)?),*])
                .disable_serde_phases()
                .error_handling(ErrorHandlingMode::Throw)
        }
    };
}

koharu_commands![
            agent::get_agent_status<Rt>,
            agent::login_agent<Rt>,
            agent::logout_agent<Rt>,
            agent::save_agent_config<Rt>,
            agent::run_agent<Rt>,
            agent::cancel_agent<Rt>,
            lifecycle::subscribe<Rt>,
            lifecycle::get_project,
            lifecycle::get_pages,
            lifecycle::get_page,
            lifecycle::list_projects,
            lifecycle::create_project<Rt>,
            lifecycle::open_project<Rt>,
            lifecycle::delete_project<Rt>,
            lifecycle::close_project<Rt>,
            lifecycle::import<Rt>,
            lifecycle::select_page,
            editing::rename_page,
            editing::delete_pages,
            editing::move_page,
            editing::set_source_text,
            editing::set_translation,
            editing::set_typography,
            editing::set_geometry,
            editing::set_visibility,
            editing::delete_layers,
            editing::move_layer,
            editing::undo,
            editing::redo,
            processing::process<Rt>,
            processing::stop_job,
            output::export<Rt>,
            output::get_thumbnail,
            fonts::get_fonts,
            fonts::get_font_preview,
            preferences::save_preferences,
            preferences::get_preferences,
            preferences::get_translation_models,
            canvas::get_canvas_manifest,
            canvas::get_canvas_resource,
            canvas::prepare_canvas_page,
            canvas::get_canvas_page_manifest,
            canvas::get_canvas_page_resource,
            canvas::add_point_text,
            canvas::add_text_box,
            canvas::commit_paint,
            canvas::commit_erase,
            canvas::commit_transform,
            canvas::commit_inpaint<Rt>,
];
