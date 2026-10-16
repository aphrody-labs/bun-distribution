use std::collections::HashMap;
use std::env;
use std::io::{self, Write};
use std::process::ExitCode;
use std::time::Duration;

use artcraft_client::credentials::storyteller_credential_set::StorytellerCredentialSet;
use artcraft_client::endpoints::jobs::list_session_jobs::{list_session_jobs, States};
use artcraft_client::utils::api_host::ApiHost;
use artcraft_router::api::router_audio_model::RouterAudioModel;
use artcraft_router::api::router_image_model::RouterImageModel;
use artcraft_router::api::router_mesh_model::RouterMeshModel;
use artcraft_router::api::router_provider::RouterProvider;
use artcraft_router::api::router_splat_model::RouterSplatModel;
use artcraft_router::api::router_video_model::RouterVideoModel;
use artcraft_router::client::router_artcraft_client::RouterArtcraftClient;
use artcraft_router::client::router_client::RouterClient;
use artcraft_router::client::router_fal_client::RouterFalClient;
use artcraft_router::client::router_gmicloud_client::RouterGmiCloudClient;
use artcraft_router::client::router_grok_api_client::RouterGrokApiClient;
use artcraft_router::client::router_kinovi_web_client::RouterKinoviWebClient;
use artcraft_router::client::router_midjourney_client::RouterMidjourneyClient;
use artcraft_router::client::router_worldlabs_client::RouterWorldLabsClient;
use artcraft_router::generate::generate_audio::audio_generation_draft_context::AudioGenerationDraftContext;
use artcraft_router::generate::generate_audio::audio_generation_draft_or_request::AudioGenerationDraftOrRequest;
use artcraft_router::generate::generate_audio::generate_audio_request_builder::GenerateAudioRequestBuilder;
use artcraft_router::generate::generate_image::generate_image_request_builder::GenerateImageRequestBuilder;
use artcraft_router::generate::generate_image::image_generation_draft_context::ImageGenerationDraftContext;
use artcraft_router::generate::generate_image::image_generation_draft_or_request::ImageGenerationDraftOrRequest;
use artcraft_router::generate::generate_mesh::generate_mesh_request_builder::GenerateMeshRequestBuilder;
use artcraft_router::generate::generate_mesh::mesh_generation_draft_context::MeshGenerationDraftContext;
use artcraft_router::generate::generate_mesh::mesh_generation_draft_or_request::MeshGenerationDraftOrRequest;
use artcraft_router::generate::generate_splat::generate_splat_request_builder::GenerateSplatRequestBuilder;
use artcraft_router::generate::generate_splat::splat_generation_draft_context::SplatGenerationDraftContext;
use artcraft_router::generate::generate_splat::splat_generation_draft_or_request::SplatGenerationDraftOrRequest;
use artcraft_router::generate::generate_video::generate_video_request_builder::GenerateVideoRequestBuilder;
use artcraft_router::generate::generate_video::video_generation_draft_context::VideoGenerationDraftContext;
use artcraft_router::generate::generate_video::video_generation_draft_or_request::VideoGenerationDraftOrRequest;
use browser_emulation::browser_profile::BrowserProfile;
use gmicloud_client::creds::gmicloud_api_key::GmiCloudApiKey;
use grok_api_client::creds::grok_api_key::GrokApiKey;
use kinovi_web_client::creds::kinovi_web_session::KinoviWebSession;
use midjourney_client::credentials::midjourney_user_id::MidjourneyUserId;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use strum::IntoEnumIterator;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokens::tokens::characters::CharacterToken;
use tokens::tokens::media_files::MediaFileToken;

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_SESSION_BYTES: usize = 16 * MAX_REQUEST_BYTES;
const MAX_REPLY_BYTES: usize = 8 * MAX_REQUEST_BYTES;
const MAX_REQUESTS: usize = 1000;
const MAX_CREDENTIAL_BYTES: usize = 64 * 1024;
const METHODS: &[&str] = &["doctor", "commands", "models", "image.draft", "image.generate", "video.draft", "video.generate", "audio.draft", "audio.generate", "mesh.draft", "mesh.generate", "splat.draft", "splat.generate", "jobs.list"];
const HELP: &str = "Aphrody Generation / Bun\n\
  artcraft-cli --version\n\
  artcraft-cli doctor|commands|models\n\
  artcraft-cli run [--timeout-ms MS]\n\
JSONL: {\"id\":1,\"method\":\"image.draft\",\"params\":{...}}\n\
Drafts and discovery are offline. Generate and jobs.list use existing native clients.\n\
Credentials are injected through the selected provider's environment variables.\n";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
  #[serde(default)]
  id: Value,
  method: String,
  #[serde(default = "empty_params")]
  params: Value,
  #[serde(default)]
  context: RequestContext,
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestContext {
  #[serde(default)]
  media_files: HashMap<MediaFileToken, String>,
  #[serde(default)]
  characters: HashMap<CharacterToken, String>,
}

#[derive(Clone, Copy)]
struct CliError {
  code: &'static str,
}

struct LimitedWriter {
  bytes: Vec<u8>,
  maximum: usize,
}

type CliResult<T> = Result<T, CliError>;

macro_rules! generation_route {
  ($input:expr, $builder:ty, $plan:ident, $context:ty $(, $field:ident => $context_field:ident)* $(,)?) => {{
    let input = $input;
    let builder: $builder = serde_json::from_value(input.params).map_err(|_| failure("INVALID_PARAMS"))?;
    let provider = builder.provider;
    let planned = builder.build2().map_err(|_| failure("INVALID_GENERATION_PLAN"))?;
    if input.method.ends_with(".draft") {
      let cost = planned.estimate_cost().map_err(|_| failure("COST_UNAVAILABLE"))?;
      Ok(json!({"provider": provider, "requires_finalization": matches!(&planned, $plan::Draft(_)), "cost": bounded_value(&cost)?}))
    } else {
      let client = provider_client(provider)?;
      let request = match planned {
        $plan::Request(request) => request,
        $plan::Draft(draft) => {
          let mut context = <$context>::default();
          context.client = Some(&client);
          context.media_file_to_artcraft_url_map = Some(&input.context.media_files);
          $(context.$field = Some(&input.context.$context_field);)*
          draft.finalize(context).await.map_err(|_| failure("FINALIZATION_FAILED"))?
        },
      };
      let response = request.send_request(&client).await.map_err(|_| failure("PROVIDER_FAILED"))?;
      bounded_value(&response)
    }
  }};
}

fn main() -> ExitCode {
  // A native client panic must not print request or credential details to the protocol channel.
  std::panic::set_hook(Box::new(|_| log::error!("Generation operation panicked")));
  let arguments: Result<Vec<String>, _> = env::args_os().skip(1).map(|arg| arg.into_string()).collect();
  let Ok(arguments) = arguments else {
    return terminal_error("INVALID_ARGUMENTS", 2);
  };
  match arguments.as_slice() {
    [] => {
      return write_text(HELP).map_or(ExitCode::from(1), |_| ExitCode::SUCCESS);
    },
    [command] if command == "--help" || command == "-h" => {
      return write_text(HELP).map_or(ExitCode::from(1), |_| ExitCode::SUCCESS);
    },
    [command] if command == "--version" => {
      return write_text(concat!("artcraft-cli ", env!("CARGO_PKG_VERSION"), "\n")).map_or(ExitCode::from(1), |_| ExitCode::SUCCESS);
    },
    [command] if ["doctor", "commands", "models"].contains(&command.as_str()) => {
      return emit(json!({"id": null, "ok": true, "result": discovery(command)})).map_or(ExitCode::from(1), |_| ExitCode::SUCCESS);
    },
    _ => {},
  }
  let timeout_ms = match arguments.as_slice() {
    [command] if command == "run" => 30_000,
    [command, flag, value] if command == "run" && flag == "--timeout-ms" => {
      let Ok(value) = value.parse::<u64>() else {
        return terminal_error("INVALID_ARGUMENTS", 2);
      };
      if !(1..=3_600_000).contains(&value) {
        return terminal_error("INVALID_ARGUMENTS", 2);
      }
      value
    },
    _ => return terminal_error("INVALID_ARGUMENTS", 2),
  };
  let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
    Ok(runtime) => runtime,
    Err(_) => return terminal_error("RUNTIME_UNAVAILABLE", 1),
  };
  let result = runtime.block_on(serve(Duration::from_millis(timeout_ms)));
  // Tokio's blocking stdin reader cannot be cancelled while an idle pipe remains open.
  runtime.shutdown_timeout(Duration::from_millis(100));
  match result {
    Ok(success) => {
      if success {
        ExitCode::SUCCESS
      } else {
        ExitCode::from(1)
      }
    },
    Err(error) => terminal_error(error.code, 1),
  }
}

async fn serve(deadline: Duration) -> CliResult<bool> {
  let mut input = BufReader::new(tokio::io::stdin());
  let mut bytes = 0;
  let mut requests = 0;
  let mut success = true;
  while let Some(line) = tokio::time::timeout(deadline, read_line(&mut input, &mut bytes)).await.map_err(|_| failure("INPUT_TIMEOUT"))?? {
    if line.iter().all(u8::is_ascii_whitespace) {
      continue;
    }
    requests += 1;
    if requests > MAX_REQUESTS {
      return Err(failure("INPUT_LIMIT"));
    }
    let request: Request = match serde_json::from_slice(&line) {
      Ok(request) => request,
      Err(_) => {
        emit_error(Value::Null, "INVALID_REQUEST")?;
        success = false;
        continue;
      },
    };
    if !valid_id(&request.id) || request.method.len() > 64 || !request.params.is_object() {
      emit_error(Value::Null, "INVALID_REQUEST")?;
      success = false;
      continue;
    }
    let id = request.id.clone();
    let mut task = tokio::spawn(dispatch(request));
    let result = match tokio::time::timeout(deadline, &mut task).await {
      Ok(Ok(result)) => result,
      Ok(Err(_)) => Err(failure("OPERATION_FAILED")),
      Err(_) => {
        task.abort();
        let _ = task.await;
        Err(failure("OPERATION_TIMEOUT"))
      },
    };
    match result {
      Ok(result) => {
        if emit(json!({"id": id, "ok": true, "result": result})).is_err() {
          emit_error(id, "OUTPUT_LIMIT")?;
          success = false;
        }
      },
      Err(error) => {
        emit_error(id, error.code)?;
        success = false;
      },
    }
  }
  Ok(success)
}

async fn dispatch(request: Request) -> CliResult<Value> {
  match request.method.as_str() {
    "doctor" | "commands" | "models" => Ok(discovery(&request.method)),
    "image.draft" | "image.generate" => generation_route!(request, GenerateImageRequestBuilder, ImageGenerationDraftOrRequest, ImageGenerationDraftContext<'_>),
    "video.draft" | "video.generate" => generation_route!(request, GenerateVideoRequestBuilder,
      VideoGenerationDraftOrRequest, VideoGenerationDraftContext<'_>,
      character_token_to_kinovi_id_map => characters),
    "audio.draft" | "audio.generate" => generation_route!(request, GenerateAudioRequestBuilder, AudioGenerationDraftOrRequest, AudioGenerationDraftContext<'_>),
    "mesh.draft" | "mesh.generate" => generation_route!(request, GenerateMeshRequestBuilder, MeshGenerationDraftOrRequest, MeshGenerationDraftContext<'_>),
    "splat.draft" | "splat.generate" => generation_route!(request, GenerateSplatRequestBuilder, SplatGenerationDraftOrRequest, SplatGenerationDraftContext<'_>),
    "jobs.list" => {
      if request.params.as_object().is_none_or(|params| !params.is_empty()) {
        return Err(failure("INVALID_PARAMS"));
      }
      let (host, credentials) = first_party_credentials()?;
      let response = list_session_jobs(&host, Some(&credentials), States::All).await.map_err(|_| failure("PROVIDER_FAILED"))?;
      bounded_value(&response)
    },
    _ => Err(failure("UNKNOWN_METHOD")),
  }
}

fn discovery(command: &str) -> Value {
  match command {
    "models" => json!({
      "providers": RouterProvider::iter().collect::<Vec<_>>(),
      "image": RouterImageModel::iter().collect::<Vec<_>>(),
      "video": RouterVideoModel::iter().collect::<Vec<_>>(),
      "audio": RouterAudioModel::iter().collect::<Vec<_>>(),
      "mesh": RouterMeshModel::iter().collect::<Vec<_>>(),
      "splat": RouterSplatModel::iter().collect::<Vec<_>>()
    }),
    "commands" => json!(
      METHODS
        .iter()
        .map(|method| json!({
          "id": method, "remote": method.ends_with(".generate") || *method == "jobs.list",
        }))
        .collect::<Vec<_>>()
    ),
    _ => json!({"identity": "Aphrody / Bun", "version": env!("CARGO_PKG_VERSION"),
    "protocol": "jsonl", "methods": METHODS,
    "limits": {"request_bytes": MAX_REQUEST_BYTES, "session_bytes": MAX_SESSION_BYTES,
      "reply_bytes": MAX_REPLY_BYTES, "requests": MAX_REQUESTS},
    "credentials": {
      "artcraft": configured("APHRODY_GENERATION_COOKIES"),
      "fal": configured("FAL_API_KEY"), "gmi_cloud": configured("GMICLOUD_API_KEY"),
      "grok_api": configured("GROK_API_KEY"), "world_labs": configured("WORLDLABS_API_KEY"),
      "kinovi_web": configured("KINOVI_COOKIES"), "midjourney": configured("MIDJOURNEY_COOKIES")
    }}),
  }
}

fn provider_client(provider: RouterProvider) -> CliResult<RouterClient> {
  Ok(match provider {
    RouterProvider::Artcraft => {
      let (host, credentials) = first_party_credentials()?;
      RouterClient::Artcraft(RouterArtcraftClient::new(host, credentials))
    },
    RouterProvider::Fal => RouterClient::Fal(RouterFalClient::new_polling_only_from_raw_key(&credential("FAL_API_KEY")?)),
    RouterProvider::GmiCloud => RouterClient::GmiCloud(RouterGmiCloudClient::new(GmiCloudApiKey::new(credential("GMICLOUD_API_KEY")?))),
    RouterProvider::GrokApi => RouterClient::GrokApi(RouterGrokApiClient::new(GrokApiKey::new(credential("GROK_API_KEY")?))),
    RouterProvider::WorldLabs => RouterClient::WorldLabs(RouterWorldLabsClient::new_from_raw_key(&credential("WORLDLABS_API_KEY")?)),
    RouterProvider::KinoviWeb => RouterClient::KinoviWeb(RouterKinoviWebClient::new(KinoviWebSession::from_cookies_string(credential("KINOVI_COOKIES")?))),
    RouterProvider::Midjourney => RouterClient::Midjourney(RouterMidjourneyClient::new(credential("MIDJOURNEY_COOKIES")?, MidjourneyUserId::from_string(credential("MIDJOURNEY_USER_ID")?), BrowserProfile::matching_user_agent(credential("MIDJOURNEY_USER_AGENT")?))),
  })
}

fn first_party_credentials() -> CliResult<(ApiHost, StorytellerCredentialSet)> {
  let credentials = StorytellerCredentialSet::parse_multi_cookie_header(&credential("APHRODY_GENERATION_COOKIES")?).map_err(|_| failure("INVALID_CREDENTIALS"))?.ok_or_else(|| failure("INVALID_CREDENTIALS"))?;
  if credentials.is_empty() {
    return Err(failure("INVALID_CREDENTIALS"));
  }
  let host = match env::var("APHRODY_GENERATION_API_HOST").as_deref() {
    Err(env::VarError::NotPresent) | Ok("storyteller") => ApiHost::Storyteller,
    Ok("fakeyou") => ApiHost::FakeYou,
    Ok(host) if host.starts_with("localhost:") => {
      let port = host[10..].parse::<u32>().map_err(|_| failure("INVALID_CONFIGURATION"))?;
      if !(1..=65_535).contains(&port) {
        return Err(failure("INVALID_CONFIGURATION"));
      }
      ApiHost::Localhost { port }
    },
    _ => return Err(failure("INVALID_CONFIGURATION")),
  };
  Ok((host, credentials))
}

async fn read_line(input: &mut BufReader<tokio::io::Stdin>, total: &mut usize) -> CliResult<Option<Vec<u8>>> {
  let mut line = Vec::new();
  loop {
    let available = input.fill_buf().await.map_err(|_| failure("INPUT_FAILED"))?;
    if available.is_empty() {
      return Ok(if line.is_empty() { None } else { Some(line) });
    }
    let newline = available.iter().position(|byte| *byte == b'\n');
    let length = newline.map_or(available.len(), |index| index + 1);
    if length > MAX_REQUEST_BYTES.saturating_sub(line.len()) || length > MAX_SESSION_BYTES.saturating_sub(*total) {
      return Err(failure("INPUT_LIMIT"));
    }
    line.extend_from_slice(&available[..length]);
    *total += length;
    input.consume(length);
    if newline.is_some() {
      return Ok(Some(line));
    }
  }
}

impl Write for LimitedWriter {
  fn write(&mut self, input: &[u8]) -> io::Result<usize> {
    if input.len() > self.maximum.saturating_sub(self.bytes.len()) {
      return Err(io::Error::other("Protocol output limit exceeded"));
    }
    self.bytes.extend_from_slice(input);
    Ok(input.len())
  }
  fn flush(&mut self) -> io::Result<()> {
    Ok(())
  }
}

fn bounded_value<T: Serialize>(value: &T) -> CliResult<Value> {
  let mut writer = LimitedWriter { bytes: Vec::new(), maximum: MAX_REPLY_BYTES };
  serde_json::to_writer(&mut writer, value).map_err(|_| failure("OUTPUT_LIMIT"))?;
  serde_json::from_slice(&writer.bytes).map_err(|_| failure("OUTPUT_FAILED"))
}

fn emit(value: Value) -> CliResult<()> {
  let mut writer = LimitedWriter { bytes: Vec::new(), maximum: MAX_REPLY_BYTES - 1 };
  serde_json::to_writer(&mut writer, &value).map_err(|_| failure("OUTPUT_LIMIT"))?;
  writer.bytes.push(b'\n');
  let mut output = io::stdout().lock();
  output.write_all(&writer.bytes).and_then(|_| output.flush()).map_err(|_| failure("OUTPUT_FAILED"))
}

fn emit_error(id: Value, code: &'static str) -> CliResult<()> {
  emit(json!({"id": id, "ok": false, "error": {"code": code}}))
}

fn terminal_error(code: &'static str, exit: u8) -> ExitCode {
  let _ = emit_error(Value::Null, code);
  ExitCode::from(exit)
}

fn write_text(text: &str) -> io::Result<()> {
  let mut output = io::stdout().lock();
  output.write_all(text.as_bytes()).and_then(|_| output.flush())
}

fn credential(name: &str) -> CliResult<String> {
  let value = env::var(name).map_err(|_| failure("CREDENTIALS_MISSING"))?;
  if value.trim().is_empty() || value.len() > MAX_CREDENTIAL_BYTES {
    return Err(failure("INVALID_CREDENTIALS"));
  }
  Ok(value)
}

fn configured(name: &str) -> bool {
  env::var_os(name).is_some_and(|value| !value.is_empty())
}

fn valid_id(id: &Value) -> bool {
  matches!(id, Value::Null | Value::Number(_)) || id.as_str().is_some_and(|id| id.len() <= 128)
}

fn empty_params() -> Value {
  json!({})
}
fn failure(code: &'static str) -> CliError {
  CliError { code }
}
