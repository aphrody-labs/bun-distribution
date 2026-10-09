import React, { useState } from 'react';

const SEED_PALETTES = [
  { name: 'Aphrody Iris', color: '#6750A4', secondary: '#625B71', tertiary: '#7D5260' },
  { name: 'Emerald Wave', color: '#006C4C', secondary: '#4C6357', tertiary: '#3E6374' },
  { name: 'Sapphire Glow', color: '#0061A4', secondary: '#535F70', tertiary: '#6B5778' },
  { name: 'Amber Sunset', color: '#8F4E00', secondary: '#715A42', tertiary: '#56643C' },
  { name: 'Ruby Blaze', color: '#B3261E', secondary: '#775652', tertiary: '#755A2F' },
];

export const ThemePicker: React.FC = () => {
  const [selectedSeed, setSelectedSeed] = useState(SEED_PALETTES[0].color);
  const [isDark, setIsDark] = useState(true);

  const applyTheme = (seedColor: string, dark: boolean) => {
    setSelectedSeed(seedColor);
    setIsDark(dark);

    const root = document.documentElement;
    if (dark) {
      root.classList.add('dark');
      root.style.setProperty('--md-sys-color-primary', '#D0BCFF');
      root.style.setProperty('--md-sys-color-on-primary', '#381E72');
      root.style.setProperty('--md-sys-color-primary-container', '#4F378B');
      root.style.setProperty('--md-sys-color-on-primary-container', '#EADDFF');
      root.style.setProperty('--md-sys-color-secondary', '#CCC2DC');
      root.style.setProperty('--md-sys-color-on-secondary', '#332D41');
      root.style.setProperty('--md-sys-color-surface', '#141218');
      root.style.setProperty('--md-sys-color-on-surface', '#E6E0E9');
      root.style.setProperty('--md-sys-color-surface-container', '#1D1B20');
      root.style.setProperty('--md-sys-color-surface-variant', '#49454F');
      root.style.setProperty('--md-sys-color-on-surface-variant', '#CAC4D0');
      root.style.setProperty('--md-sys-color-outline', '#938F99');
      root.style.setProperty('--md-sys-color-outline-variant', '#49454F');
      root.style.setProperty('--md-sys-color-background', '#141218');
      root.style.setProperty('--md-sys-color-on-background', '#E6E0E9');
    } else {
      root.classList.remove('dark');
      root.style.setProperty('--md-sys-color-primary', seedColor);
      root.style.setProperty('--md-sys-color-on-primary', '#FFFFFF');
      root.style.setProperty('--md-sys-color-primary-container', '#EADDFF');
      root.style.setProperty('--md-sys-color-on-primary-container', '#21005D');
      root.style.setProperty('--md-sys-color-secondary', '#625B71');
      root.style.setProperty('--md-sys-color-on-secondary', '#FFFFFF');
      root.style.setProperty('--md-sys-color-surface', '#FEF7FF');
      root.style.setProperty('--md-sys-color-on-surface', '#1D1B20');
      root.style.setProperty('--md-sys-color-surface-container', '#F3EDF7');
      root.style.setProperty('--md-sys-color-surface-variant', '#E7E0EC');
      root.style.setProperty('--md-sys-color-on-surface-variant', '#49454F');
      root.style.setProperty('--md-sys-color-outline', '#79747E');
      root.style.setProperty('--md-sys-color-outline-variant', '#CAC4D0');
      root.style.setProperty('--md-sys-color-background', '#FEF7FF');
      root.style.setProperty('--md-sys-color-on-background', '#1D1B20');
    }
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
