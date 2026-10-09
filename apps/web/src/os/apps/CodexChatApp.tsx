// SPDX-License-Identifier: Apache-2.0
import React, { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  codeSnippet?: {
    language: string;
    code: string;
  };
  timestamp: string;
}

interface CodexChatAppProps {
  onRunInTerminal?: (code: string) => void;
}

export const CodexChatApp: React.FC<CodexChatAppProps> = ({ onRunInTerminal }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'assistant',
      content: 'Hello! I am Aphrody Codex, your high-precision AI assistant powered by Bun and Rust native bindings. What would you like to build or inspect?',
      codeSnippet: {
        language: 'typescript',
        code: `// High-performance Web Streams transform in Bun
export function streamCss(stream: ReadableStream<Uint8Array>) {
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    }
  }));
}`
      },
      timestamp: 'Just now'
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [selectedModel, setSelectedModel] = useState('aphrody-local-7b');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isTyping) return;

    const userMsg: ChatMessage = {
      id: Math.random().toString(36).slice(2),
      sender: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);

    // Dynamic response generation based on user question
    setTimeout(() => {
      let replyContent = `Understood. Processing "${trimmed}" using ${selectedModel}.`;
      let snippet: { language: string; code: string } | undefined;

      const lower = trimmed.toLowerCase();
      if (lower.includes('bun') || lower.includes('serve') || lower.includes('http')) {
        replyContent = 'Here is how to deploy a native HTTP server with zero-copy streaming in Bun:';
        snippet = {
          language: 'typescript',
          code: `Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Aphrody WebOS active!", {
      headers: { "Content-Type": "text/plain" }
    });
  }
});`
        };
      } else if (lower.includes('crypto') || lower.includes('hash')) {
        replyContent = 'Using hardware-accelerated BoringSSL via native WebCrypto:';
        snippet = {
          language: 'typescript',
          code: `const hashBuffer = await crypto.subtle.digest(
  "SHA-256",
  new TextEncoder().encode("${trimmed}")
);
const hex = Buffer.from(hashBuffer).toString("hex");`
        };
      } else if (lower.includes('m3') || lower.includes('theme') || lower.includes('color')) {
        replyContent = 'Material Design 3 dynamic HCT color extraction algorithm:';
        snippet = {
          language: 'typescript',
          code: `import { applyM3Theme } from "./core/theme";
applyM3Theme("#8b5cf6", true); // Sets --md-sys-color-* on :root`
        };
      } else {
        replyContent = `Execution completed successfully. Monorepo rule verified: 1 App, 1 FFI, 1 CLI, 1 Server.`;
      }

      setMessages(prev => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2),
          sender: 'assistant',
          content: replyContent,
          codeSnippet: snippet,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
      setIsTyping(false);
    }, 600);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] text-xs select-text">
      {/* Top Model Bar */}
      <div className="p-3 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)] flex items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <span className="font-bold text-[var(--md-sys-color-on-surface)]">
            Aphrody Codex Assistant
          </span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            className="px-2.5 py-1 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)] text-[11px] font-semibold text-[var(--md-sys-color-on-surface)] outline-none"
          >
            <option value="aphrody-local-7b">⚡ Aphrody Local 7B (Rust ONNX)</option>
            <option value="claude-3-7-sonnet">Claude 3.7 Sonnet</option>
            <option value="gemini-2-5-flash">Gemini 2.5 Flash</option>
            <option value="grok-3">Grok 3 (xAI)</option>
          </select>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className="flex items-center gap-2 mb-1 px-1 text-[10px] text-[var(--md-sys-color-on-surface-variant)]">
              <span className="font-bold">{msg.sender === 'user' ? 'You' : 'Codex'}</span>
              <span>{msg.timestamp}</span>
            </div>

            <div
              className={`max-w-[85%] p-3.5 rounded-2xl ${
                msg.sender === 'user'
                  ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] rounded-tr-none'
                  : 'bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)] rounded-tl-none'
              }`}
            >
              <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>

              {msg.codeSnippet && (
                <div className="mt-3 rounded-xl bg-[#1e1e1e] p-3 font-mono text-[11px] text-gray-200 overflow-x-auto relative">
                  <div className="flex items-center justify-between text-[10px] text-gray-400 border-b border-white/10 pb-1 mb-2">
                    <span className="uppercase">{msg.codeSnippet.language}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(msg.codeSnippet!.code)}
                      className="hover:text-white"
                    >
                      Copy
                    </button>
                  </div>
                  <pre><code>{msg.codeSnippet.code}</code></pre>
                </div>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-center gap-2 text-xs text-[var(--md-sys-color-on-surface-variant)] italic">
            <span className="w-2 h-2 rounded-full bg-[var(--md-sys-color-primary)] animate-ping" />
            <span>Codex is generating code...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Bar */}
      <div className="p-3 border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)] flex items-center gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Ask a question or request a Bun script..."
          className="flex-1 px-4 py-2.5 rounded-2xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)] text-xs text-[var(--md-sys-color-on-surface)] outline-none focus:border-[var(--md-sys-color-primary)]"
        />
        <button
          onClick={handleSend}
          disabled={!inputValue.trim() || isTyping}
          className="px-4 py-2.5 rounded-2xl bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] font-bold text-xs shadow-sm hover:opacity-90 disabled:opacity-50 transition"
        >
          Send
        </button>
      </div>
    </div>
  );
};
