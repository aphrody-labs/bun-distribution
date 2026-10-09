// SPDX-License-Identifier: Apache-2.0
import React, { useState, useMemo } from 'react';

interface TableRowItem {
  id: string;
  package: string;
  speedup: string;
  status: 'optimized' | 'verified';
  allocator: string;
  latencyMs: number;
}

export const M3Showcase: React.FC = () => {
  const [sliderVal, setSliderVal] = useState(16);
  const [switchState, setSwitchState] = useState(true);
  const [checkboxState, setCheckboxState] = useState(true);
  const [radioSelected, setRadioSelected] = useState('thin-lto');
  const [activeChip, setActiveChip] = useState('bun');
  const [showSnackbar, setShowSnackbar] = useState(false);
  const [searchTableQuery, setSearchTableQuery] = useState('');
  const [sortField, setSortField] = useState<keyof TableRowItem>('latencyMs');
  const [sortAsc, setSortAsc] = useState(true);

  const triggerSnackbar = (msg?: string) => {
    setShowSnackbar(true);
    setTimeout(() => setShowSnackbar(false), 2500);
  };

  const sampleData: TableRowItem[] = [
    { id: '1', package: '@tailwindcss/oxide', speedup: '54.6x', status: 'verified', allocator: 'mimalloc', latencyMs: 62.6 },
    { id: '2', package: 'next-canary-bun', speedup: '57.7x', status: 'verified', allocator: 'mimalloc', latencyMs: 1950 },
    { id: '3', package: '@base-ui/react', speedup: '23.8x', status: 'verified', allocator: 'mimalloc', latencyMs: 1610 },
    { id: '4', package: 'aphrody-tauri-ipc', speedup: '42.0x', status: 'verified', allocator: 'mimalloc', latencyMs: 0.12 },
    { id: '5', package: 'aphrody-m3-engine', speedup: '38.5x', status: 'verified', allocator: 'mimalloc', latencyMs: 92.2 },
    { id: '6', package: 'yolo-runtime-ffi', speedup: '64.2x', status: 'verified', allocator: 'mimalloc', latencyMs: 0.05 },
    { id: '7', package: '@aphrody/bun-plugin-tailwind', speedup: '50.1x', status: 'verified', allocator: 'mimalloc', latencyMs: 14.8 },
  ];

  const filteredData = useMemo(() => {
    const q = searchTableQuery.toLowerCase();
    const list = sampleData.filter(item =>
      item.package.toLowerCase().includes(q) ||
      item.speedup.toLowerCase().includes(q) ||
      item.allocator.toLowerCase().includes(q)
    );
    return list.sort((a, b) => {
      const vA = a[sortField];
      const vB = b[sortField];
      if (typeof vA === 'number' && typeof vB === 'number') {
        return sortAsc ? vA - vB : vB - vA;
      }
      return sortAsc ? String(vA).localeCompare(String(vB)) : String(vB).localeCompare(String(vA));
    });
  }, [searchTableQuery, sortField, sortAsc]);

  return (
    <section className="py-6 flex flex-col gap-8 w-full max-w-6xl mx-auto">
      {/* Title */}
      <div>
        <span className="text-xs font-bold tracking-wider uppercase text-[var(--md-sys-color-primary)]">
          Design System & UI Primitives
        </span>
        <h2 className="text-3xl font-black text-[var(--md-sys-color-on-surface)] mt-1">
          Material Design 3 Component Architecture
        </h2>
        <p className="text-xs md:text-sm text-[var(--md-sys-color-on-surface-variant)] mt-1 max-w-2xl">
          Rendered with dynamic M3 design tokens, state layers, elevation surfaces, fluid typography, and virtualized data table.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Card 1: Buttons & Actions */}
        <div className="p-6 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-sm space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--md-sys-color-primary)]">
            Buttons & FABs
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => triggerSnackbar()}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] shadow hover:shadow-md transition active:scale-95"
            >
              Filled Button
            </button>
            <button
              onClick={() => triggerSnackbar()}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)] hover:bg-[var(--md-sys-color-secondary)]/20 transition active:scale-95"
            >
              Tonal Button
            </button>
            <button
              onClick={() => triggerSnackbar()}
              className="px-4 py-2 rounded-full text-xs font-semibold border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-primary)] hover:bg-[var(--md-sys-color-primary)]/10 transition active:scale-95"
            >
              Outlined
            </button>
            <button
              onClick={() => triggerSnackbar()}
              className="px-4 py-2 rounded-full text-xs font-semibold text-[var(--md-sys-color-primary)] hover:bg-[var(--md-sys-color-primary)]/10 transition"
            >
              Text Button
            </button>
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              onClick={() => triggerSnackbar()}
              className="w-11 h-11 rounded-2xl bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] flex items-center justify-center text-lg shadow-md hover:shadow-lg transition active:scale-90"
              title="Floating Action Button"
            >
              ✨
            </button>
            <button
              onClick={() => triggerSnackbar()}
              className="px-4 py-2.5 rounded-2xl bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)] font-semibold text-xs flex items-center gap-2 shadow-md hover:shadow-lg transition active:scale-95"
            >
              <span>🚀</span> Extended FAB
            </button>
          </div>
        </div>

        {/* Card 2: Interactive Controls */}
        <div className="p-6 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-sm space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--md-sys-color-primary)]">
            Selection & Input Controls
          </h3>

          {/* Switch */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--md-sys-color-on-surface)]">
              Bun Native Web Streams
            </span>
            <button
              onClick={() => setSwitchState(!switchState)}
              className={`w-12 h-6 rounded-full p-0.5 transition duration-200 ease-in-out ${
                switchState ? 'bg-[var(--md-sys-color-primary)]' : 'bg-[var(--md-sys-color-surface-variant)]'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-[var(--md-sys-color-on-primary)] transition duration-200 transform ${
                  switchState ? 'translate-x-6' : 'translate-x-0'
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
              HTMLRewriter SSR Streaming
            </span>
          </div>

          {/* Radio Group */}
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="lto"
                checked={radioSelected === 'thin-lto'}
                onChange={() => setRadioSelected('thin-lto')}
                className="accent-[var(--md-sys-color-primary)]"
              />
              <span className="text-[var(--md-sys-color-on-surface)]">Thin LTO</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="lto"
                checked={radioSelected === 'fat-lto'}
                onChange={() => setRadioSelected('fat-lto')}
                className="accent-[var(--md-sys-color-primary)]"
              />
              <span className="text-[var(--md-sys-color-on-surface)]">Full LTO</span>
            </label>
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

        {/* Card 3: Chips & Indicators */}
        <div className="p-6 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-sm space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--md-sys-color-primary)]">
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
              <span>Build Acceleration Ratio</span>
              <span className="font-bold text-emerald-400">54.6x</span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--md-sys-color-surface-variant)] overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[var(--md-sys-color-primary)] to-emerald-400 rounded-full w-[96%]" />
            </div>
          </div>
        </div>
      </div>

      {/* M3 High-Performance Data Table */}
      <div className="rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] overflow-hidden shadow-sm flex flex-col">
        {/* Table Toolbar */}
        <div className="p-4 border-b border-[var(--md-sys-color-outline-variant)] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-[var(--md-sys-color-on-surface)]">
              Monorepo Accelerated Packages
            </span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] font-semibold">
              {filteredData.length} active
            </span>
          </div>

          <input
            type="text"
            value={searchTableQuery}
            onChange={e => setSearchTableQuery(e.target.value)}
            placeholder="Filter packages or allocators..."
            className="px-3 py-1.5 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-xs text-[var(--md-sys-color-on-surface)] focus:outline-none focus:border-[var(--md-sys-color-primary)] w-64"
          />
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] uppercase font-mono text-[10px]">
              <tr>
                <th
                  onClick={() => { setSortField('package'); setSortAsc(!sortAsc); }}
                  className="p-3 cursor-pointer hover:text-[var(--md-sys-color-primary)]"
                >
                  Package {sortField === 'package' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => { setSortField('speedup'); setSortAsc(!sortAsc); }}
                  className="p-3 cursor-pointer hover:text-[var(--md-sys-color-primary)]"
                >
                  Speedup {sortField === 'speedup' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => { setSortField('latencyMs'); setSortAsc(!sortAsc); }}
                  className="p-3 cursor-pointer hover:text-[var(--md-sys-color-primary)]"
                >
                  Latency {sortField === 'latencyMs' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th className="p-3">Allocator</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--md-sys-color-outline-variant)]">
              {filteredData.map(row => (
                <tr key={row.id} className="hover:bg-[var(--md-sys-color-surface-container-highest)]/50 transition-colors">
                  <td className="p-3 font-mono font-semibold text-[var(--md-sys-color-on-surface)]">
                    {row.package}
                  </td>
                  <td className="p-3 font-bold text-emerald-400">
                    {row.speedup}
                  </td>
                  <td className="p-3 font-mono text-[var(--md-sys-color-on-surface-variant)]">
                    {row.latencyMs < 1 ? `${(row.latencyMs * 1000).toFixed(0)}µs` : `${row.latencyMs}ms`}
                  </td>
                  <td className="p-3 font-mono text-[var(--md-sys-color-primary)]">
                    {row.allocator}
                  </td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floating Snackbar */}
      {showSnackbar && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-2xl bg-[var(--md-sys-color-on-surface)] text-[var(--md-sys-color-surface)] shadow-2xl flex items-center gap-3 animate-bounce">
          <span>🚀</span>
          <span className="text-xs font-semibold">Material 3 action dispatched via Bun engine!</span>
        </div>
      )}
    </section>
  );
};
