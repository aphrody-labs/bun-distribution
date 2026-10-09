// SPDX-License-Identifier: Apache-2.0
import React, { useState } from 'react';
import { TEMPLATES, type TemplateDefinition, type TemplateFile } from './templates-data';

export const TemplatesExplorer: React.FC = () => {
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDefinition>(TEMPLATES[0]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const activeFile: TemplateFile | undefined = selectedTemplate.files[activeFileIndex] || selectedTemplate.files[0];

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold tracking-wider uppercase text-[var(--md-sys-color-primary)]">
          Monorepo Templates & Scaffolding
        </span>
        <h2 className="text-3xl font-black text-[var(--md-sys-color-on-surface)]">
          Production Starters & Framework Templates
        </h2>
        <p className="text-[var(--md-sys-color-on-surface-variant)] text-sm max-w-2xl">
          Unified architectures for Bun microservices, Tauri 3 native desktop apps, Elysia/Hono edge APIs, and Material 3 React frontends. Ready for immediate creation via Bun CLI.
        </p>
      </div>

      {/* Template Card Selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TEMPLATES.map(tpl => {
          const isSelected = selectedTemplate.id === tpl.id;
          return (
            <button
              key={tpl.id}
              onClick={() => {
                setSelectedTemplate(tpl);
                setActiveFileIndex(0);
              }}
              className={`p-5 rounded-3xl text-left border transition-all duration-200 flex flex-col justify-between gap-4 ${
                isSelected
                  ? 'bg-[var(--md-sys-color-primary-container)] border-[var(--md-sys-color-primary)] shadow-md'
                  : 'bg-[var(--md-sys-color-surface-container)] border-[var(--md-sys-color-outline-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className={`text-lg font-bold ${
                    isSelected
                      ? 'text-[var(--md-sys-color-on-primary-container)]'
                      : 'text-[var(--md-sys-color-on-surface)]'
                  }`}>
                    {tpl.name}
                  </h3>
                  {isSelected && (
                    <span className="w-2.5 h-2.5 rounded-full bg-[var(--md-sys-color-primary)]" />
                  )}
                </div>
                <p className={`text-xs line-clamp-2 ${
                  isSelected
                    ? 'text-[var(--md-sys-color-on-primary-container)]/80'
                    : 'text-[var(--md-sys-color-on-surface-variant)]'
                }`}>
                  {tpl.tagline}
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {tpl.tags.slice(0, 3).map(tag => (
                  <span
                    key={tag}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail & Code Explorer */}
      <div className="rounded-3xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] overflow-hidden shadow-sm flex flex-col">
        {/* Detail Top Bar */}
        <div className="p-6 border-b border-[var(--md-sys-color-outline-variant)] flex flex-wrap items-center justify-between gap-4 bg-[var(--md-sys-color-surface-container)]">
          <div className="flex flex-col gap-1">
            <h3 className="text-xl font-bold text-[var(--md-sys-color-on-surface)]">
              {selectedTemplate.name}
            </h3>
            <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] max-w-xl">
              {selectedTemplate.description}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] font-mono text-xs text-[var(--md-sys-color-on-surface)]">
              <span>{selectedTemplate.cliCommand}</span>
              <button
                onClick={() => handleCopy(selectedTemplate.cliCommand, 'cli')}
                className="text-[var(--md-sys-color-primary)] hover:underline font-bold ml-1"
              >
                {copied === 'cli' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        {/* File Tabs & Code Area */}
        <div className="flex flex-col">
          {/* File Tabs */}
          <div className="flex items-center gap-2 px-6 pt-3 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)] overflow-x-auto">
            {selectedTemplate.files.map((file, idx) => {
              const isActive = idx === activeFileIndex;
              return (
                <button
                  key={file.path}
                  onClick={() => setActiveFileIndex(idx)}
                  className={`px-4 py-2 text-xs font-mono font-semibold rounded-t-xl transition-colors border-t border-x ${
                    isActive
                      ? 'bg-[#1e1e1e] text-white border-transparent'
                      : 'bg-transparent text-[var(--md-sys-color-on-surface-variant)] border-transparent hover:text-[var(--md-sys-color-on-surface)]'
                  }`}
                >
                  {file.name}
                </button>
              );
            })}
          </div>

          {/* Code Viewer */}
          <div className="relative bg-[#1e1e1e] p-6 font-mono text-xs text-gray-200 overflow-x-auto min-h-[320px]">
            <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
              <span className="text-[10px] text-gray-400 uppercase tracking-widest">
                {activeFile?.language || 'text'}
              </span>
              <button
                onClick={() => handleCopy(activeFile?.content || '', 'code')}
                className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-sans font-semibold transition-colors"
              >
                {copied === 'code' ? 'Copied!' : 'Copy File'}
              </button>
            </div>

            <pre className="leading-relaxed">
              <code>{activeFile?.content}</code>
            </pre>
          </div>
        </div>

        {/* Dependencies Bottom Bar */}
        {Object.keys(selectedTemplate.dependencies).length > 0 && (
          <div className="p-4 bg-[var(--md-sys-color-surface-container)] border-t border-[var(--md-sys-color-outline-variant)] flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase mr-2">
              Dependencies:
            </span>
            {Object.entries(selectedTemplate.dependencies).map(([dep, ver]) => (
              <span
                key={dep}
                className="font-mono text-xs px-2.5 py-1 rounded-lg bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-on-surface)]"
              >
                {dep} <span className="text-[var(--md-sys-color-primary)] font-semibold">{ver}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
