import React, { useState } from 'react';
import type { CodebaseAnalysis } from '../core/types';

interface CodebaseExplorerProps {
  analysis: CodebaseAnalysis | null;
}

export const CodebaseExplorer: React.FC<CodebaseExplorerProps> = ({ analysis }) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredApis = (analysis?.bunApis || []).filter(api => {
    const matchSearch = api.name.toLowerCase().includes(search.toLowerCase()) ||
      api.description.toLowerCase().includes(search.toLowerCase()) ||
      api.signature.toLowerCase().includes(search.toLowerCase());
    const matchCategory = selectedCategory === 'all' || api.category === selectedCategory;
    return matchSearch && matchCategory;
  });

  return (
    <section className="py-12 px-4 md:px-8 border-b border-[var(--md-sys-color-outline-variant)]">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <span className="text-xs uppercase font-bold tracking-widest text-[var(--md-sys-color-primary)]">
            Recursive Monorepo Architecture
          </span>
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--md-sys-color-on-surface)] mt-1">
            🔍 Codebase, Types & Package Graph
          </h2>
          <p className="text-sm md:text-base text-[var(--md-sys-color-on-surface-variant)] mt-1">
            Real-time catalog generated recursively across our forks, bun-types, and native C++/Rust bindings.
          </p>
        </div>

        {/* Monorepo Speedup Table */}
        <div className="overflow-x-auto rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-sm">
          <table className="w-full text-left text-xs md:text-sm">
            <thead className="border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-variant)]/40 text-[var(--md-sys-color-on-surface)]">
              <tr>
                <th className="py-3 px-4 font-bold">Fork / Monorepo Package</th>
                <th className="py-3 px-4 font-bold">Version</th>
                <th className="py-3 px-4 font-bold">Build Duration</th>
                <th className="py-3 px-4 font-bold">Native Web Standard Features</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface-variant)]">
              {(analysis?.packages || []).map(pkg => (
                <tr key={pkg.name} className="hover:bg-[var(--md-sys-color-surface-variant)]/20 transition">
                  <td className="py-3 px-4 font-mono font-bold text-[var(--md-sys-color-on-surface)]">
                    {pkg.name}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs">{pkg.version}</td>
                  <td className="py-3 px-4 font-mono font-bold text-emerald-400">{pkg.speedup}</td>
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {pkg.webFeatures.map(wf => (
                        <span key={wf} className="px-2 py-0.5 rounded text-[10px] font-mono bg-black/30 border border-white/10 text-emerald-300">
                          {wf}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Search & Filter Bun APIs */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h3 className="text-xl font-bold text-[var(--md-sys-color-on-surface)]">
              Native Bun & Web Standard API Catalog ({filteredApis.length})
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Search APIs, types, signatures..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="px-4 py-2 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--md-sys-color-primary)] w-64"
              />
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface)] text-xs font-semibold focus:outline-none"
              >
                <option value="all">All Categories</option>
                <option value="runtime">Runtime</option>
                <option value="web-standards">Web Standards</option>
                <option value="crypto">Crypto</option>
                <option value="streams">Streams</option>
                <option value="io">I/O</option>
                <option value="bundler">Bundler</option>
                <option value="ffi">FFI</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredApis.map(api => (
              <div
                key={api.id}
                className="p-5 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] hover:border-[var(--md-sys-color-primary)] transition space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-sm text-[var(--md-sys-color-primary)]">
                    {api.name}
                  </span>
                  <div className="flex gap-1.5">
                    {api.isWebStandard && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-950/60 text-blue-400 border border-blue-800/40">
                        Web Standard
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-[var(--md-sys-color-surface-variant)] text-[var(--md-sys-color-on-surface-variant)]">
                      {api.category}
                    </span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 font-mono text-xs text-gray-300 break-all select-all">
                  {api.signature}
                </div>

                <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] leading-relaxed">
                  {api.description}
                </p>

                {api.nativeCMethod && (
                  <div className="text-[10px] font-mono text-[var(--md-sys-color-outline)]">
                    <span className="text-gray-500">Native Binding: </span>{api.nativeCMethod}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
