import React, { useState } from 'react';

export const ApiPlayground: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'crypto' | 'transpile' | 'password' | 'compression' | 'rewriter'>('crypto');

  // State for Crypto demo
  const [cryptoInput, setCryptoInput] = useState('Bun is an all-in-one JavaScript runtime & toolkit.');
  const [cryptoHash, setCryptoHash] = useState('');
  const [cryptoDuration, setCryptoDuration] = useState<number | null>(null);

  // State for Transpile demo
  const [codeToTranspile, setCodeToTranspile] = useState('const Welcome: React.FC<{ name: string }> = ({ name }) => (\n  <div className="card">\n    <h1>Hello {name}!</h1>\n  </div>\n);');
  const [transpiledOutput, setTranspiledOutput] = useState('');
  const [transpileTime, setTranspileTime] = useState<number | null>(null);

  // State for Password demo
  const [passwordInput, setPasswordInput] = useState('super-secret-password-123');
  const [passwordHash, setPasswordHash] = useState('');
  const [passwordAlgo, setPasswordAlgo] = useState<'argon2id' | 'bcrypt'>('argon2id');
  const [passwordTime, setPasswordTime] = useState<number | null>(null);

  // State for Compression demo
  const [compressText, setCompressText] = useState('Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10));
  const [compressionRatio, setCompressionRatio] = useState<string | null>(null);

  // State for HTMLRewriter demo
  const [htmlInput, setHtmlInput] = useState('<div class="hero"><h1>Original Title</h1><p>Static body text</p></div>');
  const [htmlOutput, setHtmlOutput] = useState('');

  // 1. Run Web Crypto
  const runCrypto = async () => {
    const start = performance.now();
    const encoder = new TextEncoder();
    const data = encoder.encode(cryptoInput);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const end = performance.now();
    setCryptoHash(hashHex);
    setCryptoDuration(end - start);
  };

  // 2. Run Transpile
  const runTranspile = async () => {
    const start = performance.now();
    const res = await fetch('/api/transpile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: codeToTranspile, loader: 'tsx' }),
    });
    const result = await res.json();
    const end = performance.now();
    setTranspiledOutput(result.code);
    setTranspileTime(end - start);
  };

  // 3. Run Password
  const runPassword = async () => {
    const start = performance.now();
    const res = await fetch('/api/password/hash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput, algorithm: passwordAlgo }),
    });
    const result = await res.json();
    const end = performance.now();
    setPasswordHash(result.hash);
    setPasswordTime(end - start);
  };

  // 4. Run Compression
  const runCompression = async () => {
    const res = await fetch('/api/deflate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: compressText }),
    });
    const result = await res.json();
    setCompressionRatio(result.ratio);
  };

  // 5. Run HTMLRewriter
  const runHtmlRewriter = async () => {
    const res = await fetch('/api/html-rewriter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: htmlInput }),
    });
    const result = await res.json();
    setHtmlOutput(result.rewritten);
  };

  return (
    <section className="py-12 px-4 md:px-8 border-b border-[var(--md-sys-color-outline-variant)]">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--md-sys-color-on-surface)]">
            ⚡ Native Bun & Web Standard API Playground
          </h2>
          <p className="text-sm md:text-base text-[var(--md-sys-color-on-surface-variant)] mt-1">
            Execute real-time hardware-accelerated APIs running live on Bun's engine.
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-wrap gap-2 mb-6 border-b border-[var(--md-sys-color-outline-variant)] pb-3">
          {[
            { id: 'crypto', label: 'crypto.subtle (BoringSSL)' },
            { id: 'transpile', label: 'Bun.Transpiler (AST)' },
            { id: 'password', label: 'Bun.password (Argon2id/Bcrypt)' },
            { id: 'compression', label: 'Bun.deflateSync (SIMD)' },
            { id: 'rewriter', label: 'HTMLRewriter (Streaming)' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] shadow-sm'
                  : 'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-variant)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Web Crypto */}
        {activeTab === 'crypto' && (
          <div className="p-6 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-4">
            <h3 className="text-lg font-bold text-[var(--md-sys-color-on-surface)] flex items-center justify-between">
              <span>Web Standards: crypto.subtle.digest("SHA-256")</span>
              {cryptoDuration !== null && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                  {cryptoDuration.toFixed(3)} ms
                </span>
              )}
            </h3>
            <textarea
              value={cryptoInput}
              onChange={e => setCryptoInput(e.target.value)}
              rows={2}
              className="w-full p-3 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface)] font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[var(--md-sys-color-primary)]"
              placeholder="Enter text to hash..."
            />
            <div className="flex items-center justify-between">
              <button
                onClick={runCrypto}
                className="px-5 py-2.5 rounded-full text-xs font-bold bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 transition shadow-sm"
              >
                Execute Digest
              </button>
            </div>
            {cryptoHash && (
              <div className="p-3 rounded-xl bg-black/40 border border-white/10 font-mono text-xs text-emerald-400 break-all">
                <span className="text-gray-500 select-none">SHA-256: </span>{cryptoHash}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Transpile */}
        {activeTab === 'transpile' && (
          <div className="p-6 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-4">
            <h3 className="text-lg font-bold text-[var(--md-sys-color-on-surface)] flex items-center justify-between">
              <span>Bun.Transpiler (Native TSX/JSX Transpilation)</span>
              {transpileTime !== null && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                  {transpileTime.toFixed(2)} ms
                </span>
              )}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[var(--md-sys-color-on-surface-variant)] block mb-1">TypeScript / TSX Input</label>
                <textarea
                  value={codeToTranspile}
                  onChange={e => setCodeToTranspile(e.target.value)}
                  rows={6}
                  className="w-full p-3 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface)] font-mono text-xs focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--md-sys-color-on-surface-variant)] block mb-1">Transpiled JavaScript Output</label>
                <textarea
                  value={transpiledOutput}
                  readOnly
                  rows={6}
                  className="w-full p-3 rounded-xl bg-black/40 border border-white/10 text-emerald-300 font-mono text-xs focus:outline-none"
                  placeholder="Click transpile to execute..."
                />
              </div>
            </div>
            <button
              onClick={runTranspile}
              className="px-5 py-2.5 rounded-full text-xs font-bold bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 transition shadow-sm"
            >
              Transpile in Microseconds
            </button>
          </div>
        )}

        {/* Tab 3: Password */}
        {activeTab === 'password' && (
          <div className="p-6 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-4">
            <h3 className="text-lg font-bold text-[var(--md-sys-color-on-surface)] flex items-center justify-between">
              <span>Bun.password.hash (Hardware Argon2id & Bcrypt)</span>
              {passwordTime !== null && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                  {passwordTime.toFixed(1)} ms
                </span>
              )}
            </h3>
            <div className="flex gap-4">
              <input
                type="text"
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                className="flex-1 p-3 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface)] font-mono text-sm"
                placeholder="Password to hash..."
              />
              <select
                value={passwordAlgo}
                onChange={e => setPasswordAlgo(e.target.value as any)}
                className="p-3 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface)] text-sm font-semibold"
              >
                <option value="argon2id">Argon2id (SIMD)</option>
                <option value="bcrypt">Bcrypt</option>
              </select>
            </div>
            <button
              onClick={runPassword}
              className="px-5 py-2.5 rounded-full text-xs font-bold bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 transition shadow-sm"
            >
              Hash Password
            </button>
            {passwordHash && (
              <div className="p-3 rounded-xl bg-black/40 border border-white/10 font-mono text-xs text-emerald-400 break-all">
                {passwordHash}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Compression */}
        {activeTab === 'compression' && (
          <div className="p-6 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-4">
            <h3 className="text-lg font-bold text-[var(--md-sys-color-on-surface)]">
              Bun.deflateSync (SIMD libdeflate Engine)
            </h3>
            <textarea
              value={compressText}
              onChange={e => setCompressText(e.target.value)}
              rows={3}
              className="w-full p-3 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface)] font-mono text-xs"
            />
            <button
              onClick={runCompression}
              className="px-5 py-2.5 rounded-full text-xs font-bold bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 transition shadow-sm"
            >
              Compress Data
            </button>
            {compressionRatio && (
              <div className="p-3 rounded-xl bg-black/40 border border-white/10 font-mono text-sm text-emerald-400">
                Compression Result: {compressionRatio}
              </div>
            )}
          </div>
        )}

        {/* Tab 5: HTMLRewriter */}
        {activeTab === 'rewriter' && (
          <div className="p-6 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] space-y-4">
            <h3 className="text-lg font-bold text-[var(--md-sys-color-on-surface)]">
              Web Standards: HTMLRewriter (Cloudflare lol-html Streaming Parser)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-[var(--md-sys-color-on-surface-variant)] block mb-1">Incoming HTML Stream</label>
                <textarea
                  value={htmlInput}
                  onChange={e => setHtmlInput(e.target.value)}
                  rows={4}
                  className="w-full p-3 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-on-surface)] font-mono text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-[var(--md-sys-color-on-surface-variant)] block mb-1">Rewritten Stream (Injected M3 Meta & Tokens)</label>
                <textarea
                  value={htmlOutput}
                  readOnly
                  rows={4}
                  className="w-full p-3 rounded-xl bg-black/40 border border-white/10 text-emerald-300 font-mono text-xs"
                  placeholder="Click rewrite to execute..."
                />
              </div>
            </div>
            <button
              onClick={runHtmlRewriter}
              className="px-5 py-2.5 rounded-full text-xs font-bold bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] hover:opacity-90 transition shadow-sm"
            >
              Transform Stream via HTMLRewriter
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
