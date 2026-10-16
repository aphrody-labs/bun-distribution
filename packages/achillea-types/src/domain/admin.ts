import type { PageMeta } from "./common";
/**
 * Formes du tableau de bord d'administration : ops, portefeuilles, audit,
 * santé du bot et console base de données.
 *
 * Réservées au staff côté API, mais décrites ici comme le reste : un contrat
 * privé reste un contrat, et c'est précisément là que la dérive silencieuse
 * coûte le plus cher (une colonne renommée casse une console d'admin sans que
 * personne ne le voie avant l'incident).
 */

// ── Statistiques du bot ─────────────────────────────────────────────────────

export interface BotTotalsResponse {
  stats: {
    totalUsers: number;
    totalGuilds: number;
    totalActiveUsers: number;
    totalCommands: number;
  };
}

export interface CommandUsageRow {
  date: string;
  slashCommands: number;
  simpleCommands: number;
  contextMenus: number;
}

export interface DailyCountRow {
  date: string;
  count: number;
}

export interface UsersAndGuildsResponse {
  activeUsers: DailyCountRow[];
  users: DailyCountRow[];
  guilds: DailyCountRow[];
}

// ── Hub ops ─────────────────────────────────────────────────────────────────

export interface AdminOpsOverview {
  users: { total: number; staff: number };
  wallet: { wallets: number; totalBalance: number; txToday: number };
  moderation: { sanctionsActive: number; licensesActive: number };
  community: {
    tournamentsOngoing: number;
    clansPending: number;
    orgsPending: number;
    castEventsOpen: number;
  };
  ranked: {
    activeMatches: number;
    contestedMatches: number;
    finishedToday: number;
    matchesToday: number;
    totalPlayers: number;
  };
  audit24h: number;
  bot?: { online: boolean; uptime: number; maintenance: boolean; guilds: number };
  generatedAt?: string;
}

export interface AdminUserRow {
  id: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  role: number;
  lastInteract: string | null;
}

export interface AdminWalletRow {
  userId: string;
  displayName: string;
  balance: number;
  currency: string;
}

export interface AdminTransactionRow {
  id: string | number;
  type: string;
  amount: number;
  reason: string | null;
  fromUserId: string | null;
  toUserId: string | null;
  createdAt: string;
}

export interface AdminWalletsResponse {
  top: AdminWalletRow[];
  recent: AdminTransactionRow[];
}

export interface AdminWalletAdjustResult {
  success: boolean;
  userId: string;
  balance: number;
}

export interface AdminRoleUpdateResult {
  success: boolean;
  id: string;
  role: number;
}

export interface AdminHealthResponse {
  bot: {
    online: boolean;
    uptime: number;
    username: string | null;
    guilds: number;
    maintenance: boolean;
  };
  host: unknown;
  pid: unknown;
  latency: unknown;
}

export interface AdminAuditRow {
  id: string;
  ts: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
}

export interface AdminMetricsSummary {
  counters: Record<string, number>;
  rawLines: number;
}

export interface AdminGuildRow {
  id: string;
  name: string;
  iconURL: string | null;
  memberCount: number;
  ownerId: string;
  createdAt: string | null;
}

export interface AdminInviteResponse {
  url: string;
}

export interface MaintenanceResponse {
  maintenance: boolean;
}

// ── Console base de données ─────────────────────────────────────────────────

export interface DbTableRow {
  name: string;
  estimatedRows: number;
  protected: boolean;
}

/** Métadonnée de colonne SQL — voisine de `Column`, mais côté base. */
export interface DbColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
}

export interface DbRowsPage {
  data: Array<Record<string, unknown>>;
  columns: DbColumn[];
  meta: PageMeta;
}

export interface DbMutationResult {
  success: boolean;
  row?: Record<string, unknown> | null;
}

export interface DbQueryResult {
  data: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
}

// ── Exploitation ────────────────────────────────────────────────────────────

export interface DatabaseBackupResult {
  message: string;
  data?: { snapshotName: string };
}

export interface ModerationSyncResult {
  ok: boolean;
  sanctionId: string;
}

export interface HealthCheckResponse {
  online: boolean;
  uptime: number | null;
  lastStartup?: unknown;
}

export interface BotMonitoringResponse {
  botStatus: { online: boolean; uptime: number | null; maintenance: boolean };
  host: unknown;
  pid: unknown;
  latency: unknown;
}
