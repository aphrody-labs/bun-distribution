// SPDX-License-Identifier: Apache-2.0
import React, { useState, useMemo } from 'react';
import { DOCS_ARTICLES, type DocArticle } from './docs-data';

export const DocsHub: React.FC = () => {
  const [selectedArticleId, setSelectedArticleId] = useState<string>(DOCS_ARTICLES[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    DOCS_ARTICLES.forEach(a => set.add(a.category));
    return Array.from(set);
  }, []);

  const filteredArticles = useMemo(() => {
    return DOCS_ARTICLES.filter(article => {
      const matchesCategory = activeCategory === 'All' || article.category === activeCategory;
      const q = searchQuery.toLowerCase();
      const matchesQuery =
        !q ||
        article.title.toLowerCase().includes(q) ||
        article.summary.toLowerCase().includes(q) ||
        article.tags.some(t => t.toLowerCase().includes(q)) ||
        article.content.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, searchQuery]);

  const selectedArticle = useMemo(() => {
    return DOCS_ARTICLES.find(a => a.id === selectedArticleId) || DOCS_ARTICLES[0];
  }, [selectedArticleId]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-bold tracking-wider uppercase text-[var(--md-sys-color-primary)]">
            Knowledge Base & Specifications
          </span>
          <h2 className="text-3xl font-black text-[var(--md-sys-color-on-surface)]">
            Aphrody Documentation Hub
          </h2>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search docs, APIs, architecture..."
            className="w-full px-4 py-2.5 rounded-full bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] text-sm text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none focus:border-[var(--md-sys-color-primary)]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-2.5 text-xs text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]'
                : 'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Main Layout: Sidebar & Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Article Navigation Sidebar */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          <span className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase px-2">
            Articles ({filteredArticles.length})
          </span>
          <div className="flex flex-col gap-2">
            {filteredArticles.map(art => {
              const isSelected = art.id === selectedArticle.id;
              return (
                <button
                  key={art.id}
                  onClick={() => setSelectedArticleId(art.id)}
                  className={`p-4 rounded-2xl text-left border transition-all duration-150 flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-[var(--md-sys-color-primary-container)] border-[var(--md-sys-color-primary)] shadow-sm'
                      : 'bg-[var(--md-sys-color-surface-container)] border-[var(--md-sys-color-outline-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--md-sys-color-primary)]">
                      {art.category}
                    </span>
                    <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)]">
                      {art.readTime}
                    </span>
                  </div>
                  <h4 className={`text-sm font-bold leading-snug ${
                    isSelected ? 'text-[var(--md-sys-color-on-primary-container)]' : 'text-[var(--md-sys-color-on-surface)]'
                  }`}>
                    {art.title}
                  </h4>
                  <p className={`text-xs line-clamp-2 ${
                    isSelected ? 'text-[var(--md-sys-color-on-primary-container)]/80' : 'text-[var(--md-sys-color-on-surface-variant)]'
                  }`}>
                    {art.summary}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Article Reader Pane */}
        <div className="lg:col-span-8 p-8 rounded-3xl bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] shadow-sm flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--md-sys-color-outline-variant)]">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
                {selectedArticle.category}
              </span>
              <span className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
                {selectedArticle.readTime}
              </span>
            </div>
            <button
              onClick={() => handleCopy(window.location.href, 'link')}
              className="text-xs font-semibold text-[var(--md-sys-color-primary)] hover:underline"
            >
              {copiedCode === 'link' ? 'Link Copied!' : 'Share Article'}
            </button>
          </div>

          <div>
            <h1 className="text-2xl md:text-3xl font-black text-[var(--md-sys-color-on-surface)] mb-2">
              {selectedArticle.title}
            </h1>
            <p className="text-sm text-[var(--md-sys-color-on-surface-variant)] italic">
              {selectedArticle.summary}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {selectedArticle.tags.map(t => (
              <span
                key={t}
                className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)] border border-[var(--md-sys-color-outline-variant)]"
              >
                #{t}
              </span>
            ))}
          </div>

          {/* Formatted Article Body */}
          <div className="prose max-w-none text-[var(--md-sys-color-on-surface)] space-y-4 text-sm leading-relaxed">
            {selectedArticle.content.split('\n\n').map((paragraph, idx) => {
              if (paragraph.startsWith('# ')) {
                return null; // Already rendered as title
              }
              if (paragraph.startsWith('## ')) {
                return (
                  <h3 key={idx} className="text-lg font-bold text-[var(--md-sys-color-on-surface)] pt-4 border-t border-[var(--md-sys-color-outline-variant)]">
                    {paragraph.replace('## ', '')}
                  </h3>
                );
              }
              if (paragraph.startsWith('```')) {
                const codeLines = paragraph.replace(/```[a-z]*\n?/g, '').trim();
                return (
                  <div key={idx} className="relative rounded-2xl bg-[#1e1e1e] p-4 font-mono text-xs text-gray-200 overflow-x-auto my-3">
                    <button
                      onClick={() => handleCopy(codeLines, `code-${idx}`)}
                      className="absolute top-2 right-2 px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-[10px] font-sans transition-colors"
                    >
                      {copiedCode === `code-${idx}` ? 'Copied!' : 'Copy'}
                    </button>
                    <pre><code>{codeLines}</code></pre>
                  </div>
                );
              }
              if (paragraph.startsWith('- ')) {
                const listItems = paragraph.split('\n').filter(Boolean);
                return (
                  <ul key={idx} className="list-disc pl-5 space-y-1.5 text-[var(--md-sys-color-on-surface-variant)]">
                    {listItems.map((li, liIdx) => (
                      <li key={liIdx}>{li.replace('- ', '')}</li>
                    ))}
                  </ul>
                );
              }
              return (
                <p key={idx} className="text-[var(--md-sys-color-on-surface-variant)]">
                  {paragraph}
                </p>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
