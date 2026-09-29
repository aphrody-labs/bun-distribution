// SPDX-License-Identifier: Apache-2.0
// Host-neutral JSONL settings contract; Rust owns validation and model choices.
export type KoharuPipeline = {
  detection: { model: string; [key: string]: unknown }
  ocr: { model: string; [key: string]: unknown }
  inpainting: { model: string; [key: string]: unknown }
  translation: {
    model: { provider: string; model?: string | null; vision?: boolean; reasoning?: boolean; [key: string]: unknown }
    generation: Record<string, unknown>
    target_language: string
    instructions: string | null
  }
  processor: Record<string, unknown>
}

export type KoharuProvider = {
  config: { provider: string; settings: { base_url?: string | null; [key: string]: unknown } }
  credential_configured: boolean
}

export type KoharuSettings = {
  pipeline: KoharuPipeline
  providers: KoharuProvider[]
  typesetting: { font_families?: string[] }
}

export type KoharuPipelineCatalog = {
  detection: string[]
  ocr: string[]
  inpainting: string[]
}

export type KoharuTranslationModel = {
  provider: string
  model: string | null
  name: string
  vision: boolean
  reasoning: boolean
  quantizations: Array<{ id: string; name: string; downloaded: boolean }>
}

export type SettingsHostInvoke = (method: string, params: Record<string, unknown>) => Promise<unknown>

/** The host supplies a transport; this module never starts a process or imports Tauri. */
export function createSettingsClient(invoke: SettingsHostInvoke) {
  const call = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    await invoke(method, params) as T

  return {
    get: () => call<KoharuSettings>('preferences.get'),
    setPipeline: (pipeline: KoharuPipeline) => call<{ pipeline: KoharuPipeline }>('preferences.setPipeline', { pipeline }),
    setProviders: (entries: KoharuProvider['config'][]) => call<{ providers: KoharuProvider['config'][] }>('preferences.setProviders', { entries }),
    setTypesetting: (typesetting: KoharuSettings['typesetting']) => call<{ typesetting: KoharuSettings['typesetting'] }>('preferences.setTypesetting', { typesetting }),
    setCredential: (provider: string, value: string | null) => call<{ credential_configured: boolean }>('preferences.setCredential',
      value === null ? { provider, clear: true } : { provider, value }),
    translationModels: () => call<KoharuTranslationModel[]>('models.translation'),
    pipelineModels: () => call<KoharuPipelineCatalog>('models.pipeline'),
  }
}
