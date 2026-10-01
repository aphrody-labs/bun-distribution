// SPDX-License-Identifier: Apache-2.0
//! Moteur unifié de traduction aphrody — combine Aphrody Web Google Translate et le système Shenron
//! JP -> FR.
//!
//! Trois étages de backend :
//!   - `Backend::WebGoogle` -> Moteur Google Translate multi-tier via un adaptateur Web explicite
//!     (RPC / Web / TTS)
//!   - `Backend::GoogleRpc` -> Google Translate RPC natif direct (`translate_a/single`, sans clé,
//!     haute disponibilité)
//!   - `Backend::MyMemory`  -> API MyMemory historique (repli)
//!
//! Intégration Shenron :
//!   - Détection d'incohérence amont (`intraduisible`)
//!   - Découpage naturel (`segments_traduisibles`)
//!   - Masquage des entités du domaine (`proteger_termes` via jetons Zeta, Yuni, Kilo...)
//!   - Traduction du contexte préservé
//!   - Réinjection de la terminologie canonique officielle (`restaurer_termes`)
//!   - Contrôle qualité de sortie (`refus`) et finition de style Aphrody (`aphrodify`)

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context as _, Result};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(not(target_arch = "wasm32"))] use tracing::warn;

use crate::{
    aphrodify,
    shenron::{self, TermeLexique, default_canon_lexique},
};

/// Backend de traduction sélectionné.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Backend {
    /// Cascade automatique : WebGoogle (si disponible) -> GoogleRpc -> MyMemory.
    #[default]
    Auto,
    /// Binaire Aphrody Web (Google Translate multi-tier avec anti-bot et rotation).
    WebGoogle,
    /// Google Translate RPC public direct (GTX endpoint).
    GoogleRpc,
    /// MyMemory Translated API.
    MyMemory,
}

impl Backend {
    pub fn from_str_loose(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "web" | "web-google" | "web_google" => Self::WebGoogle,
            "google" | "google-rpc" | "rpc" | "gtx" => Self::GoogleRpc,
            "mymemory" | "memory" => Self::MyMemory,
            _ => Self::Auto,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
const MYMEMORY_ENDPOINT: &str = "https://api.mymemory.translated.net/get";

#[cfg(not(target_arch = "wasm32"))]
const GOOGLE_RPC_ENDPOINT: &str = "https://translate.googleapis.com/translate_a/single";

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Deserialize)]
struct MyMemoryResponse {
    #[serde(rename = "responseData")]
    response_data: MyMemoryData,
    #[serde(rename = "responseStatus")]
    response_status: u32,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Deserialize)]
struct MyMemoryData {
    #[serde(rename = "translatedText")]
    translated_text: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CacheFile {
    pub entries: std::collections::BTreeMap<String, String>,
}

/// Moteur de traduction unifié.
pub struct Translator {
    backend: Backend,
    lexique: Vec<TermeLexique>,
    #[cfg(not(target_arch = "wasm32"))]
    client: reqwest::Client,
    cache: Arc<DashMap<String, String>>,
    #[cfg(not(target_arch = "wasm32"))]
    cache_path: PathBuf,
    #[cfg(not(target_arch = "wasm32"))]
    contact_email: Option<String>,
}

impl Translator {
    /// Construit un `Translator` avec le cache persistant par défaut.
    pub fn new(cache_path: PathBuf, contact_email: Option<String>) -> Result<Self> {
        let cache: Arc<DashMap<String, String>> = Arc::new(DashMap::new());
        let lexique = default_canon_lexique();

        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = rustls::crypto::ring::default_provider().install_default();

            let client = reqwest::Client::builder()
                .user_agent("aphrody-translate/2.0 (Google+Shenron engine)")
                .timeout(std::time::Duration::from_secs(15))
                .build()?;

            if cache_path.exists() {
                let raw = std::fs::read_to_string(&cache_path)
                    .with_context(|| format!("read cache {:?}", cache_path))?;
                let file: CacheFile = serde_json::from_str(&raw).unwrap_or_default();
                for (k, v) in file.entries {
                    cache.insert(k, v);
                }
            }

            Ok(Self {
                backend: Backend::Auto,
                lexique,
                client,
                cache,
                cache_path,
                contact_email,
            })
        }

        #[cfg(target_arch = "wasm32")]
        {
            let _ = cache_path;
            let _ = contact_email;
            Ok(Self { backend: Backend::Auto, lexique, cache })
        }
    }

    /// Définit le backend actif.
    pub fn with_backend(mut self, backend: Backend) -> Self {
        self.backend = backend;
        self
    }

    /// Ajoute ou remplace le lexique canonique Shenron.
    pub fn with_lexique(mut self, lexique: Vec<TermeLexique>) -> Self {
        self.lexique = lexique;
        self
    }

    /// Accès en lecture au lexique canonique.
    pub fn lexique(&self) -> &[TermeLexique] {
        &self.lexique
    }

    fn cache_key(source: &str, target: &str, text: &str) -> String {
        let mut h = Sha256::new();
        h.update(source.as_bytes());
        h.update(b":");
        h.update(target.as_bytes());
        h.update(b":");
        h.update(text.as_bytes());
        hex::encode(h.finalize())
    }

    /// Détecte si le texte contient des caractères japonais (Kanji, Hiragana, Katakana).
    pub fn is_japanese(text: &str) -> bool {
        text.chars().any(|c| {
            matches!(c,
                '\u{3040}'..='\u{309F}' | // Hiragana
                '\u{30A0}'..='\u{30FF}' | // Katakana
                '\u{4E00}'..='\u{9FAF}'   // CJK Unified Ideographs
            )
        })
    }

    /// Traduit un texte vers le français.
    /// Si le texte contient du japonais, route automatiquement vers la chaîne de souveraineté
    /// Shenron JP -> FR avec protection du domaine et contrôle qualité.
    pub async fn translate(&self, text: &str) -> Result<String> {
        let stripped = text.trim();
        if stripped.is_empty() {
            return Ok(String::new());
        }

        if Self::is_japanese(stripped) {
            self.translate_jp_to_fr(stripped).await
        } else {
            self.translate_with_lang(stripped, "en", "fr").await
        }
    }

    /// Traduit un texte en spécifiant la langue source et cible.
    pub async fn translate_with_lang(
        &self,
        text: &str,
        source: &str,
        target: &str,
    ) -> Result<String> {
        let stripped = text.trim();
        if stripped.is_empty() {
            return Ok(String::new());
        }

        // Vérification en cache mémoire
        let key = Self::cache_key(source, target, stripped);
        if let Some(hit) = self.cache.get(&key) {
            return Ok(hit.clone());
        }

        #[cfg(target_arch = "wasm32")]
        {
            return Ok(stripped.to_string());
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let res = match self.backend {
                Backend::WebGoogle => {
                    match self.translate_web_google(stripped, source, target).await {
                        Ok(tr) => Ok(tr),
                        Err(_) => self.translate_google_rpc(stripped, source, target).await,
                    }
                },
                Backend::GoogleRpc => self.translate_google_rpc(stripped, source, target).await,
                Backend::MyMemory => self.translate_mymemory(stripped, source, target).await,
                Backend::Auto => {
                    // 1. Tente Aphrody Web Google Translate
                    match self.translate_web_google(stripped, source, target).await {
                        Ok(tr) if !tr.trim().is_empty() => Ok(tr),
                        _ => {
                            // 2. Repli immédiat sur Google RPC natif
                            match self.translate_google_rpc(stripped, source, target).await {
                                Ok(tr) if !tr.trim().is_empty() => Ok(tr),
                                _ => {
                                    // 3. Repli ultime MyMemory
                                    self.translate_mymemory(stripped, source, target).await
                                },
                            }
                        },
                    }
                },
            };

            match res {
                Ok(translated) => {
                    let final_res = translated.trim().to_string();
                    if !final_res.is_empty() {
                        self.cache.insert(key, final_res.clone());
                    }
                    Ok(final_res)
                },
                Err(e) => {
                    warn!(error = %e, "échec cascade traduction, conservation texte original");
                    Ok(stripped.to_string())
                },
            }
        }
    }

    /// Chaîne de traduction souveraine Japonais -> Français combinant Shenron + Aphrody Web Google.
    pub async fn translate_jp_to_fr(&self, text: &str) -> Result<String> {
        let stripped = text.trim();
        if stripped.is_empty() {
            return Ok(String::new());
        }

        // Étape 1 : Détection d'anomalie structurelle en amont (règle Shenron intraduisible)
        if let Some(motif) = shenron::intraduisible(stripped) {
            warn!(motif = %motif, "texte japonais jugé intraduisible par Shenron");
            // Ne pas traduire un texte corrompu pour éviter le blanchiment d'hallucinations
            return Ok(stripped.to_string());
        }

        // Étape 2 : Découpage déterministe en segments sûrs
        let segments = shenron::segments_traduisibles(stripped, 280);
        let mut segments_fr = Vec::new();

        for seg in segments {
            // Étape 3 : Masquage des termes du domaine (jetons Zeta, Yuni, Kilo...)
            let prot = shenron::proteger_termes(&seg, &self.lexique);

            // Étape 4 : Traduction du segment protégé via Google
            let translated_mask = self.translate_with_lang(&prot.masque, "ja", "fr").await?;

            // Étape 5 : Réinjection des termes canoniques français officiels
            let restored = shenron::restaurer_termes(&translated_mask, &prot.table);

            // Étape 6 : Contrôle qualité de sortie Shenron (refus)
            if let Some(err) = shenron::refus(&restored, &seg) {
                warn!(refus = %err, "contrôle qualité Shenron : traduction suspecte");
            }

            // Étape 7 : Finition sobre style Aphrody
            let final_seg = aphrodify::aphrodify(&restored);
            segments_fr.push(if final_seg.is_empty() { restored } else { final_seg });
        }

        Ok(segments_fr.join(" "))
    }

    #[cfg(not(target_arch = "wasm32"))]
    async fn translate_google_rpc(&self, text: &str, source: &str, target: &str) -> Result<String> {
        let url = format!(
            "{}?client=gtx&sl={}&tl={}&dt=t&q={}",
            GOOGLE_RPC_ENDPOINT,
            source,
            target,
            urlencoding::encode(text)
        );

        let resp = self.client.get(&url).send().await.context("google rpc request")?;
        if !resp.status().is_success() {
            anyhow::bail!("google rpc HTTP {}", resp.status());
        }

        let body: serde_json::Value = resp.json().await.context("google rpc json parse")?;
        if let Some(arr) = body.get(0).and_then(|v| v.as_array()) {
            let mut out = String::new();
            for item in arr {
                if let Some(chunk) = item.get(0).and_then(|v| v.as_str()) {
                    out.push_str(chunk);
                }
            }
            if !out.is_empty() {
                return Ok(out);
            }
        }

        anyhow::bail!("google rpc format inattendu")
    }

    #[cfg(not(target_arch = "wasm32"))]
    async fn translate_web_google(&self, text: &str, source: &str, target: &str) -> Result<String> {
        // Adaptateur Web fourni explicitement ; sans lui, Auto replie sur RPC.
        let web_cmd =
            std::env::var("APHRODY_WEB_GOOGLE_BIN").context("APHRODY_WEB_GOOGLE_BIN absent")?;

        let mut cmd = tokio::process::Command::new(&web_cmd);
        cmd.args(["google", "translate", text, "--target", target, "--source", source]);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // Do not revive a second Bun runtime through machine-specific
        // paths; callers already fall back to the native Google RPC backend.
        let output =
            cmd.output().await.with_context(|| format!("spawn Web Google adapter {web_cmd}"))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            // Nettoyage des lignes de progression [google] ou [recon]
            let cleaned: Vec<&str> =
                stdout.lines().filter(|l| !l.starts_with('[') && !l.trim().is_empty()).collect();
            let res = cleaned.join("\n").trim().to_string();
            if !res.is_empty() {
                return Ok(res);
            }
        }

        anyhow::bail!("Web Google adapter: sortie vide ou échec")
    }

    #[cfg(not(target_arch = "wasm32"))]
    async fn translate_mymemory(&self, text: &str, source: &str, target: &str) -> Result<String> {
        let mut url = format!(
            "{}?q={}&langpair={}|{}",
            MYMEMORY_ENDPOINT,
            urlencoding::encode(text),
            source,
            target
        );
        if let Some(mail) = &self.contact_email {
            url.push_str(&format!("&de={}", urlencoding::encode(mail)));
        }

        let resp = self.client.get(&url).send().await.context("mymemory request")?;
        let parsed: MyMemoryResponse = resp.json().await.context("mymemory parse")?;
        if parsed.response_status == 200 {
            Ok(parsed.response_data.translated_text)
        } else {
            anyhow::bail!("mymemory HTTP status {}", parsed.response_status)
        }
    }

    /// Persiste le cache mémoire sur disque.
    pub fn persist(&self) -> Result<()> {
        #[cfg(target_arch = "wasm32")]
        {
            return Ok(());
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let mut file = CacheFile::default();
            for r in self.cache.iter() {
                file.entries.insert(r.key().clone(), r.value().clone());
            }
            let raw = serde_json::to_string_pretty(&file)?;
            if let Some(parent) = self.cache_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            std::fs::write(&self.cache_path, raw).context("persist cache")?;
            Ok(())
        }
    }
}

pub fn default_cache_path(root: &Path) -> PathBuf {
    root.join(".aphrody-translate-cache.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_japanese_detection() {
        assert!(Translator::is_japanese("こんにちは"));
        assert!(Translator::is_japanese("孫悟空は界王拳を使った"));
        assert!(!Translator::is_japanese("Hello world"));
        assert!(!Translator::is_japanese("Bonjour tout le monde"));
    }

    #[test]
    fn test_backend_parsing() {
        assert_eq!(Backend::from_str_loose("web"), Backend::WebGoogle);
        assert_eq!(Backend::from_str_loose("web-google"), Backend::WebGoogle);
        assert_eq!(Backend::from_str_loose("google"), Backend::GoogleRpc);
        assert_eq!(Backend::from_str_loose("rpc"), Backend::GoogleRpc);
        assert_eq!(Backend::from_str_loose("mymemory"), Backend::MyMemory);
        assert_eq!(Backend::from_str_loose("auto"), Backend::Auto);
    }
}
