// SPDX-License-Identifier: Apache-2.0
import React, { useState, useRef, useEffect } from "react";

interface TerminalLine {
  id: string;
  type: "input" | "output" | "error" | "success" | "system";
  text: string;
}

interface BunshTerminalAppProps {
  onSetTheme?: (seed: string) => void;
  /** False when `appId` names no application. */
  onOpenApp?: (appId: string) => boolean;
}

export const BunshTerminalApp: React.FC<BunshTerminalAppProps> = ({ onSetTheme, onOpenApp }) => {
  const [isRoot, setIsRoot] = useState(false);
  const [history, setHistory] = useState<TerminalLine[]>([
    { id: "1", type: "system", text: "🌸 Aphrody Alpine Linux v3.24.2 (x86_64-alpine-linux-musl)" },
    { id: "2", type: "system", text: "Root login shell: /bin/bunsh (Aphrody Bun Shell with elevate)" },
    { id: "3", type: "system", text: 'Type "help" for builtins or "apk list" to inspect signed packages.\n' },
  ]);
  const [inputVal, setInputVal] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const prompt = isRoot ? "root@aphrody-alpine:~# " : "builder@aphrody-alpine:~$ ";

  const handleCommand = async (cmdStr: string) => {
    const trimmed = cmdStr.trim();
    if (!trimmed) return;

    setCommandHistory(prev => [...prev, trimmed]);
    setHistoryIndex(-1);

    const inputEntry: TerminalLine = {
      id: Math.random().toString(36).slice(2),
      type: "input",
      text: `${prompt}${trimmed}`,
    };

    const parts = trimmed.split(" ");
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    const newOutputs: TerminalLine[] = [inputEntry];

    if (cmd === "clear") {
      setHistory([]);
      return;
    }

    if (cmd === "sudo" || (cmd === "bunsh" && args[0] === "--root")) {
      setIsRoot(true);
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: "success",
        text: "Elevated session via sudo-rs: %aphrody ALL=(ALL:ALL) NOPASSWD",
      });
      if ((cmd === "bunsh" && args[0] === "--root") || args.length === 0) {
        setHistory(prev => [...prev, ...newOutputs]);
        setInputVal("");
        return;
      }
    }

    if (cmd === "exit" && isRoot) {
      setIsRoot(false);
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: "output",
        text: "Dropped root elevation. Returning to user session.",
      });
      setHistory(prev => [...prev, ...newOutputs]);
      setInputVal("");
      return;
    }

    if (cmd === "open") {
      const target = args[0] || "";
      if (onOpenApp) {
        const opened = onOpenApp(target);
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: opened ? "success" : "error",
          text: opened ? `Opened application '${target}'.` : `open: unknown application '${target}'.`,
        });
        setHistory(prev => [...prev, ...newOutputs]);
        setInputVal("");
        return;
      }
    }

    if (cmd === "help") {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: "output",
        text: `Aphrody Bun Shell (bunsh) Built-in Commands:
  uname -a               Print operating system and kernel version
  cat <file>             Inspect system configurations (/etc/os-release, /etc/passwd, sysctl...)
  apk <cmd> [pkg]        Manage packages from aphrody-labs/aports (list, info, add, search)
  bun -v, bun -e <code>  Execute code natively in Bun 1.4.3 runtime
  aphrody <cmd>          Invoke unified CLI (status, doctor, web status, git inspect, docs)
  n2b <dir>              Run Node-to-Bun AST migration analysis
  sudo <cmd>, bunsh --root Elevate privileges to root user via sudo-rs
  dmesg                  Print kernel event ring buffer
  free, ps               Inspect processes and memory stats
  open <app>             Launch GUI application (kernel, drive, codex, apk, m3, diagnostics)
  clear                  Clear terminal buffer`,
      });
      setHistory(prev => [...prev, ...newOutputs]);
      setInputVal("");
      return;
    }

    // Try live execution against /api/os/exec
    try {
      const res = await fetch("/api/os/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: trimmed, isRoot }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.stdout) {
          newOutputs.push({
            id: Math.random().toString(36).slice(2),
            type: "output",
            text: data.stdout.replace(/\n$/, ""),
          });
        }
        if (data.stderr) {
          newOutputs.push({
            id: Math.random().toString(36).slice(2),
            type: "error",
            text: data.stderr.replace(/\n$/, ""),
          });
        }
        if (!data.stdout && !data.stderr) {
          if (data.exitCode === 0) {
            newOutputs.push({
              id: Math.random().toString(36).slice(2),
              type: "success",
              text: `Command completed successfully (0).`,
            });
          } else {
            newOutputs.push({
              id: Math.random().toString(36).slice(2),
              type: "error",
              text: `Command exited with status code ${data.exitCode}.`,
            });
          }
        }
        setHistory(prev => [...prev, ...newOutputs]);
        setInputVal("");
        return;
      }
    } catch {}

    // Fallback local emulation if server unreachable
    if (cmd === "uname") {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: "output",
        text: "Linux aphrody-alpine 6.18.55-aphrody-v3 #1 SMP PREEMPT_DYNAMIC x86_64 Linux",
      });
    } else if (cmd === "cat") {
      const target = args[0] || "";
      if (target === "/etc/os-release") {
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: "output",
          text: `NAME="Aphrody Alpine Linux"\nID=aphrody-alpine\nVERSION_ID=3.24.2\nPRETTY_NAME="Aphrody Alpine Linux v3.24 (musl + aphrody-libc)"\nSHELL="/bin/bunsh"`,
        });
      } else {
        newOutputs.push({
          id: Math.random().toString(36).slice(2),
          type: "error",
          text: `cat: ${target || "missing argument"}: No such file or directory`,
        });
      }
    } else {
      newOutputs.push({
        id: Math.random().toString(36).slice(2),
        type: "error",
        text: `bunsh: ${cmd}: command not found. Type 'help' for builtins.`,
      });
    }

    setHistory(prev => [...prev, ...newOutputs]);
    setInputVal("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleCommand(inputVal);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const nextIndex = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        setInputVal(commandHistory[nextIndex] || "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex !== -1) {
        const nextIndex = historyIndex + 1;
        if (nextIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setInputVal("");
        } else {
          setHistoryIndex(nextIndex);
          setInputVal(commandHistory[nextIndex] || "");
        }
      }
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-[#0a0c10] text-gray-200 font-mono text-xs select-text overflow-hidden p-3"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
        {history.map(line => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap leading-relaxed ${
              line.type === "input"
                ? "text-gray-100 font-semibold"
                : line.type === "error"
                  ? "text-red-400"
                  : line.type === "success"
                    ? "text-emerald-400"
                    : line.type === "system"
                      ? "text-purple-300"
                      : "text-gray-300"
            }`}
          >
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-gray-800/80 shrink-0">
        <span className={isRoot ? "text-red-400 font-bold" : "text-purple-400 font-bold"}>{prompt}</span>
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1 bg-transparent border-none outline-none text-white font-mono text-xs caret-purple-400"
          placeholder="type command (e.g. apk list, uname -a, aphrody doctor)..."
        />
      </div>
    </div>
  );
};
