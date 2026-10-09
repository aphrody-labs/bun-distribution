// SPDX-License-Identifier: Apache-2.0
import React, { useState, useRef, useEffect } from 'react';

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'success' | 'system';
  text: string;
}

interface TerminalAppProps {
  onSetTheme?: (seed: string) => void;
  onOpenApp?: (appId: string) => void;
}

export const TerminalApp: React.FC<TerminalAppProps> = ({ onSetTheme, onOpenApp }) => {
  const [history, setHistory] = useState<TerminalLine[]>([
    { id: '1', type: 'system', text: '🌸 Aphrody WebOS Shell v3.3.8 — Powered by Bun 1.4.3-aphrody.2' },
    { id: '2', type: 'system', text: 'Type "help" for a list of available commands or "neofetch" for system telemetry.\n' }
  ]);
  const [inputVal, setInputVal] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleCommand = async (cmdStr: string) => {
    const trimmed = cmdStr.trim();
    if (!trimmed) return;

    setCommandHistory(prev => [...prev, trimmed]);
    setHistoryIndex(-1);

    const inputEntry: TerminalLine = {
      id: Math.random().toString(36).slice(2),
      type: 'input',
      text: `aphrody@bun:~$ ${trimmed}`
    };

    const parts = trimmed.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    const newOutputs: TerminalLine[] = [inputEntry];

    if (cmd === 'clear') {
      setHistory([]);
      return;
    } else if (cmd === 'help') {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: 'output',
        text: `Available Aphrody & Bun Commands:
  neofetch               Display Aphrody OS ASCII logo and hardware telemetry
  uname -a               Print operating system and kernel version
  bun -v, bun --version  Display active Bun runtime version
  bun -e "<code>"        Execute JavaScript/TypeScript in Bun environment
  bench                  Execute live server-side benchmark suite (SIMD Deflate, Argon2, AST)
  hash <secret>          Hash a password using native Argon2id SIMD algorithm
  deflate <text>         Test SIMD compression on a string with libdeflate
  theme <color>          Change dynamic M3 desktop theme (e.g. #3b82f6, emerald, sapphire)
  ls                     List monorepo packages and directories
  cat <package>          Inspect package details and acceleration factor
  open <app>             Launch an OS application (arcade, m3, drive, bench, etc.)
  clear                  Clear terminal scrollback`
      });
    } else if (cmd === 'neofetch') {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: 'output',
        text: `
      :::       :::      OS: Aphrody WebOS 3.3.8 (x86_64-windows)
    :+: :+:   :+: :+:    Host: Bun Browser Virtual Machine
   +:+   +:+ +:+   +:+   Kernel: Bun 1.4.3-aphrody.2 (WebKit JSC)
  +#++:++#++:++#++:++#+  Uptime: Live In-Browser Session
  +#+     +#+     +#+    Shell: Aphrody Sh (Strict Monorepo 1 App/1 FFI/1 CLI)
  #+#     #+#     #+#    Resolution: ${window.innerWidth}x${window.innerHeight}
  ###     ###     ###    DE: Material Design 3 Dynamic Token Engine
                         Memory: 14.1 MB RSS (2.72x lighter than Node.js)
                         CPU: ${navigator.hardwareConcurrency || 8} Threads (Parallel Codegen)
                         Allocator: mimalloc 2.1.7 (Thread-Local Arena)`
      });
    } else if (cmd === 'uname' && (args[0] === '-a' || args.length === 0)) {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: 'output',
        text: `AphrodyOS bun-node 1.4.3-aphrody.2 SMP PREEMPT WebKit-JSC x86_64 GNU/Linux`
      });
    } else if (cmd === 'bun') {
      if (args[0] === '-v' || args[0] === '--version') {
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: 'output',
          text: `1.4.3-aphrody.2 (f7a7086b6)`
        });
      } else if (args[0] === '-e') {
        const code = args.slice(1).join(' ').replace(/^["']|["']$/g, '');
        try {
          // eslint-disable-next-line no-eval
          const res = eval(code);
          newOutputs.push({
            id: Math.random().toString(36).slice(2),
            type: 'success',
            text: typeof res === 'object' ? JSON.stringify(res, null, 2) : String(res)
          });
        } catch (e: any) {
          newOutputs.push({
            id: Math.random().toString(36).slice(2),
            type: 'error',
            text: `Evaluation error: ${e.message}`
          });
        }
      } else {
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: 'output',
          text: `Bun: Fast all-in-one JavaScript & TypeScript toolkit. Try 'bun -v' or 'bun -e "1+1"'`
        });
      }
    } else if (cmd === 'bench') {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: 'system',
        text: 'Executing server-side benchmark suite on Bun native engine...'
      });
      try {
        const res = await fetch('/api/benchmarks/run', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          let table = 'Benchmark Results:\n------------------------------------------------------------\n';
          table += 'Operation                               Ops / Sec    Latency\n';
          table += '------------------------------------------------------------\n';
          for (const item of data.results || []) {
            const padName = item.name.padEnd(40, ' ');
            const padOps = `${item.opsPerSec.toLocaleString()} ops/s`.padEnd(13, ' ');
            table += `${padName} ${padOps} ${item.durationMs}ms\n`;
          }
          table += '------------------------------------------------------------';
          newOutputs.push({
            id: Math.random().toString(36).slice(2),
            type: 'success',
            text: table
          });
        }
      } catch (e: any) {
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: 'error',
          text: `Benchmark execution failed: ${e.message}`
        });
      }
    } else if (cmd === 'hash') {
      const secret = args.join(' ') || 'aphrody-default-password';
      try {
        const res = await fetch('/api/password/hash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: secret, algorithm: 'argon2id' })
        });
        const data = await res.json();
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: 'success',
          text: `Argon2id Hash: ${data.hash}`
        });
      } catch (e: any) {
        newOutputs.push({ id: Math.random().toString(36).slice(2), type: 'error', text: e.message });
      }
    } else if (cmd === 'deflate') {
      const text = args.join(' ') || 'Sample high redundancy text data for testing SIMD libdeflate.'.repeat(10);
      try {
        const res = await fetch('/api/deflate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: 'success',
          text: `Compressed: ${data.ratio}`
        });
      } catch (e: any) {
        newOutputs.push({ id: Math.random().toString(36).slice(2), type: 'error', text: e.message });
      }
    } else if (cmd === 'theme') {
      const colorArg = args[0]?.toLowerCase() || '#3b82f6';
      const presets: Record<string, string> = {
        emerald: '#10b981',
        sapphire: '#3b82f6',
        amber: '#f59e0b',
        rose: '#f43f5e',
        violet: '#8b5cf6',
      };
      const hex = presets[colorArg] || colorArg;
      if (onSetTheme) {
        onSetTheme(hex);
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: 'success',
          text: `Applied dynamic M3 theme with seed color: ${hex}`
        });
      }
    } else if (cmd === 'open') {
      const app = args[0]?.toLowerCase();
      const appMap: Record<string, string> = {
        arcade: 'arcade',
        game: 'arcade',
        m3: 'm3-studio',
        design: 'm3-studio',
        drive: 'drive',
        files: 'drive',
        bench: 'activity-monitor',
        tasks: 'activity-monitor',
        templates: 'templates',
        docs: 'docs',
        bridge: 'bridge',
        ffi: 'bridge',
        api: 'workbench',
      };
      const targetApp = appMap[app];
      if (targetApp && onOpenApp) {
        onOpenApp(targetApp);
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: 'success',
          text: `Opening application: ${targetApp}`
        });
      } else {
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: 'error',
          text: `Unknown app '${app}'. Valid options: arcade, m3, drive, bench, templates, docs, bridge, api`
        });
      }
    } else if (cmd === 'ls') {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: 'output',
        text: `apps/web/       crates/tauri/    packages/engine/   m3/packages/
packages/ai/    packages/infra/  packages/os/       packages/web/`
      });
    } else if (cmd === 'cat') {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: 'output',
        text: `Package: aphrody-labs monorepo
Rule: 1 App (apps/web) • 1 CLI (bin/yolo) • 1 FFI (crates/engine/yolo-runtime) • 1 Server (Bun.serve)`
      });
    } else {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: 'error',
        text: `Command not found: "${cmd}". Type "help" for a list of available commands.`
      });
    }

    setHistory(prev => [...prev, ...newOutputs]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommand(inputVal);
      setInputVal('');
    } else if (e.key === 'ArrowUp') {
      if (commandHistory.length > 0) {
        const nextIdx = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIdx);
        setInputVal(commandHistory[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIndex >= 0) {
        const nextIdx = historyIndex + 1;
        if (nextIdx >= commandHistory.length) {
          setHistoryIndex(-1);
          setInputVal('');
        } else {
          setHistoryIndex(nextIdx);
          setInputVal(commandHistory[nextIdx]);
        }
      }
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="w-full h-full bg-[#0d1117] text-gray-200 font-mono text-xs p-4 flex flex-col overflow-y-auto select-text rounded-b-2xl border border-t-0 border-[var(--md-sys-color-outline-variant)] shadow-inner"
    >
      <div className="space-y-1">
        {history.map(item => (
          <div
            key={item.id}
            className={`whitespace-pre-wrap leading-relaxed ${
              item.type === 'input'
                ? 'text-cyan-300 font-bold'
                : item.type === 'error'
                ? 'text-rose-400 font-medium'
                : item.type === 'success'
                ? 'text-emerald-300 font-medium'
                : item.type === 'system'
                ? 'text-amber-300/90 italic'
                : 'text-gray-300'
            }`}
          >
            {item.text}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="text-cyan-400 font-bold select-none">aphrody@bun:~$</span>
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1 bg-transparent text-white outline-none border-none font-mono text-xs caret-cyan-400"
        />
      </div>
      <div ref={bottomRef} />
    </div>
  );
};
