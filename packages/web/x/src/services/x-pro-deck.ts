// SPDX-License-Identifier: Apache-2.0
//
// X Pro (TweetDeck) decks and columns. The GraphQL calls and the account-sync parser are aphrody-x
// (crates/web/x/src/x_pro_deck.rs and ops.rs); this file keeps the public names and types over the
// native operations.

import type { XClient } from "../core/client";
import { local } from "../core/local";

export interface XProDeckColumn {
  rest_id: string;
  pathname: string;
  width?: string;
  media_preview?: string;
  latest?: boolean;
  hide_header?: boolean;
}

export interface XProDeckConfig {
  title?: string;
  icon?: string;
  is_pinned?: boolean;
}

export interface XProDeck {
  rest_id: string;
  config?: XProDeckConfig;
  deck_columns_v2?: XProDeckColumn[];
}

export interface XProAccountSync {
  active_deck_id?: string;
  composer_expanded?: boolean;
  default_column_width?: string;
  default_media_preview?: string;
  navbar_expanded?: boolean;
}

export interface ViewerAccountSyncResult {
  decks: XProDeck[];
  accountsync_client_config?: XProAccountSync;
  accountsync_onboarding_state?: Record<string, unknown>;
  raw: unknown;
}

export function parseViewerAccountSync(json: unknown): ViewerAccountSyncResult {
  return local<ViewerAccountSyncResult>("parse_viewer_account_sync", { json });
}

export function viewerAccountSync(client: XClient): Promise<ViewerAccountSyncResult> {
  return client.call("viewer_account_sync");
}

export function getDeck(client: XClient, deckId: string): Promise<XProDeck | null> {
  return client.call("xpro_get_deck", { deck_id: deckId });
}

export async function createDeck(
  client: XClient,
  name: string,
  columns: Array<{ pathname: string; width?: string }> = [],
): Promise<string | null> {
  const answer = await client.call<{ deck_id: string | null }>("xpro_create_deck", {
    name,
    columns,
  });
  return answer.deck_id ?? null;
}

export function updateDeck(
  client: XClient,
  deckId: string,
  config: XProDeckConfig,
): Promise<unknown> {
  return client.call("xpro_update_deck", { deck_id: deckId, config });
}

export function removeDeck(client: XClient, deckId: string): Promise<unknown> {
  return client.call("xpro_remove_deck", { deck_id: deckId });
}

export function reorderDecks(client: XClient, deckIds: string[]): Promise<unknown> {
  return client.call("xpro_reorder_decks", { deck_ids: deckIds });
}

export function createColumn(
  client: XClient,
  deckId: string,
  column: { pathname: string; width?: string; media_preview?: string },
): Promise<unknown> {
  return client.call("xpro_create_column", { deck_id: deckId, column });
}

export function updateColumn(
  client: XClient,
  deckId: string,
  columnId: string,
  column: Partial<XProDeckColumn>,
): Promise<unknown> {
  return client.call("xpro_update_column", { deck_id: deckId, column_id: columnId, column });
}

export function removeColumn(client: XClient, deckId: string, columnId: string): Promise<unknown> {
  return client.call("xpro_remove_column", { deck_id: deckId, column_id: columnId });
}

export function reorderColumns(
  client: XClient,
  deckId: string,
  columnIds: string[],
): Promise<unknown> {
  return client.call("xpro_reorder_columns", { deck_id: deckId, column_ids: columnIds });
}

export function importClientSyncColumns(client: XClient): Promise<unknown> {
  return client.call("xpro_import_client_sync_columns");
}

export function probeXProAccess(client: XClient): Promise<{
  ok: boolean;
  deck_count: number;
  active_deck_id?: string;
  graphql_ops: readonly string[];
  error?: string;
}> {
  return client.call("xpro_probe");
}
