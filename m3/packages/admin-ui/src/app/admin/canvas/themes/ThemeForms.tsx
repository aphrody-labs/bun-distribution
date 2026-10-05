"use client";

import { useState, useTransition } from "react";
import { ImageField } from "@aphrody/admin-ui/components/admin/ImageField";
import { createTheme, updateTheme, deleteTheme } from "./_actions";

type Theme = {
  id: string;
  name: string;
  accent: string;
  aura: string;
  bgGrad1: string;
  bgGrad2: string;
  bgGrad3: string;
  bgFile: string | null;
  textShadow: string;
  enabled: boolean;
};

export function ThemeCreateForm() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<{ ok: boolean; error?: string } | null>(null);
  const [bgFile, setBgFile] = useState("");
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      id: String(fd.get("id") ?? "").trim(),
      name: String(fd.get("name") ?? "").trim(),
      accent: String(fd.get("accent") ?? "#a855f7"),
      aura: String(fd.get("aura") ?? "#38bdf8"),
      bgGrad1: String(fd.get("bgGrad1") ?? "#04050f"),
      bgGrad2: String(fd.get("bgGrad2") ?? "#1e1b3a"),
      bgGrad3: String(fd.get("bgGrad3") ?? "#000000"),
      bgFile: String(fd.get("bgFile") ?? "") || null,
      textShadow: String(fd.get("textShadow") ?? "rgba(0,0,0,0.8)"),
      enabled: fd.get("enabled") === "on",
    };
    start(async () => {
      const res = await createTheme(input);
      setR(res);
      if (res.ok) {
        (e.target as HTMLFormElement).reset();
        setBgFile("");
      }
    });
  }
  return (
    <form onSubmit={onSubmit} className="dbz-panel p-5 space-y-3 mb-4">
      <h3 className="font-saiyan text-xl text-fuchsia-300">+ Nouveau thème carte</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <TextInput name="id" label="ID (key unique, ex: galactic)" required pattern="[a-z0-9_-]+" />
        <TextInput name="name" label="Nom affiché" required />
        <ColorInput name="accent" label="Accent" defaultValue="#a855f7" />
        <ColorInput name="aura" label="Aura" defaultValue="#38bdf8" />
        <ColorInput name="bgGrad1" label="BG stop 1" defaultValue="#04050f" />
        <ColorInput name="bgGrad2" label="BG stop 2" defaultValue="#1e1b3a" />
        <ColorInput name="bgGrad3" label="BG stop 3" defaultValue="#000000" />
        <div className="sm:col-span-2">
          <span className="font-scouter tracking-widest text-cyan-300 text-[10px] uppercase">
            Image de fond
          </span>
          <ImageField value={bgFile} onChange={setBgFile} subdir="themes" column="image de fond" />
          <input type="hidden" name="bgFile" value={bgFile} />
        </div>
        <TextInput name="textShadow" label="Text shadow CSS" defaultValue="rgba(0,0,0,0.8)" />
        <label className="flex items-center gap-2 pt-5">
          <input type="checkbox" name="enabled" defaultChecked className="w-4 h-4" />
          <span className="font-scouter tracking-widest text-cyan-300 text-[10px]">ACTIVÉ</span>
        </label>
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="dbz-button !text-xs disabled:opacity-40"
        >
          {pending ? "…" : "Créer thème"}
        </button>
        {r && (
          <span className={`text-xs ${r.ok ? "text-green-300" : "text-red-400"}`}>
            {r.ok ? "✓ Thème créé" : `✗ ${r.error}`}
          </span>
        )}
      </div>
    </form>
  );
}

function TextInput({
  name,
  label,
  defaultValue,
  required,
  pattern,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  pattern?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="font-scouter tracking-widest text-cyan-300 text-[10px] uppercase">
        {label}
      </span>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        pattern={pattern}
        placeholder={placeholder}
        className="mt-1 w-full bg-dbz-bg border border-dbz-border focus:border-fuchsia-400 p-2 font-mono"
      />
    </label>
  );
}

function ColorInput({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  const [val, setVal] = useState(defaultValue);
  return (
    <label className="block">
      <span className="font-scouter tracking-widest text-cyan-300 text-[10px] uppercase">
        {label}
      </span>
      <div className="mt-1 flex gap-2">
        <input
          name={name}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          pattern="#[0-9a-fA-F]{6}"
          required
          className="flex-1 bg-dbz-bg border border-dbz-border focus:border-fuchsia-400 p-2 font-mono"
        />
        <input
          type="color"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-12 h-10 bg-dbz-bg border border-dbz-border cursor-pointer"
        />
      </div>
    </label>
  );
}

export function ThemeRowActions({ theme }: { theme: Theme }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return <ThemeEditModal theme={theme} onClose={() => setEditing(false)} />;
  }

  return (
    <div className="flex gap-2 items-center justify-end">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="px-2 py-1 text-[10px] uppercase tracking-widest border border-fuchsia-400/50 text-fuchsia-300 hover:bg-fuchsia-500/10 rounded"
      >
        ✏ Éditer
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await updateTheme(theme.id, { enabled: !theme.enabled });
          })
        }
        className={`px-2 py-1 text-[10px] uppercase tracking-widest border rounded ${
          theme.enabled
            ? "border-green-400/50 text-green-300 hover:bg-green-500/10"
            : "border-white/20 text-white/50 hover:bg-white/5"
        }`}
      >
        {theme.enabled ? "ON" : "OFF"}
      </button>
      {theme.id !== "default" && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!confirm(`Supprimer thème "${theme.id}" ?`)) return;
              await deleteTheme(theme.id);
            })
          }
          className="px-2 py-1 text-[10px] uppercase tracking-widest border border-red-400/50 text-red-300 hover:bg-red-500/10 rounded"
        >
          ✗
        </button>
      )}
    </div>
  );
}

function ThemeEditModal({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const [vals, setVals] = useState(theme);
  const [pending, start] = useTransition();
  const [r, setR] = useState<{ ok: boolean; error?: string } | null>(null);
  function save() {
    start(async () => {
      const res = await updateTheme(theme.id, {
        name: vals.name,
        accent: vals.accent,
        aura: vals.aura,
        bgGrad1: vals.bgGrad1,
        bgGrad2: vals.bgGrad2,
        bgGrad3: vals.bgGrad3,
        bgFile: vals.bgFile || null,
        textShadow: vals.textShadow,
      });
      setR(res);
      if (res.ok) onClose();
    });
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-4 overflow-y-auto">
      <div className="dbz-panel p-6 max-w-3xl w-full space-y-3 my-8">
        <div className="flex justify-between items-baseline">
          <h3 className="font-saiyan text-xl text-fuchsia-300">
            Éditer thème · <code className="text-cyan-300">{theme.id}</code>
          </h3>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white">
            ✗
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <LabeledInput label="Nom">
            <input
              value={vals.name}
              onChange={(e) => setVals({ ...vals, name: e.target.value })}
              className="mt-1 w-full bg-dbz-bg border border-dbz-border focus:border-fuchsia-400 p-2"
            />
          </LabeledInput>
          {(["accent", "aura", "bgGrad1", "bgGrad2", "bgGrad3"] as const).map((k) => (
            <LabeledInput key={k} label={k}>
              <div className="mt-1 flex gap-2">
                <input
                  value={vals[k]}
                  onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                  pattern="#[0-9a-fA-F]{6}"
                  className="flex-1 bg-dbz-bg border border-dbz-border focus:border-fuchsia-400 p-2 font-mono"
                />
                <input
                  type="color"
                  value={vals[k]}
                  onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                  className="w-12 h-10 bg-dbz-bg border border-dbz-border cursor-pointer"
                />
              </div>
            </LabeledInput>
          ))}
          <div className="sm:col-span-2">
            <span className="font-scouter tracking-widest text-cyan-300 text-[10px] uppercase">
              Image de fond
            </span>
            <ImageField
              value={vals.bgFile ?? ""}
              onChange={(bgFile) => setVals({ ...vals, bgFile: bgFile || null })}
              subdir="themes"
              column="image de fond"
            />
          </div>
          <LabeledInput label="Text shadow CSS">
            <input
              value={vals.textShadow}
              onChange={(e) => setVals({ ...vals, textShadow: e.target.value })}
              className="mt-1 w-full bg-dbz-bg border border-dbz-border focus:border-fuchsia-400 p-2 font-mono"
            />
          </LabeledInput>
        </div>

        {/* Live preview palette */}
        <div className="dbz-panel p-3 bg-dbz-bg/60">
          <div className="font-scouter text-[10px] tracking-widest text-fuchsia-300 mb-2">
            PREVIEW PALETTE
          </div>
          <div className="flex gap-2">
            {(["accent", "aura", "bgGrad1", "bgGrad2", "bgGrad3"] as const).map((k) => (
              <div key={k} className="flex-1 text-center">
                <div
                  className="h-12 rounded border border-dbz-border"
                  style={{ background: vals[k] }}
                />
                <div className="text-[9px] text-white/50 mt-1 font-mono">{k}</div>
              </div>
            ))}
          </div>
          <div
            className="h-16 rounded mt-3 border border-dbz-border"
            style={{
              background: `linear-gradient(90deg, ${vals.bgGrad1}, ${vals.bgGrad2}, ${vals.bgGrad3})`,
            }}
          />
        </div>

        {r && (
          <span className={`text-xs ${r.ok ? "text-green-300" : "text-red-400"}`}>
            {r.ok ? "✓ Sauvegardé" : `✗ ${r.error}`}
          </span>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="dbz-button-ghost !text-xs">
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="dbz-button !text-xs disabled:opacity-40"
          >
            {pending ? "…" : "Sauvegarder"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LabeledInput({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-scouter tracking-widest text-cyan-300 text-[10px] uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}
