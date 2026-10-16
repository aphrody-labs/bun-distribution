/** Minimal OpenAI-compatible chat client (fetch only): retries, optional fields fallback, think-tag stripping. */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmConfig {
  /** Base URL including the version prefix, e.g. http://127.0.0.1:8795/v1. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  seed?: number;
  timeoutMs: number;
  /** Extra JSON body fields (for example chat_template_kwargs for a local server). */
  extra?: Record<string, unknown>;
  /** Delay before the first retry (ms), doubled each time. */
  retryDelayMs?: number;
  maxAttempts?: number;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** `http://host:port` becomes `http://host:port/v1`; a trailing `/chat/completions` is dropped. */
export function normalizeBaseUrl(input: string): string {
  const url = new URL(input);
  let path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
  if (path === "") path = "/v1";
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

export function isLocalHost(input: string): boolean {
  const host = new URL(input).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** Removes reasoning blocks that some local models put in the message content. */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = out.lastIndexOf("</think>");
  if (close >= 0) out = out.slice(close + "</think>".length);
  return out.trim();
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function contentOf(body: unknown): string {
  const choice = (body as { choices?: { message?: { content?: unknown } }[] })
    ?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : ((part as { text?: string })?.text ?? ""),
      )
      .join("");
  }
  throw new LlmError("réponse sans choices[0].message.content");
}

export class LlmClient {
  calls = 0;
  private dropOptional = false;

  constructor(readonly config: LlmConfig) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.config.apiKey)
      headers.authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  async chat(
    messages: ChatMessage[],
    options: { maxTokens?: number } = {},
  ): Promise<string> {
    const attempts = this.config.maxAttempts ?? 3;
    let delay = this.config.retryDelayMs ?? 800;
    let last: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- réessais séquentiels voulus : chaque tentative suit la précédente après backoff (limite de débit de l'endpoint LLM)
        return await this.once(messages, options);
      } catch (error) {
        last = error;
        if (
          !(error instanceof LlmError) ||
          !error.retryable ||
          attempt === attempts
        )
          break;
        // oxlint-disable-next-line no-await-in-loop -- backoff exponentiel entre tentatives séquentielles, par conception
        await sleep(delay);
        delay *= 2;
      }
    }
    throw last instanceof Error ? last : new LlmError(String(last));
  }

  private async once(
    messages: ChatMessage[],
    options: { maxTokens?: number },
  ): Promise<string> {
    const { config } = this;
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: config.temperature,
      stream: false,
    };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (!this.dropOptional) {
      if (config.seed !== undefined) body.seed = config.seed;
      if (config.extra) Object.assign(body, config.extra);
    }
    this.calls += 1;
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new LlmError(
        `endpoint injoignable (${config.baseUrl}) : ${reason}`,
        true,
      );
    }
    if (!response.ok) {
      const text = (await response.text().catch(() => "")).slice(0, 300);
      if (
        (response.status === 400 || response.status === 422) &&
        !this.dropOptional &&
        (config.seed !== undefined || config.extra)
      ) {
        this.dropOptional = true;
        throw new LlmError(
          `HTTP ${response.status} (seed/extra refusés, nouvel essai sans) : ${text}`,
          true,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new LlmError(
          `authentification refusée (HTTP ${response.status}) : vérifier --llm-key-env`,
        );
      }
      if (response.status === 404) {
        throw new LlmError(
          `HTTP 404 sur ${config.baseUrl}/chat/completions (chemin ou modèle "${config.model}" inconnu) : ${text}`,
        );
      }
      throw new LlmError(
        `HTTP ${response.status} : ${text}`,
        response.status === 429 || response.status >= 500,
      );
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new LlmError("réponse non JSON", true);
    }
    return stripThinking(contentOf(json));
  }
}

export interface ModelInfo {
  id: string;
  loaded?: boolean;
}

/** GET {base}/models; understands llama-server router mode (`status.value`). */
export async function listModels(
  baseUrl: string,
  apiKey?: string,
  timeoutMs = 2500,
): Promise<ModelInfo[]> {
  const response = await fetch(`${baseUrl}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new LlmError(`HTTP ${response.status} sur ${baseUrl}/models`);
  const json = (await response.json()) as {
    data?: { id?: string; status?: { value?: string } }[];
  };
  return (json.data ?? [])
    .filter(
      (item): item is { id: string; status?: { value?: string } } =>
        typeof item.id === "string",
    )
    .map((item) => ({
      id: item.id,
      loaded:
        item.status?.value === undefined
          ? undefined
          : item.status.value === "loaded",
    }));
}

export function pickModel(models: ModelInfo[]): string | undefined {
  return (models.find((model) => model.loaded) ?? models[0])?.id;
}

/** First reachable endpoint among `candidates` (their `/models`), or undefined. */
export async function probeEndpoints(
  candidates: string[],
  apiKey?: string,
): Promise<{ baseUrl: string; models: ModelInfo[] } | undefined> {
  for (const baseUrl of candidates) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- sondage séquentiel par priorité : le premier endpoint joignable gagne, les suivants ne doivent pas être contactés
      return { baseUrl, models: await listModels(baseUrl, apiKey, 1200) };
    } catch {
      // try next candidate
    }
  }
  return undefined;
}
