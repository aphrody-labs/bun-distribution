// SPDX-License-Identifier: Apache-2.0
import React, { useState } from 'react';

interface M3FusionStudioAppProps {
  onSetTheme?: (seed: string) => void;
  currentSeed?: string;
}

export const M3FusionStudioApp: React.FC<M3FusionStudioAppProps> = ({ onSetTheme, currentSeed = '#8b5cf6' }) => {
  const [seed, setSeed] = useState(currentSeed);
  const [variant, setVariant] = useState('TonalSpot');
  const [contrast, setContrast] = useState('Standard');
  const [activeTab, setActiveTab] = useState<'preview' | 'css-m3' | 'css-shadcn' | 'css-tailwind'>('preview');

  const presetSeeds = [
    { name: 'Aphrody Violet', hex: '#8b5cf6' },
    { name: 'Emerald Green', hex: '#10b981' },
    { name: 'Sapphire Blue', hex: '#3b82f6' },
    { name: 'Ruby Crimson', hex: '#ef4444' },
    { name: 'Amber Gold', hex: '#f59e0b' },
    { name: 'Rose Petal', hex: '#ec4899' },
  ];

  const handleSeedChange = (hex: string) => {
    setSeed(hex);
    onSetTheme?.(hex);
  };

  const m3CssPreview = `:root {
  --md-sys-color-primary: ${seed};
  --md-sys-color-on-primary: #ffffff;
  --md-sys-color-primary-container: ${seed}25;
  --md-sys-color-on-primary-container: #ede9fe;
  --md-sys-color-secondary: #a78bfa;
  --md-sys-color-surface: #0f1117;
  --md-sys-color-on-surface: #f3f4f6;
  --md-sys-color-surface-variant: #1e2230;
  --md-sys-color-outline: #6b7280;
  --md-sys-color-error: #ef4444;
}`;

  const shadcnCssPreview = `:root {
  /* FUSION_ALIAS_MAP: 19 Canonical Semantic Aliases */
  --background: var(--md-sys-color-surface);
  --foreground: var(--md-sys-color-on-surface);
  --card: var(--md-sys-color-surface-container-low);
  --card-foreground: var(--md-sys-color-on-surface);
  --popover: var(--md-sys-color-surface-container);
  --popover-foreground: var(--md-sys-color-on-surface);
  --primary: var(--md-sys-color-primary);
  --primary-foreground: var(--md-sys-color-on-primary);
  --secondary: var(--md-sys-color-secondary-container);
  --secondary-foreground: var(--md-sys-color-on-secondary-container);
  --muted: var(--md-sys-color-surface-variant);
  --muted-foreground: var(--md-sys-color-on-surface-variant);
  --accent: var(--md-sys-color-tertiary-container);
  --accent-foreground: var(--md-sys-color-on-tertiary-container);
  --destructive: var(--md-sys-color-error);
  --border: var(--md-sys-color-outline-variant);
  --input: var(--md-sys-color-outline-variant);
  --ring: var(--md-sys-color-primary);
}`;

  const tailwindCssPreview = `@theme inline {
  /* Tailwind CSS v4 Theme Token Bindings */
  --color-background: var(--md-sys-color-surface);
  --color-foreground: var(--md-sys-color-on-surface);
  --color-card: var(--md-sys-color-surface-container-low);
  --color-primary: var(--md-sys-color-primary);
  --color-secondary: var(--md-sys-color-secondary-container);
  --color-muted: var(--md-sys-color-surface-variant);
  --color-accent: var(--md-sys-color-tertiary-container);
  --color-destructive: var(--md-sys-color-error);
  --color-border: var(--md-sys-color-outline-variant);
  --color-ring: var(--md-sys-color-primary);
}`;

  return (
    <div className="flex flex-col h-full bg-[#0e1017] text-gray-200 font-sans select-none overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#131622] border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white shadow-md" style={{ backgroundColor: seed }}>
            🎨
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-white">M3 Token Fusion Studio</span>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full">
                FUSION-PLAN.md
              </span>
            </div>
            <div className="text-[11px] text-gray-400 font-mono">
              Material Design 3 • Tailwind CSS v4 • shadcn/ui Single Semantic Layer
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {presetSeeds.map(p => (
            <button
              key={p.hex}
              onClick={() => handleSeedChange(p.hex)}
              className="w-5 h-5 rounded-full border border-white/20 transition-transform hover:scale-110"
              style={{ backgroundColor: p.hex }}
              title={p.name}
            />
          ))}
          <input
            type="color"
            value={seed}
            onChange={e => handleSeedChange(e.target.value)}
            className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
            title="Custom Seed Color"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-[#10121b] px-4 gap-1 text-xs">
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-3 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'preview'
              ? 'border-purple-500 text-purple-300 bg-purple-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Interactive Component Matrix
        </button>
        <button
          onClick={() => setActiveTab('css-m3')}
          className={`px-3 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'css-m3'
              ? 'border-purple-500 text-purple-300 bg-purple-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          M3 System Roles (--md-sys-*)
        </button>
        <button
          onClick={() => setActiveTab('css-shadcn')}
          className={`px-3 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'css-shadcn'
              ? 'border-purple-500 text-purple-300 bg-purple-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          shadcn/ui Aliases (FUSION_ALIAS_MAP)
        </button>
        <button
          onClick={() => setActiveTab('css-tailwind')}
          className={`px-3 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'css-tailwind'
              ? 'border-purple-500 text-purple-300 bg-purple-500/5'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Tailwind v4 (@theme inline)
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {activeTab === 'preview' && (
          <div className="space-y-6">
            {/* Palette swatch bar */}
            <div>
              <div className="text-xs font-semibold text-gray-400 mb-2 font-mono uppercase tracking-wider">
                HCT Dynamic Palette
              </div>
              <div className="grid grid-cols-6 gap-2 text-[10px] font-mono">
                <div className="p-3 rounded-lg flex flex-col justify-end text-white font-bold" style={{ backgroundColor: seed }}>
                  Primary
                </div>
                <div className="p-3 rounded-lg flex flex-col justify-end text-gray-200 font-bold bg-[#262a38]">
                  Surface Low
                </div>
                <div className="p-3 rounded-lg flex flex-col justify-end text-gray-100 font-bold bg-[#1a1d27]">
                  Surface
                </div>
                <div className="p-3 rounded-lg flex flex-col justify-end text-white font-bold bg-indigo-600">
                  Secondary
                </div>
                <div className="p-3 rounded-lg flex flex-col justify-end text-white font-bold bg-pink-600">
                  Tertiary
                </div>
                <div className="p-3 rounded-lg flex flex-col justify-end text-white font-bold bg-red-600">
                  Error
                </div>
              </div>
            </div>

            {/* Controls Matrix */}
            <div>
              <div className="text-xs font-semibold text-gray-400 mb-2 font-mono uppercase tracking-wider">
                Component Matrix (Rendered with Theme Tokens)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#141722] border border-gray-800 rounded-lg p-4 space-y-3">
                  <div className="text-xs font-medium text-gray-300">Buttons & Actions</div>
                  <div className="flex flex-wrap gap-2">
                    <button className="px-4 py-2 rounded-full font-medium text-xs text-white shadow-sm" style={{ backgroundColor: seed }}>
                      Filled Button
                    </button>
                    <button className="px-4 py-2 rounded-full font-medium text-xs border border-gray-600 text-gray-200 hover:bg-gray-800">
                      Outlined Button
                    </button>
                    <button className="px-4 py-2 rounded-full font-medium text-xs text-purple-300 bg-purple-500/10 hover:bg-purple-500/20">
                      Tonal Button
                    </button>
                  </div>
                </div>

                <div className="bg-[#141722] border border-gray-800 rounded-lg p-4 space-y-3">
                  <div className="text-xs font-medium text-gray-300">Chips & Badges</div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-3 py-1 rounded-full font-medium text-white shadow-sm" style={{ backgroundColor: seed }}>
                      Active Chip
                    </span>
                    <span className="px-3 py-1 rounded-full font-medium border border-gray-700 bg-gray-900 text-gray-300">
                      Filter Chip
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      STATUS_OK
                    </span>
                  </div>
                </div>

                <div className="bg-[#141722] border border-gray-800 rounded-lg p-4 space-y-3">
                  <div className="text-xs font-medium text-gray-300">Inputs & Form Controls</div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      defaultValue="Material 3 Outlined Input"
                      className="w-full px-3 py-2 rounded-lg bg-gray-950 border border-gray-700 text-xs text-gray-100 outline-none focus:border-purple-500"
                    />
                    <div className="flex items-center gap-2 text-xs text-gray-300">
                      <input type="checkbox" defaultChecked className="accent-purple-500 rounded" />
                      <span>Elevate permissions on start</span>
                    </div>
                  </div>
                </div>

                <div className="bg-[#141722] border border-gray-800 rounded-lg p-4 space-y-3">
                  <div className="text-xs font-medium text-gray-300">Cards & Surfaces</div>
                  <div className="p-3 bg-gray-900/60 rounded-lg border border-gray-800">
                    <div className="font-semibold text-xs text-white">Elevated Card</div>
                    <div className="text-[11px] text-gray-400 mt-1">
                      Inherits <code className="text-purple-300">--md-sys-color-surface-container</code> through CSS cascade.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'css-m3' && (
          <div className="font-mono text-xs">
            <pre className="p-4 bg-[#12141c] rounded-lg border border-gray-800 text-purple-300 overflow-x-auto leading-relaxed">
              {m3CssPreview}
            </pre>
          </div>
        )}

        {activeTab === 'css-shadcn' && (
          <div className="font-mono text-xs">
            <pre className="p-4 bg-[#12141c] rounded-lg border border-gray-800 text-blue-300 overflow-x-auto leading-relaxed">
              {shadcnCssPreview}
            </pre>
          </div>
        )}

        {activeTab === 'css-tailwind' && (
          <div className="font-mono text-xs">
            <pre className="p-4 bg-[#12141c] rounded-lg border border-gray-800 text-emerald-300 overflow-x-auto leading-relaxed">
              {tailwindCssPreview}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
