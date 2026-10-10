// SPDX-License-Identifier: Apache-2.0
// Injectable labels of the chat surface: every visible string (aria-label included) of the chat
// components comes from this dictionary. French, English and Japanese are complete; a partial
// dictionary falls back key by key on the English defaults.

/** Every visible string of the chat components. `{name}` placeholders go through `formatLabel`. */
export interface ChatLabels {
  // Composer
  composerPlaceholder: string;
  send: string;
  stop: string;
  openVoice: string;
  projects: string;
  // Model selector
  models: string;
  selectModel: string;
  searchModels: string;
  noModels: string;
  /** `{count}`: context window, already formatted. */
  contextTokens: string;
  // Message actions
  copyMessage: string;
  copyStreamingMessage: string;
  dislike: string;
  fork: string;
  assistantThinking: string;
  // Code blocks
  copy: string;
  copyCode: string;
  copied: string;
  // Conversations
  conversations: string;
  newConversation: string;
  searchConversations: string;
  noConversations: string;
  noSearchResults: string;
  untitledConversation: string;
  renameConversation: string;
  deleteConversation: string;
  // Model state
  modelUnavailable: string;
  modelDownloading: string;
  modelLoading: string;
  /** `{percent}`: integer 0..100. */
  progressPercent: string;
  retry: string;
  // Citations and refusal
  sources: string;
  /** `{n}`: citation number. */
  citation: string;
  openSource: string;
  refusalTitle: string;
  refusalBody: string;
  // Memory
  memory: string;
  memoryEmpty: string;
  memoryLoading: string;
  deleteMemory: string;
  clearMemory: string;
  clearMemoryConfirm: string;
  confirm: string;
  cancel: string;
  // Generic
  loading: string;
  errorGeneric: string;
}

/** English labels: the fallback of every key. */
export const chatLabelsEn: ChatLabels = {
  composerPlaceholder: "Ask something...",
  send: "Send",
  stop: "Stop",
  openVoice: "Open Voice Input",
  projects: "Projects",
  models: "Models",
  selectModel: "Select model...",
  searchModels: "Search models...",
  noModels: "No models found",
  contextTokens: "{count} tokens",
  copyMessage: "Copy Message",
  copyStreamingMessage: "Copy Streaming Message",
  dislike: "Dislike",
  fork: "Fork",
  assistantThinking: "Thinking",
  copy: "Copy",
  copyCode: "Copy code",
  copied: "Copied!",
  conversations: "Conversations",
  newConversation: "New conversation",
  searchConversations: "Search conversations",
  noConversations: "No conversations yet",
  noSearchResults: "No matching conversation",
  untitledConversation: "Untitled conversation",
  renameConversation: "Rename conversation",
  deleteConversation: "Delete conversation",
  modelUnavailable: "Model unavailable",
  modelDownloading: "Downloading the model",
  modelLoading: "Loading the model",
  progressPercent: "{percent}%",
  retry: "Retry",
  sources: "Sources",
  citation: "Source {n}",
  openSource: "Open source",
  refusalTitle: "Not established in the sources",
  refusalBody: "The available sources do not support an answer to this question.",
  memory: "Memory",
  memoryEmpty: "No memories saved",
  memoryLoading: "Loading memories",
  deleteMemory: "Delete memory",
  clearMemory: "Clear all memories",
  clearMemoryConfirm: "Delete every saved memory? This cannot be undone.",
  confirm: "Confirm",
  cancel: "Cancel",
  loading: "Loading",
  errorGeneric: "Something went wrong",
};

/** French labels. */
export const chatLabelsFr: ChatLabels = {
  composerPlaceholder: "Posez une question...",
  send: "Envoyer",
  stop: "Arrêter",
  openVoice: "Saisie vocale",
  projects: "Projets",
  models: "Modèles",
  selectModel: "Choisir un modèle...",
  searchModels: "Rechercher un modèle...",
  noModels: "Aucun modèle trouvé",
  contextTokens: "{count} jetons",
  copyMessage: "Copier le message",
  copyStreamingMessage: "Copier le message en cours",
  dislike: "Je n'aime pas",
  fork: "Bifurquer à partir de ce tour",
  assistantThinking: "Réflexion",
  copy: "Copier",
  copyCode: "Copier le code",
  copied: "Copié !",
  conversations: "Conversations",
  newConversation: "Nouvelle conversation",
  searchConversations: "Rechercher une conversation",
  noConversations: "Aucune conversation pour l'instant",
  noSearchResults: "Aucune conversation ne correspond",
  untitledConversation: "Conversation sans titre",
  renameConversation: "Renommer la conversation",
  deleteConversation: "Supprimer la conversation",
  modelUnavailable: "Modèle indisponible",
  modelDownloading: "Téléchargement du modèle",
  modelLoading: "Chargement du modèle",
  progressPercent: "{percent} %",
  retry: "Réessayer",
  sources: "Sources",
  citation: "Source {n}",
  openSource: "Ouvrir la source",
  refusalTitle: "Non établi dans les sources",
  refusalBody: "Les sources disponibles ne permettent pas de répondre à cette question.",
  memory: "Mémoire",
  memoryEmpty: "Aucun souvenir enregistré",
  memoryLoading: "Chargement des souvenirs",
  deleteMemory: "Supprimer ce souvenir",
  clearMemory: "Effacer tous les souvenirs",
  clearMemoryConfirm: "Supprimer tous les souvenirs enregistrés ? Cette action est définitive.",
  confirm: "Confirmer",
  cancel: "Annuler",
  loading: "Chargement",
  errorGeneric: "Une erreur est survenue",
};

/** Japanese labels. */
export const chatLabelsJa: ChatLabels = {
  composerPlaceholder: "質問を入力...",
  send: "送信",
  stop: "停止",
  openVoice: "音声入力",
  projects: "プロジェクト",
  models: "モデル",
  selectModel: "モデルを選択...",
  searchModels: "モデルを検索...",
  noModels: "モデルが見つかりません",
  contextTokens: "{count} トークン",
  copyMessage: "メッセージをコピー",
  copyStreamingMessage: "生成中のメッセージをコピー",
  dislike: "低評価",
  fork: "このターンから分岐",
  assistantThinking: "思考中",
  copy: "コピー",
  copyCode: "コードをコピー",
  copied: "コピーしました",
  conversations: "会話",
  newConversation: "新しい会話",
  searchConversations: "会話を検索",
  noConversations: "まだ会話はありません",
  noSearchResults: "一致する会話はありません",
  untitledConversation: "無題の会話",
  renameConversation: "会話の名前を変更",
  deleteConversation: "会話を削除",
  modelUnavailable: "モデルを利用できません",
  modelDownloading: "モデルをダウンロード中",
  modelLoading: "モデルを読み込み中",
  progressPercent: "{percent}%",
  retry: "再試行",
  sources: "出典",
  citation: "出典 {n}",
  openSource: "出典を開く",
  refusalTitle: "出典では確認できません",
  refusalBody: "利用できる出典では、この質問に回答できません。",
  memory: "メモリー",
  memoryEmpty: "保存されたメモリーはありません",
  memoryLoading: "メモリーを読み込み中",
  deleteMemory: "メモリーを削除",
  clearMemory: "すべてのメモリーを消去",
  clearMemoryConfirm: "保存されたすべてのメモリーを削除しますか？この操作は元に戻せません。",
  confirm: "確認",
  cancel: "キャンセル",
  loading: "読み込み中",
  errorGeneric: "エラーが発生しました",
};

/** The fallback dictionary (English). */
export const defaultChatLabels: ChatLabels = chatLabelsEn;

/** The complete dictionaries by language tag. */
export const chatLabelsByLang = { fr: chatLabelsFr, en: chatLabelsEn, ja: chatLabelsJa } as const;

/** Complete a partial dictionary with the defaults; empty strings fall back too. */
export function resolveChatLabels(
  partial?: Partial<ChatLabels>,
  base: ChatLabels = defaultChatLabels,
): ChatLabels {
  if (!partial) return base;
  const out = { ...base };
  for (const key of Object.keys(partial) as (keyof ChatLabels)[]) {
    const value = partial[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

/** Replace `{name}` placeholders of a label. Unknown placeholders stay as written. */
export function formatLabel(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
