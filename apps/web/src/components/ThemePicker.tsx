// SPDX-License-Identifier: Apache-2.0
import React, { useState } from 'react';
import { applyM3Theme } from '../core/theme';

const SEED_PALETTES = [
  { name: 'Aphrody Iris', color: '#6750A4' },
  { name: 'Emerald Wave', color: '#006C4C' },
  { name: 'Sapphire Glow', color: '#0061A4' },
  { name: 'Amber Sunset', color: '#8F4E00' },
  { name: 'Ruby Blaze', color: '#B3261E' },
];

export const ThemePicker: React.FC = () => {
  const [selectedSeed, setSelectedSeed] = useState(SEED_PALETTES[0].color);
  const [isDark, setIsDark] = useState(true);

  const applyTheme = (seedColor: string, dark: boolean) => {
    if (!applyM3Theme(seedColor, dark)) return;
    setSelectedSeed(seedColor);
    setIsDark(dark);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)]">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-[var(--md-sys-color-on-surface)]">
          Material 3 Dynamic Palette:
        </span>
        <div className="flex items-center gap-2">
          {SEED_PALETTES.map(p => (
            <button
              key={p.name}
              onClick={() => applyTheme(p.color, isDark)}
              className={`w-7 h-7 rounded-full border-2 transition transform hover:scale-110 ${
                selectedSeed === p.color ? 'border-[var(--md-sys-color-on-surface)] shadow-md scale-105' : 'border-transparent'
              }`}
              style={{ backgroundColor: p.color }}
              title={p.name}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => applyTheme(selectedSeed, !isDark)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--md-sys-color-surface-variant)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-outline-variant)] transition"
        >
          {isDark ? '🌙 Dark Mode' : '☀️ Light Mode'}
        </button>
      </div>
    </div>
  );
};
