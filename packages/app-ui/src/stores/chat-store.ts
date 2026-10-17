// SPDX-License-Identifier: Apache-2.0
import { create } from "zustand";

export interface ThreadItem {
  id: string;
  name?: string;
  preview?: string;
  createdAt: number;
  updatedAt?: number;
  cwd?: string;
}

export interface ChatStoreState {
  threads: ThreadItem[];
  activeThreadId: string | null;
  unreadThreadIds: Record<string, boolean>;
  expandedProjects: Record<string, boolean>;
  newSessionRequested: boolean;
  sessionTitle: string | undefined;
  model: string;
  effort: string;
  accessMode: "full" | "ask" | "readonly";
  cwd: string;

  setThreads: (threads: ThreadItem[]) => void;
  setActiveThreadId: (id: string | null) => void;
  setSessionTitle: (title: string | undefined) => void;
  setModel: (model: string) => void;
  setEffort: (effort: string) => void;
  setAccessMode: (mode: "full" | "ask" | "readonly") => void;
  setCwd: (cwd: string) => void;
  markThreadRead: (id: string) => void;
  markThreadUnread: (id: string) => void;
  toggleProjectExpanded: (projectName: string) => void;
  requestNewSession: () => void;
  clearNewSessionRequest: () => void;
}

export const useChatStore = create<ChatStoreState>(set => ({
  threads: [],
  activeThreadId: null,
  unreadThreadIds: {},
  expandedProjects: {},
  newSessionRequested: false,
  sessionTitle: undefined,
  model: "GPT-6 Luna",
  effort: "Minimal",
  accessMode: "full",
  cwd: "",

  setThreads: threads => set(() => ({ threads })),

  setActiveThreadId: id =>
    set(state => ({
      activeThreadId: id,
      unreadThreadIds: id ? { ...state.unreadThreadIds, [id]: false } : state.unreadThreadIds,
    })),

  setSessionTitle: title => set(() => ({ sessionTitle: title })),

  setModel: model => set(() => ({ model })),

  setEffort: effort => set(() => ({ effort })),

  setAccessMode: accessMode => set(() => ({ accessMode })),

  setCwd: cwd => set(() => ({ cwd })),

  markThreadRead: id =>
    set(state => ({
      unreadThreadIds: { ...state.unreadThreadIds, [id]: false },
    })),

  markThreadUnread: id =>
    set(state => ({
      unreadThreadIds: { ...state.unreadThreadIds, [id]: true },
    })),

  toggleProjectExpanded: projectName =>
    set(state => ({
      expandedProjects: {
        ...state.expandedProjects,
        [projectName]: !state.expandedProjects[projectName],
      },
    })),

  requestNewSession: () =>
    set({
      newSessionRequested: true,
      activeThreadId: null,
      sessionTitle: undefined,
    }),

  clearNewSessionRequest: () =>
    set({
      newSessionRequested: false,
    }),
}));

export function getProjectGroups(threads: ThreadItem[], expandedProjects: Record<string, boolean>) {
  const groups: Record<string, ThreadItem[]> = {};

  for (const t of threads) {
    let projName = "aphrody";
    if (t.cwd) {
      const parts = t.cwd.split(/[/\\]/).filter(Boolean);
      projName = parts[parts.length - 1] || "aphrody";
    }
    if (!groups[projName]) {
      groups[projName] = [];
    }
    groups[projName].push(t);
  }

  return Object.keys(groups).map(name => ({
    name,
    threads: groups[name],
    expanded: expandedProjects[name] ?? true,
  }));
}
