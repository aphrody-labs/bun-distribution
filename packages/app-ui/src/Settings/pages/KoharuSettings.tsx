// SPDX-License-Identifier: Apache-2.0
// Koharu settings use the same JSONL methods as the headless CLI and Bun SDK.
import { useEffect, useState } from "react";
import { Button, Card } from "@aphrody/m3-primitives";
import { createSettingsClient, type KoharuPipeline, type KoharuPipelineCatalog, type KoharuSettings as Preferences, type KoharuTranslationModel } from "@koharu/sdk/settings";
import { isTauri, tauriInvoke } from "../../tauri-bridge";

type Section = "pipeline" | "translation" | "providers" | "typesetting";

const sections: Array<{ id: Section; label: string }> = [
  { id: "pipeline", label: "Pipeline" },
  { id: "translation", label: "Traduction" },
  { id: "providers", label: "Fournisseurs" },
  { id: "typesetting", label: "Typographie" },
];

const settingsClient = createSettingsClient(async (method, params) => {
  if (!isTauri()) throw new Error("Les réglages Koharu nécessitent l’application Aphrody.");
  const result = await tauriInvoke<unknown>("koharu_rpc", { method, params });
  if (result === null) throw new Error("Le service natif Koharu est indisponible.");
  return result;
});

const fieldClass = "min-h-12 w-full rounded-xl border border-outline bg-surface-container px-4 text-[18px] text-on-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary";
const buttonClass = "min-h-12 px-5 text-[18px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary";

function Field({ label, value, onChange, type = "text" }: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: "text" | "password" | "url";
}) {
  return <label className="grid gap-2 text-[18px] text-on-surface">
    <span>{label}</span>
    <input className={fieldClass} type={type} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  </label>;
}

function ModelField({ label, value, choices, onChange }: {
  label: string;
  value: string;
  choices: string[];
  onChange(value: string): void;
}) {
  const options = choices.includes(value) ? choices : [value, ...choices];
  return <label className="grid gap-2 text-[18px] text-on-surface">
    <span>{label}</span>
    <select className={fieldClass} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
      {options.map((option) => <option value={option} key={option}>{option}</option>)}
    </select>
  </label>;
}

export function KoharuSettings() {
  const [section, setSection] = useState<Section>("pipeline");
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [catalog, setCatalog] = useState<KoharuPipelineCatalog | null>(null);
  const [translationModels, setTranslationModels] = useState<KoharuTranslationModel[]>([]);
  const [pipelineDraft, setPipelineDraft] = useState("");
  const [typesettingDraft, setTypesettingDraft] = useState("");
  const [providerUrls, setProviderUrls] = useState<Record<string, string>>({});
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    const [current, models, pipelineCatalog] = await Promise.all([
      settingsClient.get(),
      settingsClient.translationModels(),
      settingsClient.pipelineModels(),
    ]);
    const next = current;
    setPreferences(next);
    setTranslationModels(models);
    setCatalog(pipelineCatalog);
    setPipelineDraft(JSON.stringify(next.pipeline, null, 2));
    setTypesettingDraft((next.typesetting.font_families ?? []).join("\n"));
    setProviderUrls(Object.fromEntries(next.providers.map(({ config }) => [config.provider, "base_url" in config.settings ? config.settings.base_url ?? "" : ""])));
    setCredentialDrafts({});
  };

  useEffect(() => {
    let active = true;
    void load().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, []);

  const save = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      setNotice("Paramètres Koharu enregistrés.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const updatePipeline = (next: KoharuPipeline) => {
    setPreferences((current) => current ? { ...current, pipeline: next } : current);
    setPipelineDraft(JSON.stringify(next, null, 2));
  };

  const updateModel = (stage: "detection" | "ocr" | "inpainting", model: string) => {
    if (!pipeline) return;
    updatePipeline({ ...pipeline, [stage]: { model } });
  };

  const pipeline = preferences?.pipeline;
  const translation = pipeline?.translation;
  const selectedTranslation = translation?.model;
  const selectedModel = translationModels.find((model) => model.provider === selectedTranslation?.provider && model.model === selectedTranslation.model);
  const generationNumbers = [
    ["temperature", "Température"],
    ["top_k", "Top K"],
    ["top_p", "Top P"],
    ["min_p", "Min P"],
    ["max_tokens", "Nombre maximal de jetons"],
    ["repeat_penalty", "Pénalité de répétition"],
    ["frequency_penalty", "Pénalité de fréquence"],
    ["presence_penalty", "Pénalité de présence"],
  ] as const;

  return <div className="max-w-3xl space-y-6 text-[18px] text-on-surface">
    <header>
      <h2 className="text-headline-small font-bold">Koharu</h2>
      <p className="mt-2 text-[18px] text-on-surface-variant">Traitement manga, traduction, fournisseurs et typographie.</p>
    </header>
    <nav aria-label="Paramètres Koharu" className="flex flex-wrap gap-2">
      {sections.map(({ id, label }) => <button key={id} type="button" aria-current={section === id ? "page" : undefined}
        className="min-h-12 rounded-full px-5 text-[18px] text-on-surface focus-visible:outline-3 focus-visible:outline-primary aria-[current=page]:bg-secondary-container"
        onClick={() => setSection(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="rounded-xl bg-error-container p-4 text-on-error-container">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-primary-container p-4 text-on-primary-container">{notice}</p>}
    {!preferences && !error && <p role="status">Chargement des paramètres Koharu…</p>}
    {pipeline && section === "pipeline" && <Card className="space-y-5 p-6">
      <h3 className="text-title-large">Modèles du pipeline</h3>
      {(["detection", "ocr", "inpainting"] as const).map((stage) => <ModelField key={stage} label={stage === "detection" ? "Détection" : stage === "ocr" ? "OCR" : "Effacement"}
        value={pipeline[stage].model} choices={catalog?.[stage] ?? []}
        onChange={(model) => updateModel(stage, model)} />)}
      <details>
        <summary className="cursor-pointer text-[18px]">Tous les paramètres du pipeline</summary>
        <label className="mt-3 grid gap-2">Configuration JSON
          <textarea className={`${fieldClass} min-h-80 font-mono`} spellCheck={false} value={pipelineDraft}
            onChange={(event) => setPipelineDraft(event.currentTarget.value)} />
        </label>
      </details>
      <Button className={buttonClass} disabled={busy} onClick={() => void save(() => settingsClient.setPipeline(JSON.parse(pipelineDraft) as KoharuPipeline))}>Enregistrer le pipeline</Button>
    </Card>}
    {pipeline && translation && section === "translation" && <Card className="space-y-5 p-6">
      <h3 className="text-title-large">Traduction</h3>
      <ModelField label="Modèle" value={selectedModel ? `${selectedModel.provider}:${selectedModel.model ?? ""}` : `${selectedTranslation?.provider}:${selectedTranslation?.model ?? ""}`}
        choices={translationModels.map((model) => `${model.provider}:${model.model ?? ""}`)}
        onChange={(key) => {
          const model = translationModels.find((candidate) => `${candidate.provider}:${candidate.model ?? ""}` === key);
          if (model) updatePipeline({ ...pipeline, translation: { ...translation, model: { provider: model.provider, model: model.model, vision: model.vision, reasoning: model.reasoning } } });
        }} />
      {selectedModel && selectedModel.quantizations.length > 0 && <ModelField label="Quantification"
        value={typeof selectedTranslation?.quantization === "string" ? selectedTranslation.quantization : selectedModel.quantizations[0]!.id}
        choices={selectedModel.quantizations.map((choice) => choice.id)}
        onChange={(quantization) => updatePipeline({ ...pipeline, translation: { ...translation, model: { ...translation.model, quantization } } })} />}
      <Field label="Langue cible" value={translation.target_language} onChange={(target_language) => updatePipeline({ ...pipeline, translation: { ...translation, target_language } })} />
      <label className="grid gap-2">Instructions
        <textarea className={`${fieldClass} min-h-36`} value={translation.instructions ?? ""}
          onChange={(event) => updatePipeline({ ...pipeline, translation: { ...translation, instructions: event.currentTarget.value || null } })} />
      </label>
      <details>
        <summary className="cursor-pointer text-[18px]">Paramètres de génération</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {generationNumbers.map(([key, label]) => <label key={key} className="grid gap-2">{label}
            <input className={fieldClass} type="number" step="any"
              value={typeof translation.generation[key] === "number" ? translation.generation[key] as number : ""}
              onChange={(event) => updatePipeline({ ...pipeline, translation: { ...translation,
                generation: { ...translation.generation, [key]: event.currentTarget.value === "" ? null : Number(event.currentTarget.value) },
              } })} />
          </label>)}
          {(["reasoning", "vision"] as const).map((key) => <label key={key} className="grid gap-2">{key === "reasoning" ? "Raisonnement" : "Vision"}
            <select className={fieldClass} value={translation.generation[key] === null || translation.generation[key] === undefined ? "default" : String(translation.generation[key])}
              onChange={(event) => updatePipeline({ ...pipeline, translation: { ...translation,
                generation: { ...translation.generation, [key]: event.currentTarget.value === "default" ? null : event.currentTarget.value === "true" },
              } })}>
              <option value="default">Par défaut</option><option value="true">Activé</option><option value="false">Désactivé</option>
            </select>
          </label>)}
        </div>
      </details>
      <Button className={buttonClass} disabled={busy} onClick={() => void save(() => settingsClient.setPipeline(JSON.parse(pipelineDraft) as KoharuPipeline))}>Enregistrer la traduction</Button>
    </Card>}
    {preferences && section === "providers" && <div className="space-y-4">
      {preferences.providers.map(({ config, credential_configured }) => <Card key={config.provider} className="space-y-4 p-6">
        <h3 className="text-title-large">{config.provider}</h3>
        {"base_url" in config.settings && <Field label="URL du fournisseur" type="url" value={providerUrls[config.provider] ?? ""}
          onChange={(value) => setProviderUrls((current) => ({ ...current, [config.provider]: value }))} />}
        {config.provider !== "local" && <>
          <p className="text-on-surface-variant">Identifiant configuré : {credential_configured ? "oui" : "non"}</p>
          <Field label="Nouvel identifiant secret" type="password" value={credentialDrafts[config.provider] ?? ""}
            onChange={(value) => setCredentialDrafts((current) => ({ ...current, [config.provider]: value }))} />
          <div className="flex flex-wrap gap-3">
            <Button className={buttonClass} disabled={busy || !credentialDrafts[config.provider]} onClick={() => void save(() => settingsClient.setCredential(config.provider, credentialDrafts[config.provider] ?? ""))}>Enregistrer le secret</Button>
            {credential_configured && <Button className={buttonClass} disabled={busy} onClick={() => void save(() => settingsClient.setCredential(config.provider, null))}>Effacer le secret</Button>}
          </div>
        </>}
      </Card>)}
      <Button className={buttonClass} disabled={busy} onClick={() => void save(() => settingsClient.setProviders(
        preferences.providers.map(({ config }) => ({ ...config, settings: "base_url" in config.settings ? { ...config.settings, base_url: providerUrls[config.provider] || null } : config.settings })),
      ))}>Enregistrer les fournisseurs</Button>
    </div>}
    {preferences && section === "typesetting" && <Card className="space-y-5 p-6">
      <h3 className="text-title-large">Typographie</h3>
      <label className="grid gap-2">Polices de remplacement, une par ligne
        <textarea className={`${fieldClass} min-h-44`} value={typesettingDraft} onChange={(event) => setTypesettingDraft(event.currentTarget.value)} />
      </label>
      <Button className={buttonClass} disabled={busy} onClick={() => void save(() => settingsClient.setTypesetting(
        { ...preferences.typesetting, font_families: typesettingDraft.split("\n").map((name) => name.trim()).filter(Boolean) },
      ))}>Enregistrer la typographie</Button>
    </Card>}
  </div>;
}
