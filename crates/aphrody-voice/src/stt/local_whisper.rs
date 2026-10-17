// SPDX-License-Identifier: Apache-2.0
//! Backend STT hors-ligne via `whisper.cpp` (liaisons Rust `whisper-rs`).
//!
//! # La feature choisit un backend, elle ne coupe pas la transcription
//!
//! Ce module est compilé sur toutes les cibles natives, et transcrit
//! localement dans les deux configurations :
//!
//! | `local-whisper` | Chemin | Coût |
//! |---|---|---|
//! | activée | `whisper_rs::WhisperContext` **dans le processus** | toolchain C++ au build |
//! | désactivée | binaire `whisper.cpp` **piloté** ([`super::whisper_cpp`]) | un processus fils par appel |
//!
//! Aucun des deux ne renvoie [`SttError::NotImplemented`] pour la seule raison
//! d'un drapeau de build — ce code de retour ne subsiste que pour dire
//! « whisper.cpp n'est pas installé sur cette machine », ce qui est un état du
//! poste, pas du binaire.
//!
//! # Activation du backend in-process
//!
//! ```toml
//! aphrody-voice = { path = "…", features = ["local-whisper"] }
//! ```
//!
//! # Poids
//!
//! Un fichier GGML Whisper est requis au runtime.  Le chemin le plus court est
//! `aphrody model pull whisper-base-en` : le backend piloté accepte alors l'id
//! de catalogue directement et va chercher les octets dans le store.
//! Téléchargement manuel : <https://huggingface.co/ggerganov/whisper.cpp>
//!
//! # Format d'entrée attendu
//!
//! `transcribe` accepte deux formats pour l'octet-slice `audio` :
//!
//! 1. **WAV PCM 16 kHz mono 16-bit** (format standard de capture micro) — l'en-tête est parsé, les
//!    échantillons i16 sont rééchantillonnés en f32 via
//!    `whisper_rs::convert_integer_to_float_audio`.
//! 2. **PCM f32 brut** — si les 4 premiers octets ne correspondent pas à la signature RIFF, les
//!    octets sont réinterprétés comme des f32 LE.
//!
//! # Exigences en ressources
//!
//! | Taille modèle | VRAM / RAM | WER (en) |
//! |---------------|------------|----------|
//! | tiny.en       | ~39 MB     | ~5.7 %   |
//! | base.en       | ~74 MB     | ~4.2 %   |
//! | small.en      | ~244 MB    | ~3.4 %   |
//! | medium.en     | ~769 MB    | ~3.0 %   |
//! | large-v3      | ~1550 MB   | ~2.7 %   |

use async_trait::async_trait;
use bytes::Bytes;
use futures::Stream;

#[cfg(feature = "local-whisper")]
use crate::stt::TranscriptSegment;
use crate::stt::{SttError, SttOptions, SttProvider, Transcript, TranscriptDelta};

// ── LocalWhisperBackend ───────────────────────────────────────────────────────

/// Backend STT hors-ligne utilisant `whisper.cpp` via [`whisper_rs`].
///
/// Lorsque la feature `local-whisper` est désactivée, les appels sont délégués
/// à [`super::whisper_cpp::WhisperCppBackend`], qui pilote le binaire upstream.
///
/// # Exemple
///
/// ```rust,no_run
/// # use aphrody_voice::stt::local_whisper::LocalWhisperBackend;
/// // Un chemin GGML explicite…
/// let backend = LocalWhisperBackend::new("/path/to/ggml-base.en.bin");
/// // …ou un id de catalogue, résolu dans le store `aphrody-models` par le
/// // backend piloté.
/// let from_catalog = LocalWhisperBackend::new("whisper-base-en");
/// ```
#[derive(Debug, Clone)]
pub struct LocalWhisperBackend {
    /// Chemin vers le fichier de poids GGML, ou id de catalogue
    /// (`whisper-base-en`, `whisper-large-v3-turbo-q8`)
    /// lorsque le backend piloté est actif.
    pub model_path: String,
}

impl LocalWhisperBackend {
    /// Crée un backend qui chargera `model_path` au premier appel.
    ///
    /// La construction est infaillible et ne touche pas le système de
    /// fichiers ; toute erreur I/O est différée au premier appel de
    /// transcription.
    pub fn new(model_path: impl Into<String>) -> Self {
        Self {
            model_path: model_path.into(),
        }
    }
}

// ── Implémentation réelle (feature `local-whisper` activée) ──────────────────

#[cfg(feature = "local-whisper")]
mod real_impl {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    use super::*;
    use crate::stt::SttOptions;
    // ── Conversion WAV → f32 PCM ──────────────────────────────────────────────
    //
    // Le décodage vit dans [`crate::stt::wav`] : le backend piloté
    // (`whisper_cpp`) parse les mêmes octets, et deux parseurs divergents
    // feraient qu'une même entrée stéréo ou 32-bit donnerait deux
    // transcriptions différentes selon la feature activée au build.
    pub(super) use crate::stt::wav::{WavError, as_raw_f32};

    /// Décode un buffer WAV PCM en échantillons mono `f32`.
    ///
    /// # Errors
    ///
    /// [`WavError`] si l'en-tête est absent, tronqué, ou si la profondeur de
    /// bits n'est ni 16 ni 32.
    pub(super) fn parse_wav_to_f32(audio: &[u8]) -> Result<Vec<f32>, WavError> {
        crate::stt::wav::decode(audio).map(|decoded| decoded.samples)
    }

    // ── Contextes chargés (un par fichier de poids) ───────────────────────────

    /// Contextes Whisper déjà chargés, par chemin de poids.
    ///
    /// Initialiser un contexte GGML coûte des centaines de Mio de lecture et
    /// d'initialisation : le reconstruire à chaque appel faisait payer le
    /// chargement complet du modèle à chaque transcription courte.
    /// `WhisperContext` est `Send + Sync` et fournit des `WhisperState`
    /// indépendants, donc un seul contexte sert des appels concurrents.
    static CONTEXTS: std::sync::LazyLock<
        std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<WhisperContext>>>,
    > = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

    /// Le contexte chargé pour `model_path`, chargé au premier usage.
    ///
    /// Le verrou est tenu pendant le chargement : deux appels simultanés sur
    /// un modèle pas encore chargé ne le lisent donc qu'une fois.
    fn context_for(model_path: &str) -> Result<std::sync::Arc<WhisperContext>, SttError> {
        let mut contexts = CONTEXTS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(context) = contexts.get(model_path) {
            return Ok(std::sync::Arc::clone(context));
        }
        let context = std::sync::Arc::new(
            WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
                .map_err(|e| SttError::Other(format!("whisper init error: {e}")))?,
        );
        contexts.insert(model_path.to_owned(), std::sync::Arc::clone(&context));
        Ok(context)
    }

    // ── Transcription synchrone (CPU-bound, tourne sur spawn_blocking) ────────

    /// Exécute la transcription complète dans un contexte synchrone.
    ///
    /// Doit être appelé via `tokio::task::spawn_blocking` depuis le chemin
    /// async pour ne pas bloquer le runtime Tokio.
    pub(super) fn run_transcribe_sync(
        model_path: &str,
        samples: &[f32],
        opts: &SttOptions,
    ) -> Result<Transcript, SttError> {
        // Chargement du modèle : coûteux la première fois seulement, le
        // contexte est ensuite partagé entre les appels (voir `CONTEXTS`).
        let ctx = context_for(model_path)?;

        let mut state = ctx
            .create_state()
            .map_err(|e| SttError::Other(format!("whisper create_state error: {e}")))?;

        // Paramètres de transcription.
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        params.set_temperature(opts.temperature);

        // Langue : None = auto-détection, sinon BCP-47 tag.
        let lang_owned: Option<String> = opts.language.clone();
        if let Some(ref lang) = lang_owned {
            params.set_language(Some(lang.as_str()));
        } else {
            params.set_detect_language(true);
        }

        // Exécution du pipeline complet : PCM → mel spectrogram → encoder →
        // decoder → texte.  `full` prend `&[f32]` à 16 kHz mono.
        state
            .full(params, samples)
            .map_err(|e| SttError::Other(format!("whisper full error: {e}")))?;

        // Collecte des segments.
        let n_segments = state.full_n_segments();

        let mut full_text = String::new();
        let mut segments_out: Vec<TranscriptSegment> = Vec::with_capacity(n_segments as usize);
        let mut last_end_s: f32 = 0.0;

        for i in 0..n_segments {
            let segment = state
                .get_segment(i)
                .ok_or_else(|| SttError::Other(format!("whisper segment out of bounds (i={i})")))?;
            let seg_text = segment
                .to_str_lossy()
                .map_err(|e| SttError::Other(format!("whisper segment text error (i={i}): {e}")))?
                .into_owned();

            // Les timestamps Whisper sont en centièmes de seconde (whisper_token_data.t0/t1).
            let t0_cs = segment.start_timestamp();
            let t1_cs = segment.end_timestamp();
            let start_s = t0_cs as f32 / 100.0;
            let end_s = t1_cs as f32 / 100.0;
            last_end_s = end_s;

            full_text.push_str(&seg_text);
            segments_out.push(TranscriptSegment {
                id: i as u32,
                start: start_s,
                end: end_s,
                text: seg_text,
            });
        }

        // Langue détectée — dépend de detect_language ; on ignore les erreurs
        // car certains modèles (monolingues) ne retournent pas d'ID de langue.
        let detected_lang: Option<String> = {
            let id = state.full_lang_id_from_state();
            (id >= 0).then(|| id).and_then(whisper_rs::get_lang_str)
        }
        .map(str::to_owned);

        Ok(Transcript {
            text: full_text,
            language: detected_lang.or_else(|| opts.language.clone()),
            duration_s: if last_end_s > 0.0 {
                Some(last_end_s)
            } else {
                None
            },
            segments: segments_out,
        })
    }
}

// ── SttProvider impl — feature `local-whisper` ACTIVÉE ───────────────────────

#[cfg(feature = "local-whisper")]
#[async_trait]
impl SttProvider for LocalWhisperBackend {
    /// Transcrit `audio` localement via `whisper.cpp`.
    ///
    /// # Formats acceptés
    ///
    /// - WAV PCM 16 kHz mono 16-bit (détection automatique de l'en-tête RIFF)
    /// - WAV PCM 16 kHz mono 32-bit float
    /// - PCM f32 LE brut (fallback si signature RIFF absente)
    ///
    /// # Erreurs
    ///
    /// - [`SttError::EmptyInput`] — `audio` est vide.
    /// - [`SttError::Other`] — échec de chargement du modèle, d'encodage, ou de parsing du format
    ///   audio.
    async fn transcribe(&self, audio: &[u8], opts: SttOptions) -> Result<Transcript, SttError> {
        if audio.is_empty() {
            return Err(SttError::EmptyInput);
        }

        // Extraction des échantillons f32.
        // Chemin 1 : WAV avec en-tête RIFF.
        // Chemin 2 : f32 LE brut (fallback).
        let samples: Vec<f32> = if audio.len() >= 4 && &audio[..4] == b"RIFF" {
            real_impl::parse_wav_to_f32(audio).map_err(|e| SttError::Other(e.to_string()))?
        } else {
            real_impl::as_raw_f32(audio).ok_or_else(|| {
                SttError::Other("format audio non reconnu : ni WAV ni f32 LE brut".into())
            })?
        };

        // La transcription Whisper est CPU-bound et synchrone.
        // On la délègue à spawn_blocking pour ne pas bloquer le worker Tokio.
        let model_path = self.model_path.clone();
        tokio::task::spawn_blocking(move || {
            real_impl::run_transcribe_sync(&model_path, &samples, &opts)
        })
        .await
        .map_err(|e| SttError::Other(format!("spawn_blocking join error: {e}")))?
    }

    /// Accumule le flux d'entrée, transcrit en une seule passe et émet un
    /// unique [`TranscriptDelta`] final.
    ///
    /// `whisper.cpp` ne dispose pas d'un mode de streaming réel côté API
    /// (le streaming token-by-token requiert un callback interne non exposé
    /// par `whisper-rs`).  Les chunks sont bufférisés et la transcription
    /// est lancée à la fin du flux.
    async fn transcribe_stream(
        &self,
        audio: impl Stream<Item = Bytes> + Send + 'static,
        opts: SttOptions,
    ) -> Result<impl Stream<Item = Result<TranscriptDelta, SttError>> + Send, SttError> {
        use futures::StreamExt as _;

        let mut buf: Vec<u8> = Vec::new();
        futures::pin_mut!(audio);
        while let Some(chunk) = audio.next().await {
            buf.extend_from_slice(&chunk);
        }

        let transcript = self.transcribe(&buf, opts).await?;
        let delta = TranscriptDelta {
            text: transcript.text,
            is_final: true,
            segment_id: 0,
        };
        Ok(futures::stream::once(async move { Ok(delta) }))
    }
}

// ── SttProvider impl — feature `local-whisper` DÉSACTIVÉE ────────────────────
//
// Sans la feature, la transcription locale n'est pas absente : elle passe par le
// binaire whisper.cpp upstream ([`super::whisper_cpp`]), comme `aphrody-infer`
// pilote llama.cpp au lieu de le lier (CLAUDE.md §7). La feature choisit donc un
// backend — in-process ou processus fils — et non « local ou rien ».
//
// `model_path` est transmis tel quel : `whisper_cpp::resolve_weights` accepte
// aussi bien un chemin GGML qu'un id de catalogue (`whisper-base-en`), ce qui
// permet à un appelant de construire `LocalWhisperBackend::new("whisper-large-v3-turbo-q8")`
// sans savoir où le store range les octets.

#[cfg(not(feature = "local-whisper"))]
#[async_trait]
impl SttProvider for LocalWhisperBackend {
    /// Transcrit hors-ligne en pilotant le binaire `whisper.cpp`.
    ///
    /// # Erreurs
    ///
    /// - [`SttError::EmptyInput`] — `audio` est vide.
    /// - [`SttError::NotImplemented`] — whisper.cpp n'est pas installé sur cette machine (le
    ///   message donne les chemins cherchés).
    /// - [`SttError::Other`] — poids absents, audio illisible, ou sortie non nulle du processus
    ///   fils.
    async fn transcribe(&self, audio: &[u8], opts: SttOptions) -> Result<Transcript, SttError> {
        // Le backend est lié à une variable locale : le futur renvoyé par
        // `transcribe` emprunte `&self`, donc un temporaire en position
        // d'appel ne survivrait pas au `.await` une fois boxé par
        // `async_trait` (E0515).
        let driven = super::whisper_cpp::WhisperCppBackend::new(self.model_path.clone());
        driven.transcribe(audio, opts).await
    }

    /// Bufférise le flux puis transcrit en une passe.
    ///
    /// # Erreurs
    ///
    /// Identiques à [`Self::transcribe`].
    async fn transcribe_stream(
        &self,
        audio: impl Stream<Item = Bytes> + Send + 'static,
        opts: SttOptions,
    ) -> Result<impl Stream<Item = Result<TranscriptDelta, SttError>> + Send, SttError> {
        // Le flux est accumulé ici plutôt que délégué : le `impl Stream` que
        // rend `WhisperCppBackend::transcribe_stream` capture l'emprunt du
        // backend qui l'a produit, donc un backend construit localement ne
        // pourrait pas survivre au retour (E0515). Le résultat est identique —
        // whisper.cpp est fichier-entrant / fichier-sortant, il n'y a pas de
        // canal de résultats partiels à relayer.
        use futures::StreamExt as _;

        let mut buf: Vec<u8> = Vec::new();
        futures::pin_mut!(audio);
        while let Some(chunk) = audio.next().await {
            buf.extend_from_slice(&chunk);
        }

        let transcript = self.transcribe(&buf, opts).await?;
        let delta = TranscriptDelta {
            text: transcript.text,
            is_final: true,
            segment_id: 0,
        };
        Ok(futures::stream::once(async move { Ok(delta) }))
    }
}

// ── Tests unitaires ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructeur_stocke_le_chemin() {
        let backend = LocalWhisperBackend::new("/models/ggml-base.en.bin");
        assert_eq!(backend.model_path, "/models/ggml-base.en.bin");
    }

    /// Sans la feature, un buffer vide est refusé **avant** toute résolution de
    /// binaire : le résultat doit donc être identique sur une machine avec et
    /// sans whisper.cpp installé, sinon ce test serait vert ici et rouge en CI.
    #[cfg(not(feature = "local-whisper"))]
    #[tokio::test]
    async fn entree_vide_est_refusee_sans_dependre_du_poste() {
        let backend = LocalWhisperBackend::new("whisper-base-en");
        let err = backend
            .transcribe(b"", SttOptions::default())
            .await
            .expect_err("un buffer vide n'est pas transcriptible");
        assert!(
            matches!(err, SttError::EmptyInput),
            "variante inattendue : {err}"
        );
    }

    /// Sans la feature, l'appel ne doit **plus** renvoyer `NotImplemented` au
    /// motif du drapeau de build : il part vers le backend piloté, et l'échec
    /// attendu porte sur le modèle inconnu (message qui cite le catalogue) ou
    /// sur l'absence de whisper.cpp sur ce poste.
    #[cfg(not(feature = "local-whisper"))]
    #[tokio::test]
    async fn un_modele_inconnu_est_signale_par_le_backend_pilote() {
        let backend = LocalWhisperBackend::new("modele-qui-n-existe-pas");
        let audio = crate::stt::wav::encode_pcm16(&[0.0; 16_000], 16_000);
        let err = backend
            .transcribe(&audio, SttOptions::default())
            .await
            .expect_err("ni poids ni binaire pour ce spec");
        match err {
            // whisper.cpp absent du poste : état de la machine, pas du build.
            SttError::NotImplemented { reason } => {
                assert!(reason.contains("whisper.cpp is not installed"), "{reason}");
            }
            // whisper.cpp présent : l'échec porte alors sur le spec inconnu.
            SttError::Other(msg) => {
                assert!(msg.contains("modele-qui-n-existe-pas"), "{msg}");
            }
            other => panic!("variante inattendue : {other}"),
        }
    }

    #[cfg(not(feature = "local-whisper"))]
    #[tokio::test]
    async fn transcribe_stream_delegue_au_backend_pilote() {
        let backend = LocalWhisperBackend::new("whisper-base-en");
        let audio_stream = futures::stream::empty::<Bytes>();
        // Flux vide -> buffer vide -> EmptyInput, sans toucher au disque.
        let result = backend
            .transcribe_stream(audio_stream, SttOptions::default())
            .await;
        match result {
            Err(SttError::EmptyInput) => {}
            Err(other) => panic!("variante inattendue : {other}"),
            Ok(_) => panic!("attendait Err de transcribe_stream, reçu Ok"),
        }
    }

    /// Test du parser WAV interne (uniquement quand la feature est activée).
    #[cfg(feature = "local-whisper")]
    #[test]
    fn parse_wav_valide_16bit() {
        // WAV minimal 16 kHz mono 16-bit, 4 échantillons à 0.
        let mut wav: Vec<u8> = Vec::new();
        // RIFF header
        wav.extend_from_slice(b"RIFF");
        let data_size: u32 = 8u32; // 4 échantillons × 2 octets
        let file_size: u32 = 36 + data_size;
        wav.extend_from_slice(&file_size.to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        // fmt  chunk
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes()); // chunk size
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&1u16.to_le_bytes()); // mono
        wav.extend_from_slice(&16000u32.to_le_bytes()); // sample_rate
        wav.extend_from_slice(&32000u32.to_le_bytes()); // byte_rate
        wav.extend_from_slice(&2u16.to_le_bytes()); // block_align
        wav.extend_from_slice(&16u16.to_le_bytes()); // bits_per_sample
        // data chunk
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_size.to_le_bytes());
        for _ in 0..4u32 {
            wav.extend_from_slice(&0i16.to_le_bytes());
        }

        let result = real_impl::parse_wav_to_f32(&wav);
        assert!(
            result.is_ok(),
            "parse WAV 16-bit échoué : {:?}",
            result.err()
        );
        let samples = result.unwrap();
        assert_eq!(samples.len(), 4);
        assert!(samples.iter().all(|&s| s == 0.0));
    }

    /// WAV avec signature RIFF absente → erreur.
    #[cfg(feature = "local-whisper")]
    #[test]
    fn parse_wav_signature_incorrecte() {
        let bad = b"XXXX\x00\x00\x00\x00WAVE";
        let result = real_impl::parse_wav_to_f32(bad);
        assert!(result.is_err());
    }
}
