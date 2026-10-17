// SPDX-License-Identifier: Apache-2.0
// Conversation list on the M3 navigation-drawer anatomy: a `surface-container-low` sheet, a
// "new conversation" FAB-like tonal button, optional search, and 56 dp items whose active one
// takes the `secondary-container` indicator.

"use client";

import { CircleButton } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useMemo, useState } from "react";

import { type ChatLabels, resolveChatLabels } from "./chatLabels";
import { ChatIcon } from "./chatIcons";
import { CircularIndicator, focusRing } from "./internal";

export interface ConversationSummary {
  id: string;
  title: string;
  /** ISO string, epoch milliseconds or Date. */
  updatedAt: string | number | Date;
  preview?: string;
}

export interface ConversationListProps {
  conversations: readonly ConversationSummary[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  /** Shows the "new conversation" button. */
  onNew?: () => void;
  /** Shows a rename icon button on each item. */
  onRename?: (id: string) => void;
  /** Shows a delete icon button on each item. */
  onDelete?: (id: string) => void;
  /** Shows a search field that filters by title and preview. */
  searchable?: boolean;
  loading?: boolean;
  labels?: Partial<ChatLabels>;
  /** BCP 47 locale of the dates (`fr`, `en`, `ja`). */
  locale?: string;
  /** Overrides the date formatting. */
  formatDate?: (updatedAt: Date) => string;
  className?: string;
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function isoDate(value: string | number | Date): string | undefined {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Filter conversations by a case-insensitive query on title and preview. */
export function filterConversations(
  conversations: readonly ConversationSummary[],
  query: string,
): ConversationSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...conversations];
  return conversations.filter(conversation =>
    `${conversation.title}\n${conversation.preview ?? ""}`.toLocaleLowerCase().includes(needle),
  );
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  searchable = false,
  loading = false,
  labels,
  locale,
  formatDate,
  className,
}: ConversationListProps) {
  const l = resolveChatLabels(labels);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterConversations(conversations, query), [conversations, query]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "short" }), [locale]);
  const format = (value: string | number | Date) => {
    const date = toDate(value);
    if (Number.isNaN(date.getTime())) return "";
    return formatDate ? formatDate(date) : dateFormat.format(date);
  };

  return (
    <nav
      aria-label={l.conversations}
      className={clsx(
        "m3-conversation-list flex h-full min-h-0 flex-col gap-2 bg-surface-container-low px-3 py-3 text-on-surface",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="m-0 text-title-small text-on-surface-variant">{l.conversations}</h2>
      </div>
      {onNew ? (
        <button
          type="button"
          onClick={onNew}
          className={clsx(
            "flex h-14 items-center gap-3 rounded-large bg-primary-container px-4 text-label-large text-on-primary-container",
            "transition-colors duration-200 ease-standard hover:bg-primary-container/92",
            focusRing,
          )}
        >
          <ChatIcon name="edit_square" size={24} />
          <span>{l.newConversation}</span>
        </button>
      ) : null}
      {searchable ? (
        <label className="flex h-12 items-center gap-3 rounded-extra-large bg-surface-container-high px-4 focus-within:bg-surface-container-highest">
          <ChatIcon name="search" size={20} className="text-on-surface-variant" />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={l.searchConversations}
            aria-label={l.searchConversations}
            className="min-w-0 flex-1 border-0 bg-transparent text-body-large text-on-surface caret-primary outline-none placeholder:text-on-surface-variant"
          />
        </label>
      ) : null}
      {loading ? (
        <div className="flex justify-center py-6">
          <CircularIndicator size={24} label={l.loading} />
        </div>
      ) : visible.length === 0 ? (
        <p className="m-0 px-4 py-6 text-center text-body-medium text-on-surface-variant">
          {query.trim() ? l.noSearchResults : l.noConversations}
        </p>
      ) : (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto p-0">
          {visible.map(conversation => {
            const active = conversation.id === selectedId;
            const title = conversation.title.trim() || l.untitledConversation;
            return (
              <li key={conversation.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "flex min-h-14 w-full flex-col justify-center rounded-extra-large px-4 py-2 text-left",
                    "transition-colors duration-200 ease-standard",
                    active
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-on-surface/8",
                    (onRename || onDelete) && "pr-24",
                    focusRing,
                    "focus-visible:outline-offset-[-3px]",
                  )}
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-label-large">{title}</span>
                    <time className="shrink-0 text-label-small opacity-80" dateTime={isoDate(conversation.updatedAt)}>
                      {format(conversation.updatedAt)}
                    </time>
                  </span>
                  {conversation.preview ? (
                    <span className="mt-0.5 w-full truncate text-body-small opacity-80">{conversation.preview}</span>
                  ) : null}
                </button>
                {onRename || onDelete ? (
                  <span className="absolute top-1/2 right-2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity duration-200 ease-standard group-focus-within:opacity-100 group-hover:opacity-100">
                    {onRename ? (
                      <CircleButton
                        icon={<ChatIcon name="edit" size={18} />}
                        variant="standard"
                        size="sm"
                        onClick={() => onRename(conversation.id)}
                        aria-label={`${l.renameConversation}: ${title}`}
                        title={l.renameConversation}
                      />
                    ) : null}
                    {onDelete ? (
                      <CircleButton
                        icon={<ChatIcon name="delete" size={18} />}
                        variant="standard"
                        size="sm"
                        onClick={() => onDelete(conversation.id)}
                        aria-label={`${l.deleteConversation}: ${title}`}
                        title={l.deleteConversation}
                      />
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
