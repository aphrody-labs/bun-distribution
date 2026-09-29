use std::path::PathBuf;

use aphrody_google::{GoogleProject, GoogleRuntime};
use clap::{Parser, Subcommand};
use serde::Serialize;

#[derive(Debug, Parser)]
#[command(name = "aphrody-google", about = "Unified Aphrody Google/Gemini runtime")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Print the resolved public runtime contract as JSON.
    Status,
    /// Print shell exports for the shared non-secret runtime contract.
    Env,
    /// Validate the resolved project mapping and required local roots.
    Doctor,
    /// Sign in to Google with the existing PKCE flow and save credentials securely.
    Login,
    /// Report whether Google AI credentials are available, without printing them.
    AuthStatus,
    /// Print the signed-in Google account profile (email and name only).
    Whoami,
    /// List Gemini models available to the authenticated account as JSON.
    Models,
    /// Generate one Gemini response with the authenticated Antigravity account.
    Generate {
        /// Model identifier, for example gemini-2.5-flash.
        #[arg(long, default_value = "gemini-2.5-flash")]
        model: String,
        /// User prompt.
        #[arg(long)]
        prompt: String,
    },
    /// Stream one Gemini response from stdin as plain text chunks.
    GenerateStream {
        /// Model identifier.
        #[arg(long, default_value = "gemini-2.5-flash")]
        model: String,
    },
}

#[derive(Debug, Serialize)]
struct StatusReport {
    provider: &'static str,
    project: &'static str,
    project_kind: &'static str,
    location: String,
    home: String,
    auth: String,
    capabilities: [&'static str; 6],
}

fn report(runtime: &GoogleRuntime) -> StatusReport {
    StatusReport {
        provider: "aphrody-google",
        project: runtime.project.id(),
        project_kind: match runtime.project {
            GoogleProject::Aphrody => "aphrody",
            GoogleProject::Rgfr => "rgfr",
        },
        location: runtime.location.clone(),
        home: runtime.home.clone(),
        auth: runtime.auth.clone(),
        capabilities: ["vertex", "gemini-oauth", "gemini-web", "google-web", "mcp", "bxc"],
    }
}

fn resolved_home(runtime: &GoogleRuntime) -> Option<PathBuf> {
    if let Some(relative) = runtime.home.strip_prefix("~/") {
        return Some(
            PathBuf::from(std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?)
                .join(relative),
        );
    }
    Some(PathBuf::from(&runtime.home))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    rustls::crypto::ring::default_provider().install_default().ok();
    let cli = Cli::parse();
    let runtime = GoogleRuntime::from_env();
    match cli.command.unwrap_or(Command::Status) {
        Command::Status => {
            println!("{}", serde_json::to_string_pretty(&report(&runtime)).expect("serializable"))
        },
        Command::Env => {
            println!("export GOOGLE_CLOUD_PROJECT={}", runtime.project.id());
            println!("export GOOGLE_CLOUD_LOCATION={}", runtime.location);
            println!("export APHRODY_HOME={}", runtime.home);
            println!("export APHRODY_GCP_AUTH={}", runtime.auth);
        },
        Command::Doctor => {
            assert!(!runtime.location.is_empty(), "Google location is empty");
            assert!(!runtime.home.is_empty(), "Aphrody home is empty");
            let home = resolved_home(&runtime).expect("home directory is not resolvable");
            assert!(home.is_dir(), "Aphrody home does not exist: {}", home.display());
            println!("APHRODY_GOOGLE_DOCTOR=PASS");
            println!("project={}", runtime.project.id());
            println!("home={}", home.display());
            println!("capabilities=vertex,gemini-oauth,gemini-web,google-web,mcp,bxc");
        },
        Command::Login => {
            let token = aphrody_google::antigravity::login().await?;
            aphrody_google::antigravity::persist(&token)?;
            println!("APHRODY_GOOGLE_LOGIN=PASS");
        },
        Command::AuthStatus => match aphrody_google::antigravity::token_from_credential_manager() {
            Ok(_) => println!("APHRODY_GOOGLE_AUTH=AVAILABLE"),
            Err(error) => {
                println!("APHRODY_GOOGLE_AUTH=UNAVAILABLE");
                eprintln!("{error}");
                std::process::exit(1);
            },
        },
        Command::Whoami => {
            let client = aphrody_google::authenticated_client()?;
            let user = client.userinfo().await?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "name": user.get("name"),
                    "email": user.get("email"),
                    "picture": user.get("picture"),
                }))?
            );
        },
        Command::Models => {
            let client = aphrody_google::authenticated_client()?;
            let models = client
                .fetch_available_models_typed(
                    &aphrody_google::antigravity::FetchAvailableModelsRequest::default(),
                )
                .await?;
            println!("{}", serde_json::to_string_pretty(&models)?);
        },
        Command::Generate { model, prompt } => {
            let client = aphrody_google::authenticated_client()?;
            let request = aphrody_google::antigravity::GenerateContentRequest::from_prompt(prompt);
            let response = client
                .generate_content_vertex(&model, runtime.project.id(), &runtime.location, &request)
                .await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        },
        Command::GenerateStream { model } => {
            use futures::StreamExt as _;
            use std::io::Read as _;

            let mut prompt = String::new();
            std::io::stdin().read_to_string(&mut prompt)?;
            rustls::crypto::ring::default_provider().install_default().ok();
            let client = aphrody_google::authenticated_client()?;
            let request = aphrody_google::antigravity::GenerateContentRequest::from_prompt(prompt);
            let project = client
                .resolve_cloudcode_project()
                .await?
                .unwrap_or_else(|| runtime.project.id().to_owned());
            let stream = client
                .stream_generate_content_cloud_code(
                    aphrody_google::antigravity::CloudCodeEndpoint::Daily,
                    &model,
                    &project,
                    &request,
                )
                .await?;
            futures::pin_mut!(stream);
            while let Some(chunk) = stream.next().await {
                if let Some(text) = chunk?.first_text() {
                    print!("{text}");
                    use std::io::Write as _;
                    std::io::stdout().flush()?;
                }
            }
        },
    }
    Ok(())
}
