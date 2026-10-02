// SPDX-License-Identifier: Apache-2.0
// Knowledge Inspector: Real Aphrody & Shenron AI Assistant for Spacedrive
import { Icon, m3FocusRing, CircularProgress, toast } from "@aphrody/m3-primitives";
import { useState } from "react";
import clsx from "clsx";
import { askShenron, runRagSearch } from "../../../tauri-bridge";
import { useI18n } from "../../../i18n";

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function KnowledgeInspector() {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: "assistant",
      content:
        "Bonjour ! Je suis l'assistant Aphrody / Shenron. Je peux explorer vos documents, indexer votre base vectorielle RAG et répondre à vos questions sur vos données.",
      timestamp: new Date(),
    },
  ]);

  const handleSend = async (customPrompt?: string) => {
    const promptToSend = customPrompt || message;
    if (!promptToSend.trim() || loading) return;

    const userMessageId = messages.length + 1;
    const newMessage: Message = {
      id: userMessageId,
      role: "user",
      content: promptToSend,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newMessage]);
    if (!customPrompt) setMessage("");
    setLoading(true);

    try {
      // Direct call to real Shenron / local RAG AI bridge
      const response = await askShenron(promptToSend);
      const assistantMessage: Message = {
        id: userMessageId + 1,
        role: "assistant",
        content: response?.answer || "Aucune réponse retournée par Shenron.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      // Fallback on direct CLI RAG / chat search
      try {
        const ragResponse = await runRagSearch(promptToSend, 3);
        const results = ragResponse?.results || [];
        const fallbackText = results.length > 0
          ? `Résultats RAG trouvés :\n` + results.map((r, i) => `${i + 1}. ${r.path || "Document"} (ligne: ${r.line ?? "N/A"})`).join("\n")
          : "Aucune information pertinente trouvée dans la base RAG locale.";
        setMessages((prev) => [
          ...prev,
          {
            id: userMessageId + 1,
            role: "assistant",
            content: fallbackText,
            timestamp: new Date(),
          },
        ]);
      } catch (innerErr) {
        toast.error("Erreur de communication avec le backend IA : " + String(innerErr));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = async (action: string) => {
    if (action === "Smart search") {
      await handleSend("Recherche les documents clés et résume la structure du corpus.");
    } else if (action === "Find duplicates") {
      toast.error("La commande de déduplication n'est pas exposée par le backend Aphrody actuel.");
    } else if (action === "Organize files") {
      await handleSend("Propose un classement optimal des fichiers selon les tags et métadonnées.");
    }
  };

  const quickActions = [
    { label: t("inspector.organize_files", "Organiser les fichiers"), action: "Organize files" },
    { label: t("inspector.find_duplicates", "Trouver des doublons"), action: "Find duplicates" },
    { label: t("inspector.smart_search", "Recherche sémantique"), action: "Smart search" },
  ];

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="border-b border-outline-variant/40 px-4 py-3 bg-surface-container-low/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-on-primary shadow-sm">
            <Icon name="auto_awesome" size={20} filled />
          </div>
          <div>
            <div className="text-title-medium font-semibold text-on-surface">Shenron assistant</div>
            <div className="text-body-small text-on-surface-variant">RAG & connaissances souveraines</div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={clsx("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
          >
            {/* Avatar */}
            <div
              className={clsx(
                "flex size-8 shrink-0 items-center justify-center rounded-full text-label-small font-bold",
                msg.role === "assistant"
                  ? "bg-primary-container text-on-primary-container border border-primary/20"
                  : "bg-secondary-container text-on-secondary-container",
              )}
            >
              {msg.role === "assistant" ? (
                <Icon name="auto_awesome" size={16} filled />
              ) : (
                "U"
              )}
            </div>

            {/* Message content */}
            <div
              className={clsx(
                "flex max-w-[85%] flex-col",
                msg.role === "user" ? "items-end" : "items-start",
              )}
            >
              <div
                className={clsx(
                  "rounded-2xl px-4 py-2.5 shadow-sm text-body-medium leading-relaxed whitespace-pre-wrap",
                  msg.role === "assistant"
                    ? "bg-surface-container-high border border-outline-variant/30 text-on-surface"
                    : "bg-primary text-on-primary",
                )}
              >
                {msg.content}
              </div>
              <span className="mt-1 px-1 text-label-small text-on-surface-variant/70">
                {msg.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-on-surface-variant text-body-small italic px-2">
            <CircularProgress radius={10} progress={65} />
            <span>{t("inspector.generating_answer", "Shenron analyse le fichier...")}</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="space-y-3 border-t border-outline-variant/40 p-4 bg-surface-container-lowest/60">
        <div className="flex items-center gap-2">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-full border border-outline-variant/60 bg-surface-container px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t("inspector.ask_ai", "Poser une question sur vos documents...")}
              className="flex-1 bg-transparent text-body-medium text-on-surface outline-none placeholder:text-on-surface-variant"
            />
          </div>

          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!message.trim() || loading}
            className={clsx(
              "flex size-11 shrink-0 items-center justify-center rounded-full transition-all duration-200",
              m3FocusRing,
              message.trim() && !loading
                ? "bg-primary text-on-primary hover:shadow-md active:scale-95"
                : "cursor-not-allowed bg-on-surface/12 text-on-surface/38",
            )}
            title="Envoyer la demande"
            aria-label="Envoyer"
          >
            <Icon name="send" size={20} filled />
          </button>
        </div>

        {/* Quick actions chips */}
        <div className="flex flex-wrap gap-2">
          {quickActions.map((qa) => (
            <button
              key={qa.action}
              type="button"
              onClick={() => handleQuickAction(qa.action)}
              className={clsx(
                "h-8 rounded-full border border-outline-variant/60 bg-surface-container px-3 text-label-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface active:scale-95",
                m3FocusRing,
              )}
            >
              {qa.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
