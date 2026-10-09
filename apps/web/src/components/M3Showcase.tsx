import React, { useState } from 'react';

export const M3Showcase: React.FC = () => {
  const [sliderVal, setSliderVal] = useState(65);
  const [switchState, setSwitchState] = useState(true);
  const [checkboxState, setCheckboxState] = useState(true);
  const [activeChip, setActiveChip] = useState('react');
  const [showSnackbar, setShowSnackbar] = useState(false);

  const triggerSnackbar = () => {
    setShowSnackbar(true);
    setTimeout(() => setShowSnackbar(false), 3000);
  };

  return (
    <section className="py-12 px-4 md:px-8 border-b border-[var(--md-sys-color-outline-variant)]">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <span className="text-xs uppercase font-bold tracking-widest text-[var(--md-sys-color-primary)]">
            Design System
          </span>
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--md-sys-color-on-surface)] mt-1">
            🎨 Material Design 3 Component Architecture
          </h2>
          <p className="text-sm md:text-base text-[var(--md-sys-color-on-surface-variant)] mt-1">
            Rendered with dynamic M3 design tokens, state layers, elevation surfaces, and fluid typography.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1: Buttons & Actions */}
          <div className="p-6 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-sm space-y-4">
            <h3 className="text-base font-bold text-[var(--md-sys-color-on-surface)]">
              Buttons & FABs
            </h3>
            <div className="flex flex-wrap gap-2.5">
              <button className="px-5 py-2.5 rounded-full text-xs font-semibold bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] shadow hover:shadow-md transition active:scale-95">
                Filled Button
              </button>
              <button className="px-5 py-2.5 rounded-full text-xs font-semibold bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] hover:bg-[var(--md-sys-color-secondary)]/20 transition active:scale-95">
                Tonal Button
              </button>
              <button className="px-5 py-2.5 rounded-full text-xs font-semibold border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-primary)] hover:bg-[var(--md-sys-color-primary)]/10 transition active:scale-95">
                Outlined
              </button>
              <button className="px-5 py-2.5 rounded-full text-xs font-semibold text-[var(--md-sys-color-primary)] hover:bg-[var(--md-sys-color-primary)]/10 transition">
                Text Button
              </button>
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button 
                onClick={triggerSnackbar}
                className="w-12 h-12 rounded-2xl bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] flex items-center justify-center text-xl shadow-md hover:shadow-lg transition active:scale-90"
                title="Floating Action Button"
              >
                ✨
              </button>
              <button 
                onClick={triggerSnackbar}
                className="px-4 py-3 rounded-2xl bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)] font-semibold text-xs flex items-center gap-2 shadow-md hover:shadow-lg transition active:scale-95"
              >
                <span>🚀</span> Extended FAB
              </button>
            </div>
          </div>

          {/* Card 2: Interactive Controls */}
          <div className="p-6 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-sm space-y-4">
            <h3 className="text-base font-bold text-[var(--md-sys-color-on-surface)]">
              Selection & Input Controls
            </h3>
            
            {/* Switch */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--md-sys-color-on-surface)]">
                Bun Native Engine
              </span>
              <button
                onClick={() => setSwitchState(!switchState)}
                className={`w-12 h-7 rounded-full p-1 transition duration-200 ease-in-out ${
                  switchState ? 'bg-[var(--md-sys-color-primary)]' : 'bg-[var(--md-sys-color-surface-variant)]'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-[var(--md-sys-color-on-primary)] transition duration-200 transform ${
                    switchState ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Checkbox */}
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCheckboxState(!checkboxState)}>
              <div className={`w-5 h-5 rounded-md flex items-center justify-center border transition ${
                checkboxState ? 'bg-[var(--md-sys-color-primary)] border-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]' : 'border-[var(--md-sys-color-outline)]'
              }`}>
                {checkboxState && <span className="text-xs font-bold">✓</span>}
              </div>
              <span className="text-xs font-medium text-[var(--md-sys-color-on-surface)] select-none">
                Streaming SSR Enabled
              </span>
            </div>

            {/* Slider */}
            <div>
              <div className="flex justify-between text-xs text-[var(--md-sys-color-on-surface-variant)] mb-1">
                <span>Parallel Codegen Units</span>
                <span className="font-mono font-bold text-[var(--md-sys-color-primary)]">{sliderVal}</span>
              </div>
              <input
                type="range"
                min="1"
                max="256"
                value={sliderVal}
                onChange={e => setSliderVal(Number(e.target.value))}
                className="w-full accent-[var(--md-sys-color-primary)] cursor-pointer"
              />
            </div>
          </div>

          {/* Card 3: Chips & Badges */}
          <div className="p-6 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-sm space-y-4">
            <h3 className="text-base font-bold text-[var(--md-sys-color-on-surface)]">
              M3 Chips & Indicators
            </h3>
            
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'bun', label: '⚡ Bun Runtime' },
                { id: 'react', label: '⚛️ React 19' },
                { id: 'tailwind', label: '🌊 Tailwind v4' },
                { id: 'base-ui', label: '🧩 Base UI' },
                { id: 'tauri', label: '🦀 Tauri FFI' },
              ].map(chip => (
                <button
                  key={chip.id}
                  onClick={() => setActiveChip(chip.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                    activeChip === chip.id
                      ? 'bg-[var(--md-sys-color-secondary-container)] border-transparent text-[var(--md-sys-color-on-secondary-container)] font-bold'
                      : 'border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-variant)]'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Progress indicators */}
            <div className="space-y-2 pt-2">
              <div className="text-xs text-[var(--md-sys-color-on-surface-variant)] flex justify-between">
                <span>Build Acceleration Factor</span>
                <span className="font-bold text-emerald-400">50x</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--md-sys-color-surface-variant)] overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[var(--md-sys-color-primary)] to-emerald-400 rounded-full w-[95%]" />
              </div>
            </div>
          </div>
        </div>

        {/* M3 Floating Snackbar / Toast */}
        {showSnackbar && (
          <div className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-2xl bg-[var(--md-sys-color-on-surface)] text-[var(--md-sys-color-surface)] shadow-2xl flex items-center gap-3 animate-bounce">
            <span>🚀</span>
            <span className="text-xs font-semibold">Material 3 action dispatched via Bun engine!</span>
          </div>
        )}
      </div>
    </section>
  );
};
