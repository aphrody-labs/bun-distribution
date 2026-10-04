// SPDX-License-Identifier: Apache-2.0
/** Shared in-process translation providers. Consumers own feature flags, settings and cascade order. */
export interface TranslateResult {
  source: string;
  detectedLang: string;
  translated: string;
  /** Provider qui a effectivement servi la requête. */
  provider: "lingva" | "google" | "libretranslate";
}

export function normalizeLang(code: string | undefined): string {
  if (!code) return "auto";
  const c = code.trim().toLowerCase();
  if (!c || c === "auto") return "auto";
  // Aliases courants → ISO 639-1
  const aliases: Record<string, string> = {
    jp: "ja",
    "en-us": "en",
    "en-gb": "en",
    "pt-br": "pt",
    "pt-pt": "pt",
    nb: "no",
  };
  return aliases[c] ?? c.split("-")[0]!;
}

const LIBRETRANSLATE_TIMEOUT_MS = 8_000;
const LINGVA_TIMEOUT_MS = 8_000;
const GOOGLE_TIMEOUT_MS = 8_000;
export interface TranslationHttpOptions {
  lingvaInstances(): Promise<string[]>;
  libretranslate(): { baseUrl: string; apiKey?: string };
  fetch?: typeof fetch;
}
export class TranslationHttpClient {
  lingvaAvailable: boolean | null = null;
  googleAvailable: boolean | null = null;
  constructor(private readonly options: TranslationHttpOptions) {}
  async lingva(text: string, target = "fr", source?: string): Promise<TranslateResult> {
    const tgt = normalizeLang(target);
    const src = normalizeLang(source);
    const path = `/api/v1/${encodeURIComponent(src)}/${encodeURIComponent(tgt)}/${encodeURIComponent(text)}`;

    let lastErr: Error | null = null;
    for (const inst of await this.options.lingvaInstances()) {
      try {
        // Each instance is a fallback: do not send the text to every provider at once.
        // oxlint-disable-next-line no-await-in-loop
        const res = await (this.options.fetch ?? fetch)(`${inst}${path}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(LINGVA_TIMEOUT_MS),
        });
        if (!res.ok) {
          lastErr = new Error(`Lingva ${inst} HTTP ${res.status}`);
          continue;
        }
        // oxlint-disable-next-line no-await-in-loop -- inspect this provider before advancing
        const data = (await res.json()) as {
          translation?: string;
          info?: { detectedSource?: string };
        };
        if (!data.translation) {
          lastErr = new Error(`Lingva ${inst}: réponse vide`);
          continue;
        }
        return {
          source: text,
          detectedLang: (data.info?.detectedSource ?? src).toLowerCase(),
          translated: data.translation,
          provider: "lingva",
        };
      } catch (err) {
        lastErr = err as Error;
      }
    }
    this.lingvaAvailable = false;
    throw lastErr ?? new Error("Lingva: aucune instance disponible.");
  }

  /**
   * Traduction via l'endpoint Google `translate_a/single` avec `client=gtx`
   * (utilisé par Chrome — pas de clé). Réponse tableau imbriqué : on
   * concatène les `chunks[i][0]` pour reconstituer le texte traduit, et on
   * lit la lang détectée en `data[2]`.
   */
  async googleGtx(text: string, target = "fr", source?: string): Promise<TranslateResult> {
    const tgt = normalizeLang(target);
    const src = normalizeLang(source);
    const params = new URLSearchParams({
      client: "gtx",
      sl: src,
      tl: tgt,
      dt: "t",
      q: text,
    });
    const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}`;

    const res = await (this.options.fetch ?? fetch)(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    }).catch((err) => {
      if (err?.name === "TimeoutError") {
        throw new Error(`Google gtx timeout (>${GOOGLE_TIMEOUT_MS / 1000}s).`);
      }
      throw err;
    });
    if (!res.ok) {
      // 429 / 403 → mémorise pour stop-essayer pendant ce process
      if (res.status === 429 || res.status === 403) this.googleAvailable = false;
      throw new Error(`Google gtx HTTP ${res.status}`);
    }
    const data = (await res.json()) as unknown[];
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error("Google gtx: format inattendu.");
    }
    const chunks = data[0] as Array<unknown[]>;
    const translated = chunks.map((c) => (typeof c[0] === "string" ? c[0] : "")).join("");
    if (!translated) throw new Error("Google gtx: réponse vide.");
    const detected = typeof data[2] === "string" ? data[2] : src;
    return {
      source: text,
      detectedLang: detected.toLowerCase(),
      translated,
      provider: "google",
    };
  }

  /**
   * Traduction via LibreTranslate. Source en `auto` par défaut. Si
   * `LIBRETRANSLATE_API_KEY` est défini il est joint à la requête.
   *
   * Timeout court (8 s) — au-delà l'utilisateur n'attend plus.
   */
  async libretranslate(text: string, target = "fr", source?: string): Promise<TranslateResult> {
    if (!text.trim()) {
      return {
        source: text,
        detectedLang: "—",
        translated: "",
        provider: "libretranslate",
      };
    }
    const { baseUrl: base, apiKey } = this.options.libretranslate();
    const endpoint = `${base}/translate`;

    const body: Record<string, string> = {
      q: text,
      source: normalizeLang(source),
      target: normalizeLang(target),
      format: "text",
    };
    if (apiKey) body.api_key = apiKey;

    const res = await (this.options.fetch ?? fetch)(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LIBRETRANSLATE_TIMEOUT_MS),
    }).catch((err) => {
      if (err?.name === "TimeoutError") {
        throw new Error(
          `LibreTranslate timeout (>${LIBRETRANSLATE_TIMEOUT_MS / 1000}s) — vérifie que ${base} est up.`,
        );
      }
      throw err;
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`LibreTranslate HTTP ${res.status}: ${msg.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      translatedText?: string;
      detectedLanguage?: { language: string; confidence: number };
    };
    if (!data.translatedText) throw new Error("LibreTranslate: réponse vide.");
    return {
      source: text,
      detectedLang: data.detectedLanguage?.language ?? source ?? "auto",
      translated: data.translatedText,
      provider: "libretranslate",
    };
  }
}
