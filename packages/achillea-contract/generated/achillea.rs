// Contrat Achilléa — FICHIER GÉNÉRÉ, ne pas éditer à la main.
// Source : @rosegriffon/achillea-types@1.0.3
// Régénérer : bun --filter @rosegriffon/achillea-contract generate
//
// Dépendances attendues côté Cargo.toml :
//   serde = { version = "1", features = ["derive"] }
//   serde_json = "1"
//   serde_repr = "0.1"

#![allow(clippy::doc_markdown)]

use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

/// Horodatage ISO 8601. Aliasé pour pouvoir basculer sur
/// `chrono::DateTime<Utc>` sans retoucher le reste du fichier.
pub type Timestamp = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminAuditRow {
	pub id: String,
	pub ts: String,
	#[serde(rename = "actorId", default, skip_serializing_if = "Option::is_none")]
	pub actor_id: Option<String>,
	pub action: String,
	#[serde(rename = "targetType")]
	pub target_type: String,
	#[serde(rename = "targetId", default, skip_serializing_if = "Option::is_none")]
	pub target_id: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminGuildRow {
	pub id: String,
	pub name: String,
	#[serde(rename = "iconURL", default, skip_serializing_if = "Option::is_none")]
	pub icon_url: Option<String>,
	#[serde(rename = "memberCount")]
	pub member_count: f64,
	#[serde(rename = "ownerId")]
	pub owner_id: String,
	#[serde(rename = "createdAt", default, skip_serializing_if = "Option::is_none")]
	pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminHealthResponse {
	pub bot: serde_json::Value,
	pub host: serde_json::Value,
	pub pid: serde_json::Value,
	pub latency: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminInviteResponse {
	pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminMetricsSummary {
	pub counters: std::collections::HashMap<String, f64>,
	#[serde(rename = "rawLines")]
	pub raw_lines: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminOpsOverview {
	pub users: serde_json::Value,
	pub wallet: serde_json::Value,
	pub moderation: serde_json::Value,
	pub community: serde_json::Value,
	pub ranked: serde_json::Value,
	pub audit24h: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub bot: Option<serde_json::Value>,
	#[serde(rename = "generatedAt", default, skip_serializing_if = "Option::is_none")]
	pub generated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminRoleUpdateResult {
	pub success: bool,
	pub id: String,
	pub role: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminTransactionRow {
	pub id: serde_json::Value,
	pub r#type: String,
	pub amount: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub reason: Option<String>,
	#[serde(rename = "fromUserId", default, skip_serializing_if = "Option::is_none")]
	pub from_user_id: Option<String>,
	#[serde(rename = "toUserId", default, skip_serializing_if = "Option::is_none")]
	pub to_user_id: Option<String>,
	#[serde(rename = "createdAt")]
	pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminUserRow {
	pub id: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub username: Option<String>,
	#[serde(rename = "displayName", default, skip_serializing_if = "Option::is_none")]
	pub display_name: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub avatar: Option<String>,
	pub role: f64,
	#[serde(rename = "lastInteract", default, skip_serializing_if = "Option::is_none")]
	pub last_interact: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminWalletAdjustResult {
	pub success: bool,
	#[serde(rename = "userId")]
	pub user_id: String,
	pub balance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminWalletRow {
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub balance: f64,
	pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminWalletsResponse {
	pub top: Vec<AdminWalletRow>,
	pub recent: Vec<AdminTransactionRow>,
}

/// Réponse enveloppée : `{ success, data?, error? }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiEnvelope<T> where T: Serialize + serde::de::DeserializeOwned {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub data: Option<T>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotMonitoringResponse {
	#[serde(rename = "botStatus")]
	pub bot_status: serde_json::Value,
	pub host: serde_json::Value,
	pub pid: serde_json::Value,
	pub latency: serde_json::Value,
}

/// Formes du tableau de bord d'administration : ops, portefeuilles, audit,
/// santé du bot et console base de données.
///
/// Réservées au staff côté API, mais décrites ici comme le reste : un contrat
/// privé reste un contrat, et c'est précisément là que la dérive silencieuse
/// coûte le plus cher (une colonne renommée casse une console d'admin sans que
/// personne ne le voie avant l'incident).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotTotalsResponse {
	pub stats: serde_json::Value,
}

/// Identifiant d'entité bracket (`brackets-model#Id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BracketId {
	Id(f64),
	Text(String),
}

/// Statut d'un match de bracket (`brackets-model#Status`), en valeurs numériques.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum BracketMatchStatus {
	Locked = 0,
	Waiting = 1,
	Ready = 2,
	Running = 3,
	Completed = 4,
	Archived = 5,
}

/// `brackets-model#StageType` — formats de bracket supportés par la lib.
pub type BracketsStageType = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelTournamentResult {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub notified: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastAttribution {
	pub id: String,
	#[serde(rename = "slotId")]
	pub slot_id: String,
	#[serde(rename = "userId", default, skip_serializing_if = "Option::is_none")]
	pub user_id: Option<String>,
	#[serde(rename = "assignedAt")]
	pub assigned_at: String,
	#[serde(rename = "assignedBy")]
	pub assigned_by: String,
	#[serde(rename = "confirmedAt", default, skip_serializing_if = "Option::is_none")]
	pub confirmed_at: Option<String>,
}

/// `POST /casts/:id/auto-assign`. Générique sur l'attribution : l'API renvoie
/// la forme complète, un appelant peut n'en valider qu'une projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastAutoAssignResult<TAttribution> where TAttribution: Serialize + serde::de::DeserializeOwned {
	pub created: f64,
	pub attributions: Vec<TAttribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastAvailability {
	pub id: String,
	#[serde(rename = "userId")]
	pub user_id: String,
	pub status: CastAvailabilityStatus,
	#[serde(rename = "preferredRoles", default, skip_serializing_if = "Option::is_none")]
	pub preferred_roles: Option<Vec<CastSlotRole>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub notes: Option<String>,
	#[serde(rename = "declaredAt")]
	pub declared_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CastAvailabilityStatus {
	#[serde(rename = "available")]
	Available,
	#[serde(rename = "maybe")]
	Maybe,
	#[serde(rename = "unavailable")]
	Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CasterPublic {
	pub id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub avatar: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub bio: Option<String>,
	#[serde(rename = "twitchUrl", default, skip_serializing_if = "Option::is_none")]
	pub twitch_url: Option<String>,
	#[serde(rename = "recentCasts")]
	pub recent_casts: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastEvent {
	pub id: String,
	pub name: String,
	pub kind: CastEventKind,
	#[serde(rename = "scheduledAt")]
	pub scheduled_at: String,
	pub duration: f64,
	#[serde(rename = "tournamentId", default, skip_serializing_if = "Option::is_none")]
	pub tournament_id: Option<String>,
	pub status: CastEventStatus,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub description: Option<String>,
	#[serde(rename = "twitchUrl", default, skip_serializing_if = "Option::is_none")]
	pub twitch_url: Option<String>,
	#[serde(rename = "createdBy")]
	pub created_by: String,
	#[serde(rename = "createdAt")]
	pub created_at: String,
	#[serde(rename = "updatedAt")]
	pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastEventDetail {
	pub event: CastEvent,
	pub slots: Vec<CastSlot>,
	pub attributions: Vec<CastAttribution>,
	pub checklist: Vec<ChecklistItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastEventFilters {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub page: Option<f64>,
	#[serde(rename = "pageSize", default, skip_serializing_if = "Option::is_none")]
	pub page_size: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub status: Option<CastEventStatus>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub from: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub to: Option<String>,
}

/// Nature d'un évènement à caster.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CastEventKind {
	#[serde(rename = "match")]
	Match,
	#[serde(rename = "tournament")]
	Tournament,
	#[serde(rename = "stream")]
	Stream,
	#[serde(rename = "other")]
	Other,
}

pub type CastEventListResponse = PagedList<CastEvent>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CastEventStatus {
	#[serde(rename = "planned")]
	Planned,
	#[serde(rename = "open_signup")]
	OpenSignup,
	#[serde(rename = "attributed")]
	Attributed,
	#[serde(rename = "live")]
	Live,
	#[serde(rename = "done")]
	Done,
	#[serde(rename = "cancelled")]
	Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastSlot {
	pub id: String,
	pub role: CastSlotRole,
	pub required: bool,
	#[serde(rename = "defraymentAmount", default, skip_serializing_if = "Option::is_none")]
	pub defrayment_amount: Option<String>,
	#[serde(rename = "defraymentCurrency", default, skip_serializing_if = "Option::is_none")]
	pub defrayment_currency: Option<String>,
	#[serde(rename = "defraymentReason", default, skip_serializing_if = "Option::is_none")]
	pub defrayment_reason: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub notes: Option<String>,
}

/// Poste occupé sur une diffusion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CastSlotRole {
	#[serde(rename = "caster_main")]
	CasterMain,
	#[serde(rename = "caster_secondary")]
	CasterSecondary,
	#[serde(rename = "observer")]
	Observer,
	#[serde(rename = "producer")]
	Producer,
	#[serde(rename = "host")]
	Host,
	#[serde(rename = "technical")]
	Technical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CastSurveyResult {
	pub success: bool,
	#[serde(rename = "eventId")]
	pub event_id: String,
	#[serde(rename = "poolSize")]
	pub pool_size: f64,
}

/// Ligne de checklist : un poste, son attributaire éventuel, sa confirmation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecklistItem {
	pub slot: CastSlot,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub attribution: Option<CastAttribution>,
	#[serde(rename = "casterId", default, skip_serializing_if = "Option::is_none")]
	pub caster_id: Option<String>,
	pub confirmed: bool,
}

/// Classement des clans — somme des points circuit de leurs membres actuels.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitClanEntry {
	pub id: f64,
	pub name: String,
	#[serde(rename = "shortName")]
	pub short_name: String,
	pub avatar: String,
	pub points: f64,
	pub players: f64,
	#[serde(rename = "tournamentsPlayed")]
	pub tournaments_played: f64,
	pub wins: f64,
	pub podiums: f64,
	pub tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitClanTag {
	pub id: f64,
	pub name: String,
	#[serde(rename = "shortName")]
	pub short_name: String,
	pub avatar: String,
}

/// Classement circuit — cumul de points de circuit sur tous les tournois
/// élimination terminés. Calcul : `@rosegriffon/achillea-core/tournaments`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitLeaderboardEntry {
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub username: String,
	pub avatar: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub clan: Option<CircuitClanTag>,
	#[serde(rename = "tournamentsPlayed")]
	pub tournaments_played: f64,
	pub points: f64,
	pub tournaments: f64,
	pub wins: f64,
	pub podiums: f64,
	pub top4: f64,
	pub top8: f64,
	#[serde(rename = "bestRank")]
	pub best_rank: f64,
	#[serde(rename = "bestRankLabel")]
	pub best_rank_label: String,
	/// Palier circuit — mêmes clés que le ranked (Fer → Légendaire).
	pub tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitPodiumEntry {
	pub rank: f64,
	#[serde(rename = "rankLabel")]
	pub rank_label: String,
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub avatar: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitRanking {
	pub leaderboard: Vec<CircuitLeaderboardEntry>,
	pub tournaments: Vec<CircuitTournamentSummary>,
	#[serde(rename = "clanRanking")]
	pub clan_ranking: Vec<CircuitClanEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitTournamentSummary {
	pub id: f64,
	pub name: String,
	pub size: f64,
	#[serde(rename = "grandFinalAt")]
	pub grand_final_at: String,
	pub podium: Vec<CircuitPodiumEntry>,
	#[serde(rename = "standingsStatus")]
	pub standings_status: String,
}

/// Forme historique dénormalisée (snake_case) encore servie par quelques vues.
/// Conservée pour compatibilité ; toute nouvelle route doit renvoyer `ClanDTO`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clan {
	pub id: f64,
	pub logo: String,
	pub name: String,
	#[serde(rename = "shortName")]
	pub short_name: String,
	pub description: String,
	pub captain: String,
	pub founders: Vec<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub x_url: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub instagram_url: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub tiktok_url: Option<String>,
	pub fame: f64,
	pub xp: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub rank: Option<Rank>,
	pub created_at: Timestamp,
	#[serde(rename = "isPro")]
	pub is_pro: bool,
	#[serde(rename = "isRecruiting")]
	pub is_recruiting: bool,
	#[serde(rename = "autoRecruit")]
	pub auto_recruit: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub langue: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanApplicationDto {
	pub id: f64,
	pub user: UserDto,
	pub clan: ClanDto,
	pub distinctions: Vec<ClanMemberDistinction>,
	#[serde(rename = "createdAt")]
	pub created_at: Timestamp,
	#[serde(rename = "updatedAt")]
	pub updated_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanApplicationResult {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	/// `true` quand le clan accepte automatiquement les candidatures.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub autojoin: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanDto {
	pub id: f64,
	/// Identifiants Discord des fondateurs.
	///
	/// L'API en renvoie un TABLEAU. Le contrat disait `string`, donc la
	/// validation rejetait chaque clan : les 42 clans existaient, l'API les
	/// servait, et la page affichait « 0 clan trouvé ».
	pub founders: Vec<String>,
	pub name: String,
	#[serde(rename = "shortenedName")]
	pub shortened_name: String,
	#[serde(rename = "normalizedShortName")]
	pub normalized_short_name: String,
	#[serde(rename = "clanAvatarUrl")]
	pub clan_avatar_url: String,
	#[serde(rename = "clanBiography")]
	pub clan_biography: String,
	/// Absent de la charge utile de `GET /clans` : optionnel.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub fame: Option<f64>,
	#[serde(rename = "xUrl", default, skip_serializing_if = "Option::is_none")]
	pub x_url: Option<String>,
	#[serde(rename = "instagramUrl", default, skip_serializing_if = "Option::is_none")]
	pub instagram_url: Option<String>,
	#[serde(rename = "tiktokUrl", default, skip_serializing_if = "Option::is_none")]
	pub tiktok_url: Option<String>,
	#[serde(rename = "isRecruiting")]
	pub is_recruiting: bool,
	#[serde(rename = "isInactive")]
	pub is_inactive: bool,
	#[serde(rename = "isHidden")]
	pub is_hidden: bool,
	#[serde(rename = "isDisbanded")]
	pub is_disbanded: bool,
	#[serde(rename = "autoAcceptMembers")]
	pub auto_accept_members: bool,
	pub state: ClanState,
	#[serde(rename = "createdAt")]
	pub created_at: Timestamp,
	pub languages: Vec<String>,
	pub origin: String,
	pub experience: serde_json::Value,
	#[serde(rename = "membersCount")]
	pub members_count: f64,
	pub president: UserDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanInviteDto {
	pub id: f64,
	pub user: UserDto,
	pub clan: ClanDto,
	pub inviter: ClanMemberDto,
	#[serde(rename = "threadId", default, skip_serializing_if = "Option::is_none")]
	pub thread_id: Option<String>,
	pub distinctions: Vec<ClanMemberDistinction>,
	#[serde(rename = "createdAt")]
	pub created_at: Timestamp,
	#[serde(rename = "updatedAt")]
	pub updated_at: Timestamp,
	#[serde(rename = "lastNotifiedAt")]
	pub last_notified_at: Timestamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ClanMemberDistinction {
	#[serde(rename = "Joueur")]
	Player,
	#[serde(rename = "Staff")]
	Staff,
	#[serde(rename = "Artiste")]
	Artist,
	#[serde(rename = "Créateur de contenu")]
	ContentCreator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanMemberDto {
	/// Rôle du membre dans le clan (Trial, Member, SubCaptain, Captain).
	#[serde(rename = "clanRole")]
	pub clan_role: ClanMemberRole,
	/// Distinctions brutes telles que stockées (`['Staff', 'Player']`).
	pub distinctions: Vec<String>,
	#[serde(rename = "clanFameContributed")]
	pub clan_fame_contributed: f64,
	#[serde(rename = "createdAt")]
	pub created_at: Timestamp,
	#[serde(rename = "updatedAt")]
	pub updated_at: Timestamp,
	pub user: UserDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanMemberLimits {
	#[serde(rename = "playerLimit")]
	pub player_limit: f64,
	#[serde(rename = "staffLimit")]
	pub staff_limit: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum ClanMemberRole {
	Trial = 0,
	Member = 1,
	SubCaptain = 2,
	Captain = 3,
}

/// `GET /clans/role` — `-1` quand l'appelant n'est dans aucun clan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClanRoleResponse {
	pub role: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum ClanState {
	Creating = 0,
	PendingReview = 1,
	Approved = 2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloseTournamentResult {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(rename = "openLobbies", default, skip_serializing_if = "Option::is_none")]
	pub open_lobbies: Option<f64>,
}

/// Descripteur de colonne — partagé par toutes les tables, quel que soit l'UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Column {
	pub field: String,
	pub header: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandUsageRow {
	pub date: String,
	#[serde(rename = "slashCommands")]
	pub slash_commands: f64,
	#[serde(rename = "simpleCommands")]
	pub simple_commands: f64,
	#[serde(rename = "contextMenus")]
	pub context_menus: f64,
}

/// Stats agrégées d'un mode de compétition (interclans / tournois).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompetitionStats {
	/// Nombre d'événements distincts (tournois / interclans) auxquels le joueur a participé.
	pub total: f64,
	/// Victoires d'équipe / de clan (contrib).
	pub wins: f64,
	/// Défaites d'équipe / de clan (contrib).
	pub losses: f64,
	/// Nuls d'équipe (si applicable).
	pub draws: f64,
	#[serde(rename = "goalsScoredAvg")]
	pub goals_scored_avg: f64,
	#[serde(rename = "goalsReceivedAvg")]
	pub goals_received_avg: f64,
	/// Matchs individuels joués.
	#[serde(rename = "personalTotal")]
	pub personal_total: f64,
	#[serde(rename = "personalWins")]
	pub personal_wins: f64,
	#[serde(rename = "personalLosses")]
	pub personal_losses: f64,
	#[serde(rename = "personalDraws")]
	pub personal_draws: f64,
}

/// Pays / langue d'origine d'un clan ou d'une organisation.
///
/// La table de référence elle-même vit dans
/// `@rosegriffon/achillea-core/reference` : c'est une donnée, pas un contrat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Country {
	/// Code ISO 639-1 en minuscules (`fr`, `en`, …).
	pub code: String,
	/// Libellé de la langue en français (`Français`).
	pub language: String,
	/// Chemin du drapeau, relatif aux assets du front.
	pub flag: String,
	/// Nom du pays en français (`France`).
	pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCastEventPayload {
	pub name: String,
	pub kind: CastEventKind,
	#[serde(rename = "scheduledAt")]
	pub scheduled_at: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub duration: Option<f64>,
	#[serde(rename = "tournamentId", default, skip_serializing_if = "Option::is_none")]
	pub tournament_id: Option<String>,
	#[serde(rename = "twitchUrl", default, skip_serializing_if = "Option::is_none")]
	pub twitch_url: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub description: Option<String>,
	pub slots: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlayerNotePayload {
	#[serde(rename = "targetId")]
	pub target_id: String,
	#[serde(rename = "tournamentId", default, skip_serializing_if = "Option::is_none")]
	pub tournament_id: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub category: Option<PlayerNoteCategory>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub severity: Option<PlayerNoteSeverity>,
	pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSanctionPayload {
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "guildId")]
	pub guild_id: String,
	pub r#type: SanctionType,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub reason: Option<String>,
	#[serde(rename = "durationSec", default, skip_serializing_if = "Option::is_none")]
	pub duration_sec: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub evidence: Option<Vec<std::collections::HashMap<String, serde_json::Value>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyCountRow {
	pub date: String,
	pub count: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseBackupResult {
	pub message: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub data: Option<serde_json::Value>,
}

/// Métadonnée de colonne SQL — voisine de `Column`, mais côté base.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbColumn {
	pub name: String,
	#[serde(rename = "dataType")]
	pub data_type: String,
	pub nullable: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub default: Option<String>,
	#[serde(rename = "isPrimaryKey")]
	pub is_primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbMutationResult {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub row: Option<std::collections::HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbQueryResult {
	pub data: Vec<std::collections::HashMap<String, serde_json::Value>>,
	#[serde(rename = "rowCount")]
	pub row_count: f64,
	#[serde(rename = "durationMs")]
	pub duration_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbRowsPage {
	pub data: Vec<std::collections::HashMap<String, serde_json::Value>>,
	pub columns: Vec<DbColumn>,
	pub meta: PageMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbTableRow {
	pub name: String,
	#[serde(rename = "estimatedRows")]
	pub estimated_rows: f64,
	pub protected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisqualifyResult {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(rename = "forfeitedLobbies", default, skip_serializing_if = "Option::is_none")]
	pub forfeited_lobbies: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub promoted: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichedUserDto {
	#[serde(flatten)]
	pub base: UserDto,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub clan: Option<UserClanSummary>,
	pub interclans: CompetitionStats,
	/// Stats de matchs de tournoi (brackets / swiss).
	pub tournaments: CompetitionStats,
	pub ranked: serde_json::Value,
	/// Éditable par le titulaire du profil (PUT /users/me/profile).
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub bio: Option<String>,
	#[serde(rename = "twitchUrl", default, skip_serializing_if = "Option::is_none")]
	pub twitch_url: Option<String>,
}

/// Relation sérialisée par l'ORM : soit l'identifiant seul, soit l'entité
/// peuplée, selon que la requête a chargé la relation ou non. Un client doit
/// gérer les deux cas — d'où ce type plutôt qu'un objet supposé toujours présent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EntityRef<T> where T: Serialize + serde::de::DeserializeOwned {
	Id(f64),
	Entity(T),
}

/// Racine commune à tout évènement compétitif (tournoi, interclan, ranked).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEntity {
	pub id: f64,
	pub name: String,
	pub description: String,
	pub r#type: EventTypeEnum,
	#[serde(rename = "createdAt")]
	pub created_at: Timestamp,
	#[serde(rename = "updatedAt")]
	pub updated_at: Timestamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EventTypeEnum {
	#[serde(rename = "TOURNAMENT")]
	Tournament,
	#[serde(rename = "INTERCLAN")]
	Interclan,
	#[serde(rename = "RANKED")]
	Ranked,
}

/// Mode d'un formulaire de validation (création / revue / édition).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum FormMode {
	Create = 0,
	Validate = 1,
	Edit = 2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameScoreDto {
	#[serde(rename = "lobbyId")]
	pub lobby_id: f64,
	#[serde(rename = "gameNumber")]
	pub game_number: f64,
	pub score1: f64,
	pub score2: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameValidatorDto {
	#[serde(rename = "lobbyId")]
	pub lobby_id: f64,
	#[serde(rename = "lobbyMatchId")]
	pub lobby_match_id: f64,
}

/// `brackets-model#GrandFinalType`.
pub type GrandFinalType = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResponse {
	pub online: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub uptime: Option<f64>,
	#[serde(rename = "lastStartup", default, skip_serializing_if = "Option::is_none")]
	pub last_startup: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerationResult {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum InterclanState {
	PendingApproval = 0,
	Approved = 1,
	Denied = 2,
	Ready = 3,
	Ongoing = 4,
	Finished = 5,
	Canceled = 6,
	ResultOk = 7,
	ResultNok = 8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardEntry {
	pub rank: f64,
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub avatar: String,
	pub elo: f64,
	#[serde(rename = "peakRating")]
	pub peak_rating: f64,
	#[serde(rename = "gamesPlayed")]
	pub games_played: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaderboardPage {
	pub entries: Vec<LeaderboardEntry>,
	pub total: f64,
	pub mode: MatchMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeagueListResponse {
	pub items: Vec<LeagueSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeagueMatchRow {
	#[serde(rename = "homeId")]
	pub home_id: String,
	#[serde(rename = "awayId")]
	pub away_id: String,
	#[serde(rename = "homeScore")]
	pub home_score: f64,
	#[serde(rename = "awayScore")]
	pub away_score: f64,
	pub matchday: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub overtime: Option<bool>,
	#[serde(rename = "winnerId", default, skip_serializing_if = "Option::is_none")]
	pub winner_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaguePointsConfig {
	/// Graphie servie par l'API.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub win: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub draw: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub loss: Option<f64>,
	/// Graphie historique du contrat, conservée pour les appelants existants.
	#[serde(rename = "winRegulation", default, skip_serializing_if = "Option::is_none")]
	pub win_regulation: Option<f64>,
	#[serde(rename = "lossRegulation", default, skip_serializing_if = "Option::is_none")]
	pub loss_regulation: Option<f64>,
	#[serde(rename = "winOvertime", default, skip_serializing_if = "Option::is_none")]
	pub win_overtime: Option<f64>,
	#[serde(rename = "lossOvertime", default, skip_serializing_if = "Option::is_none")]
	pub loss_overtime: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeagueSeasonPayload {
	pub meta: LeagueSummary,
	pub format: std::collections::HashMap<String, serde_json::Value>,
	pub teams: Vec<LeagueTeam>,
	#[serde(rename = "pointsConfig")]
	pub points_config: LeaguePointsConfig,
	pub standings: Vec<LeagueStandingRow>,
	pub results: Vec<LeagueMatchRow>,
	pub playoffs: serde_json::Value,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub schedule: Option<serde_json::Value>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub details: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeagueStandingRow {
	#[serde(rename = "teamId")]
	pub team_id: String,
	pub rank: f64,
	pub played: f64,
	pub wins: f64,
	pub draws: f64,
	pub losses: f64,
	#[serde(rename = "winsOt")]
	pub wins_ot: f64,
	#[serde(rename = "lossesOt")]
	pub losses_ot: f64,
	pub points: f64,
	#[serde(rename = "mapDiff")]
	pub map_diff: f64,
	#[serde(rename = "mapsFor")]
	pub maps_for: f64,
	#[serde(rename = "mapsAgainst")]
	pub maps_against: f64,
}

/// Formes de championnat exposées par l'API.
///
/// Le calcul (classement, points, calendrier) vit dans
/// `@rosegriffon/achillea-core/league` ; seules les formes échangées sont ici,
/// pour qu'un client n'ait pas à dépendre de la logique métier pour lire une
/// réponse.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeagueSummary {
	pub id: String,
	pub name: String,
	pub season: String,
	pub format: String,
	pub description: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub champion: Option<String>,
	#[serde(rename = "teamCount")]
	pub team_count: f64,
	pub matchdays: f64,
	pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeagueTeam {
	pub tag: String,
	pub name: String,
}

/// Licence joueur — un titulaire = un userId Discord, une licence active à la
/// fois, vérifiable publiquement via un QR code.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct License {
	pub id: String,
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "licenseNumber")]
	pub license_number: String,
	#[serde(rename = "issuedAt")]
	pub issued_at: String,
	#[serde(rename = "validUntil")]
	pub valid_until: String,
	pub status: LicenseStatus,
	/// Nullable until the printable licence PDF has been generated.
	#[serde(rename = "pdfUrl", default, skip_serializing_if = "Option::is_none")]
	pub pdf_url: Option<String>,
	#[serde(rename = "createdAt")]
	pub created_at: String,
	#[serde(rename = "updatedAt")]
	pub updated_at: String,
}

/// `GET /licenses/me` — `null` tant qu'aucune licence n'a été émise.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseHolderResponse {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub license: Option<License>,
	/// Owner-only bearer token used to share the public verification URL.
	#[serde(rename = "verificationToken", default, skip_serializing_if = "Option::is_none")]
	pub verification_token: Option<String>,
}

/// État d'une licence joueur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LicenseStatus {
	#[serde(rename = "Active")]
	Active,
	#[serde(rename = "Revoked")]
	Revoked,
	#[serde(rename = "Expired")]
	Expired,
}

/// Motif d'invalidité renvoyé par la vérification publique.
pub type LicenseVerifyReason = String;

/// Résultat de `GET /licenses/verify/{qr}` (endpoint PUBLIC, sans auth).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseVerifyResult {
	pub valid: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub reason: Option<LicenseVerifyReason>,
	#[serde(rename = "licenseNumber", default, skip_serializing_if = "Option::is_none")]
	pub license_number: Option<String>,
	#[serde(rename = "validUntil", default, skip_serializing_if = "Option::is_none")]
	pub valid_until: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub holder: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LobbyDto {
	pub id: f64,
	pub mode: MatchMode,
	pub state: LobbyState,
	#[serde(rename = "bracketMatchId", default, skip_serializing_if = "Option::is_none")]
	pub bracket_match_id: Option<f64>,
	#[serde(rename = "lobbyUsers")]
	pub lobby_users: Vec<LobbyUserDto>,
	#[serde(rename = "lobbyMatches")]
	pub lobby_matches: Vec<LobbyMatchDto>,
	#[serde(rename = "hostUser", default, skip_serializing_if = "Option::is_none")]
	pub host_user: Option<LobbyUserDto>,
	#[serde(rename = "matchFormat", default, skip_serializing_if = "Option::is_none")]
	pub match_format: Option<MatchFormat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LobbyMatchDto {
	pub id: f64,
	#[serde(rename = "gameNumber")]
	pub game_number: f64,
	#[serde(rename = "scoreTeam1")]
	pub score_team1: f64,
	#[serde(rename = "scoreTeam2")]
	pub score_team2: f64,
	#[serde(rename = "team1Validated")]
	pub team1_validated: bool,
	#[serde(rename = "team2Validated")]
	pub team2_validated: bool,
	#[serde(rename = "adminValidated")]
	pub admin_validated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LobbyState {
	#[serde(rename = "Fresh")]
	Fresh,
	#[serde(rename = "Ongoing")]
	Ongoing,
	#[serde(rename = "Pending validation")]
	PendingValidation,
	#[serde(rename = "Contested")]
	Contested,
	#[serde(rename = "Finished")]
	Finished,
	#[serde(rename = "Canceled")]
	Canceled,
	#[serde(rename = "Forfeited")]
	Forfeited,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LobbyUserDataDto {
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub id: String,
	pub avatar: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LobbyUserDto {
	pub id: f64,
	pub user: LobbyUserDataDto,
	pub team: TeamSide,
	pub forfeit: bool,
	pub state: LobbyUserState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LobbyUserState {
	#[serde(rename = "Pending")]
	Pending,
	#[serde(rename = "Ready")]
	Ready,
	#[serde(rename = "Afk")]
	Afk,
	#[serde(rename = "Ongoing")]
	Ongoing,
	#[serde(rename = "Finished")]
	Finished,
	#[serde(rename = "Repooled")]
	Repooled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceResponse {
	pub maintenance: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MatchFormat {
	#[serde(rename = "bo1")]
	Bo1,
	#[serde(rename = "bo3")]
	Bo3,
	#[serde(rename = "bo5")]
	Bo5,
	#[serde(rename = "double_leg")]
	DoubleLeg,
	#[serde(rename = "custom")]
	Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum MatchMode {
	OneVsOne = 2,
	TwoVsTwo = 4,
}

pub type MatchResult = String;

pub type MatchRoomStatus = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModerationSyncResult {
	pub ok: bool,
	#[serde(rename = "sanctionId")]
	pub sanction_id: String,
}

/// Création d'un clan (POST /clans/create, API Achilléa historique).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewClanPayload {
	pub founders: Vec<serde_json::Value>,
	pub logo: String,
	pub name: String,
	#[serde(rename = "normalizedName")]
	pub normalized_name: String,
	#[serde(rename = "shortName")]
	pub short_name: String,
	#[serde(rename = "normalizedShortName")]
	pub normalized_short_name: String,
	pub description: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub twitter: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub instagram: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub tiktok: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub origin: Option<Country>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub languages: Option<Vec<Country>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewClanResponse {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(rename = "clanId", default, skip_serializing_if = "Option::is_none")]
	pub clan_id: Option<f64>,
	/// Renseigné sur un conflit de nom (409).
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub conflict: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewTournamentDto {
	pub name: String,
	pub description: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub series: Option<TournamentSeries>,
	pub organization: serde_json::Value,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub managers: Option<Vec<UserDto>>,
	#[serde(rename = "startsAt")]
	pub starts_at: Timestamp,
	#[serde(rename = "grandFinalAt")]
	pub grand_final_at: Timestamp,
	#[serde(rename = "tournamentType")]
	pub tournament_type: StageType,
	#[serde(rename = "participantsNumber", default, skip_serializing_if = "Option::is_none")]
	pub participants_number: Option<f64>,
	#[serde(rename = "seedOrdering", default, skip_serializing_if = "Option::is_none")]
	pub seed_ordering: Option<SeedOrdering>,
	#[serde(rename = "matchFormat", default, skip_serializing_if = "Option::is_none")]
	pub match_format: Option<MatchFormat>,
	#[serde(rename = "customFormatChildCount", default, skip_serializing_if = "Option::is_none")]
	pub custom_format_child_count: Option<f64>,
	#[serde(rename = "groupStageEnabled")]
	pub group_stage_enabled: bool,
	#[serde(rename = "groupStageType", default, skip_serializing_if = "Option::is_none")]
	pub group_stage_type: Option<StageType>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub affiche: Option<String>,
	pub logo: String,
	pub ruleset: String,
	pub planning: String,
	/// Planning automatisé — facultatif : sans dates, le tournoi se conduit à la main.
	#[serde(rename = "registrationOpensAt", default, skip_serializing_if = "Option::is_none")]
	pub registration_opens_at: Option<serde_json::Value>,
	#[serde(rename = "registrationClosesAt", default, skip_serializing_if = "Option::is_none")]
	pub registration_closes_at: Option<serde_json::Value>,
	#[serde(rename = "autoStart", default, skip_serializing_if = "Option::is_none")]
	pub auto_start: Option<bool>,
	/// Rôle Discord distribué aux inscrits.
	#[serde(rename = "discordRoleEnabled", default, skip_serializing_if = "Option::is_none")]
	pub discord_role_enabled: Option<bool>,
	/// Qui saisit les scores des matchs (défaut : les joueurs).
	#[serde(rename = "scoreReportPolicy", default, skip_serializing_if = "Option::is_none")]
	pub score_report_policy: Option<ScoreReportPolicy>,
	/// Dérogation aux règles de publication — SuperAdmin uniquement, côté API.
	#[serde(rename = "bypassRules", default, skip_serializing_if = "Option::is_none")]
	pub bypass_rules: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum NotificationCategory {
	User = 0,
	Clan = 1,
	Global = 2,
	Organization = 3,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationModel {
	pub id: f64,
	pub title: String,
	pub message: String,
	pub r#type: NotificationType,
	pub category: NotificationCategory,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub payload: Option<std::collections::HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum NotificationType {
	NewOrganizationCreationRequest = 0,
	NewOrganizationEditionRequest = 1,
	NewOrganizationEditReply = 2,
	NewOrganizationAcceptReply = 3,
	NewOrganizationRejectReply = 4,
	ClanMemberKick = 5,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenRegistrationsResult {
	pub success: bool,
	pub id: f64,
	#[serde(rename = "internalState")]
	pub internal_state: TournamentState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizationDto {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub id: Option<serde_json::Value>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub state: Option<OrganizationState>,
	pub name: String,
	#[serde(rename = "normalizedName")]
	pub normalized_name: String,
	pub logo: String,
	pub description: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub owner: Option<serde_json::Value>,
	#[serde(rename = "orgManagers", default, skip_serializing_if = "Option::is_none")]
	pub org_managers: Option<Vec<UserDto>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub managers: Option<Vec<OrgManagerDto>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub preapproved: Option<bool>,
	#[serde(rename = "socialMedias", default, skip_serializing_if = "Option::is_none")]
	pub social_medias: Option<Vec<SocialMediaDto>>,
	#[serde(rename = "broadcastMedias", default, skip_serializing_if = "Option::is_none")]
	pub broadcast_medias: Option<Vec<SocialMediaDto>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub origin: Option<serde_json::Value>,
	#[serde(rename = "createdAt", default, skip_serializing_if = "Option::is_none")]
	pub created_at: Option<Timestamp>,
	#[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
	pub updated_at: Option<Timestamp>,
}

/// Cycle de revue d'une organisation (structure e-sport).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum OrganizationState {
	Pending = 0,
	Approved = 1,
	Rejected = 2,
}

/// Revue d'une demande de création / édition d'organisation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrganizationValidationDto {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub id: Option<serde_json::Value>,
	pub reviewer: UserDto,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub name: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub logo: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub description: Option<String>,
	#[serde(rename = "twitterUrl", default, skip_serializing_if = "Option::is_none")]
	pub twitter_url: Option<String>,
	#[serde(rename = "instagramUrl", default, skip_serializing_if = "Option::is_none")]
	pub instagram_url: Option<String>,
	#[serde(rename = "tiktokUrl", default, skip_serializing_if = "Option::is_none")]
	pub tiktok_url: Option<String>,
	#[serde(rename = "twitchUrl", default, skip_serializing_if = "Option::is_none")]
	pub twitch_url: Option<String>,
	#[serde(rename = "youtubeUrl", default, skip_serializing_if = "Option::is_none")]
	pub youtube_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgManagerDto {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub organization: Option<serde_json::Value>,
	pub user: UserDto,
	#[serde(rename = "createdAt", default, skip_serializing_if = "Option::is_none")]
	pub created_at: Option<Timestamp>,
	#[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
	pub updated_at: Option<Timestamp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PagedList<T> where T: Serialize + serde::de::DeserializeOwned {
	pub data: Vec<T>,
	pub total: f64,
	pub meta: PageSizeMeta,
}

/// Métadonnées de page renvoyées par l'API (style `Paginated<T>` historique).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageMeta {
	/// Seul `total` est garanti.
	///
	/// Mesuré sur `GET /clans` : l'API renvoie `{ total, pageCount: null }`. Une
	/// enveloppe de pagination ne doit jamais pouvoir invalider sa charge utile —
	/// exiger ces champs effaçait les 42 clans pour une histoire de compteur.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub page: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub limit: Option<f64>,
	pub total: f64,
	#[serde(rename = "pageCount", default, skip_serializing_if = "Option::is_none")]
	pub page_count: Option<f64>,
}

/// Requête de pagination commune à toutes les listes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageQuery {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub page: Option<f64>,
	#[serde(rename = "pageSize", default, skip_serializing_if = "Option::is_none")]
	pub page_size: Option<f64>,
}

/// Variante « pageSize » utilisée par les contrôleurs récents (casts, sanctions,
/// notes joueur). Conservée distincte de `PageMeta` : les deux formes coexistent
/// réellement sur l'API, les fusionner casserait un des deux appelants.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageSizeMeta {
	pub page: f64,
	#[serde(rename = "pageSize")]
	pub page_size: f64,
	#[serde(rename = "pageCount")]
	pub page_count: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Paginated<T> where T: Serialize + serde::de::DeserializeOwned {
	pub data: Vec<T>,
	pub meta: PageMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantDto {
	pub id: f64,
	pub tournament: Tournament,
	pub user: UserDto,
	#[serde(rename = "bracketParticipantId", default, skip_serializing_if = "Option::is_none")]
	pub bracket_participant_id: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub seed: Option<f64>,
	#[serde(rename = "hasCheckedIn")]
	pub has_checked_in: bool,
	/// Absent sur les réponses d'API antérieures au statut : traiter comme `ACTIVE`.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub status: Option<ParticipantStatus>,
	#[serde(rename = "registeredAt", default, skip_serializing_if = "Option::is_none")]
	pub registered_at: Option<String>,
	/// Rang dans la liste d'attente (1 = prochain promu).
	#[serde(rename = "waitlistPosition", default, skip_serializing_if = "Option::is_none")]
	pub waitlist_position: Option<f64>,
	/// Motif de DQ — renseigné uniquement pour les organisateurs.
	#[serde(rename = "statusReason", default, skip_serializing_if = "Option::is_none")]
	pub status_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantMutationResult {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub participant: Option<WireParticipant>,
}

/// Statut d'un inscrit à un tournoi.
///
/// Un seul axe pour deux besoins qui portaient sur la même ligne : la liste d'attente
/// quand le tournoi est plein, et la disqualification. Seuls les `Active` comptent dans
/// la capacité, le seeding et le bracket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ParticipantStatus {
	#[serde(rename = "Active")]
	Active,
	#[serde(rename = "Waitlisted")]
	Waitlisted,
	#[serde(rename = "Disqualified")]
	Disqualified,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacementPrizesResult {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub applied: Option<bool>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub reason: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub deltas: Option<std::collections::HashMap<String, f64>>,
	#[serde(rename = "tournamentSize", default, skip_serializing_if = "Option::is_none")]
	pub tournament_size: Option<f64>,
}

/// Profil circuit d'un joueur — page profil public `/users/:id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerCircuitProfile {
	#[serde(rename = "tournamentsPlayed")]
	pub tournaments_played: f64,
	pub points: f64,
	pub tier: String,
	pub wins: f64,
	pub podiums: f64,
	pub top4: f64,
	pub top8: f64,
	#[serde(rename = "bestRankLabel")]
	pub best_rank_label: String,
	#[serde(rename = "goalsScored")]
	pub goals_scored: f64,
	#[serde(rename = "goalsConceded")]
	pub goals_conceded: f64,
	#[serde(rename = "goalAverage")]
	pub goal_average: f64,
	#[serde(rename = "bestStreak")]
	pub best_streak: f64,
	pub history: Vec<PlayerTournamentHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerNote {
	pub id: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub target: Option<PlayerNotePerson>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub author: Option<PlayerNotePerson>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub tournament: Option<serde_json::Value>,
	pub category: PlayerNoteCategory,
	pub severity: PlayerNoteSeverity,
	pub content: String,
	pub resolved: bool,
	#[serde(rename = "resolvedAt", default, skip_serializing_if = "Option::is_none")]
	pub resolved_at: Option<String>,
	#[serde(rename = "resolvedBy", default, skip_serializing_if = "Option::is_none")]
	pub resolved_by: Option<PlayerNotePerson>,
	#[serde(rename = "createdAt")]
	pub created_at: String,
	#[serde(rename = "updatedAt")]
	pub updated_at: String,
	/// Registre Drive où le signalement a été consigné (null si Drive non configuré).
	#[serde(rename = "docsUrl", default, skip_serializing_if = "Option::is_none")]
	pub docs_url: Option<String>,
}

/// Notes du staff sur un joueur (« espace dédié » où les organisateurs consignent ce
/// qu'ils ont à dire d'un joueur pendant un tournoi, lisible des autres admins).
///
/// Distinct des sanctions : une note est une observation, pas une décision. Elle
/// n'entraîne aucune conséquence automatique et n'est jamais montrée au joueur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PlayerNoteCategory {
	#[serde(rename = "behavior")]
	Behavior,
	#[serde(rename = "cheating")]
	Cheating,
	#[serde(rename = "no_show")]
	NoShow,
	#[serde(rename = "score_dispute")]
	ScoreDispute,
	#[serde(rename = "positive")]
	Positive,
	#[serde(rename = "other")]
	Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerNoteFilters {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub page: Option<f64>,
	#[serde(rename = "pageSize", default, skip_serializing_if = "Option::is_none")]
	pub page_size: Option<f64>,
	#[serde(rename = "targetId", default, skip_serializing_if = "Option::is_none")]
	pub target_id: Option<String>,
	#[serde(rename = "tournamentId", default, skip_serializing_if = "Option::is_none")]
	pub tournament_id: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub category: Option<PlayerNoteCategory>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub severity: Option<PlayerNoteSeverity>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub resolved: Option<bool>,
}

/// Filtres additionnels acceptés par la liste des notes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerNoteFiltersExtra {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub category: Option<PlayerNoteCategory>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub severity: Option<PlayerNoteSeverity>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub search: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerNoteListResponse {
	pub data: Vec<PlayerNote>,
	pub total: f64,
	pub meta: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerNotePerson {
	pub id: String,
	pub username: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub avatar: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PlayerNoteSeverity {
	#[serde(rename = "info")]
	Info,
	#[serde(rename = "warning")]
	Warning,
	#[serde(rename = "serious")]
	Serious,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerNoteSummary {
	pub total: f64,
	pub open: f64,
	#[serde(rename = "bySeverity")]
	pub by_severity: std::collections::HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerTournamentHistoryEntry {
	#[serde(rename = "tournamentId")]
	pub tournament_id: f64,
	#[serde(rename = "tournamentName")]
	pub tournament_name: String,
	#[serde(rename = "grandFinalAt")]
	pub grand_final_at: String,
	pub size: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub rank: Option<f64>,
	#[serde(rename = "rankLabel")]
	pub rank_label: String,
	pub points: f64,
	pub tier: String,
	#[serde(rename = "goalsScored")]
	pub goals_scored: f64,
	#[serde(rename = "goalsConceded")]
	pub goals_conceded: f64,
}

/// Palier de classement nommé (bornes Elo + dégradé).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rank {
	pub label: String,
	#[serde(rename = "minElo")]
	pub min_elo: f64,
	#[serde(rename = "maxElo")]
	pub max_elo: f64,
	pub gradient: Vec<String>,
}

/// Palier de rang tel qu'exposé sur un profil (clé FR + dégradé d'affichage).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankDto {
	pub elo: f64,
	pub key: String,
	pub gradient: Vec<String>,
}

/// Un match ranked EN COURS (lobby `Ongoing`), avec son état live persisté.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedActiveMatch {
	#[serde(rename = "lobbyId")]
	pub lobby_id: f64,
	pub mode: MatchMode,
	#[serde(rename = "createdAt")]
	pub created_at: String,
	/// Domicile (team 1).
	pub player1: RankedActivePlayer,
	/// Extérieur (team 2).
	pub player2: RankedActivePlayer,
}

/// Un joueur d'un match EN COURS (vue admin « Matchs en cours »).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedActivePlayer {
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub score: f64,
	#[serde(rename = "claimedOpponentScore", default, skip_serializing_if = "Option::is_none")]
	pub claimed_opponent_score: Option<f64>,
	pub submitted: bool,
	#[serde(rename = "hasProof")]
	pub has_proof: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedAdminDispute {
	#[serde(rename = "lobbyId")]
	pub lobby_id: f64,
	pub mode: MatchMode,
	pub player1: RankedDisputePlayer,
	pub player2: RankedDisputePlayer,
	#[serde(rename = "createdAt")]
	pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedAdminSeason {
	pub id: String,
	pub name: String,
	pub state: SeasonState,
	#[serde(rename = "startsAt")]
	pub starts_at: String,
	#[serde(rename = "endsAt")]
	pub ends_at: String,
	pub config: RankedSeasonConfig,
	#[serde(rename = "playerCount")]
	pub player_count: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedAdminValidateRequest {
	#[serde(rename = "scoreTeam1")]
	pub score_team1: f64,
	#[serde(rename = "scoreTeam2")]
	pub score_team2: f64,
	#[serde(rename = "forfeitUserId", default, skip_serializing_if = "Option::is_none")]
	pub forfeit_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedAdminValidateResult {
	pub ok: bool,
	#[serde(rename = "eloDelta", default, skip_serializing_if = "Option::is_none")]
	pub elo_delta: Option<f64>,
}

/// `POST /ranked/challenge/:code/accept` — la réservation temps réel est opaque.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedChallengeAccepted {
	pub reservation: serde_json::Value,
	pub mode: f64,
	pub ranked: bool,
}

/// Défi par lien partageable créé par le joueur courant (en attente d'acceptation).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedChallengeLink {
	pub code: String,
	pub url: String,
	pub mode: MatchMode,
	pub ranked: bool,
	#[serde(rename = "toUserId", default, skip_serializing_if = "Option::is_none")]
	pub to_user_id: Option<String>,
	#[serde(rename = "expiresAt")]
	pub expires_at: f64,
}

/// Aperçu d'un défi reçu via un lien.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedChallengePreview {
	pub code: String,
	#[serde(rename = "fromUserId")]
	pub from_user_id: String,
	#[serde(rename = "fromDisplayName")]
	pub from_display_name: String,
	#[serde(rename = "fromAvatar")]
	pub from_avatar: String,
	#[serde(rename = "fromElo")]
	pub from_elo: f64,
	pub mode: MatchMode,
	pub ranked: bool,
	#[serde(rename = "isOwn")]
	pub is_own: bool,
	#[serde(rename = "expiresAt")]
	pub expires_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedChatMessage {
	#[serde(rename = "userId")]
	pub user_id: String,
	pub text: String,
	pub at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedDisputePlayer {
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	/// Score que CE joueur réclame pour lui-même.
	#[serde(rename = "submittedScore")]
	pub submitted_score: f64,
	/// Score qu'il attribue à l'adversaire.
	#[serde(rename = "claimedOpponentScore", default, skip_serializing_if = "Option::is_none")]
	pub claimed_opponent_score: Option<f64>,
	#[serde(rename = "screenshotUrl", default, skip_serializing_if = "Option::is_none")]
	pub screenshot_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedDisputeRequest {
	#[serde(rename = "lobbyId")]
	pub lobby_id: f64,
	#[serde(rename = "screenshotUrl")]
	pub screenshot_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedHistoryEntry {
	#[serde(rename = "lobbyId")]
	pub lobby_id: f64,
	pub mode: MatchMode,
	pub state: String,
	#[serde(rename = "endedAt")]
	pub ended_at: String,
	#[serde(rename = "myScore")]
	pub my_score: f64,
	#[serde(rename = "opponentScore")]
	pub opponent_score: f64,
	#[serde(rename = "eloDelta")]
	pub elo_delta: f64,
	pub result: MatchResult,
	pub opponent: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedLadderResetResult {
	pub ok: bool,
	pub affected: f64,
}

/// Joueur présent dans le salon de présence ranked, pour le défi direct.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedLobbyPlayer {
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub avatar: String,
	pub elo: f64,
	pub mode: f64,
}

/// Un événement de télémétrie ranked (journal du flow des matchs, vue staff).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedMatchEvent {
	pub id: f64,
	#[serde(rename = "createdAt")]
	pub created_at: String,
	#[serde(rename = "lobbyId", default, skip_serializing_if = "Option::is_none")]
	pub lobby_id: Option<f64>,
	#[serde(rename = "roomCode", default, skip_serializing_if = "Option::is_none")]
	pub room_code: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub mode: Option<f64>,
	#[serde(rename = "userId", default, skip_serializing_if = "Option::is_none")]
	pub user_id: Option<String>,
	#[serde(rename = "displayName", default, skip_serializing_if = "Option::is_none")]
	pub display_name: Option<String>,
	pub r#type: String,
	pub detail: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedMatchSummary {
	#[serde(rename = "lobbyId")]
	pub lobby_id: f64,
	#[serde(rename = "roomCode")]
	pub room_code: String,
	pub mode: MatchMode,
	/// `false` = partie amicale (aucun ELO appliqué).
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub ranked: Option<bool>,
	pub opponent: serde_json::Value,
	pub result: MatchResult,
	#[serde(rename = "myScore")]
	pub my_score: f64,
	#[serde(rename = "opponentScore")]
	pub opponent_score: f64,
	#[serde(rename = "eloBefore")]
	pub elo_before: f64,
	#[serde(rename = "eloAfter")]
	pub elo_after: f64,
	#[serde(rename = "eloDelta")]
	pub elo_delta: f64,
	#[serde(rename = "newTier", default, skip_serializing_if = "Option::is_none")]
	pub new_tier: Option<RankTier>,
	#[serde(rename = "endedAt")]
	pub ended_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedModeStats {
	pub mode: MatchMode,
	pub total: f64,
	pub wins: f64,
	pub losses: f64,
	pub draws: f64,
	#[serde(rename = "goalsScored")]
	pub goals_scored: f64,
	#[serde(rename = "goalsReceived")]
	pub goals_received: f64,
}

/// Compteurs synthétiques du ranked (vue admin overview).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedOverview {
	#[serde(rename = "activeMatches")]
	pub active_matches: f64,
	#[serde(rename = "contestedMatches")]
	pub contested_matches: f64,
	#[serde(rename = "finishedToday")]
	pub finished_today: f64,
	#[serde(rename = "matchesToday")]
	pub matches_today: f64,
	#[serde(rename = "totalPlayers")]
	pub total_players: f64,
}

/// Invitation reçue (on est défié par un autre joueur).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedPendingInvite {
	#[serde(rename = "fromUserId")]
	pub from_user_id: String,
	#[serde(rename = "fromDisplayName")]
	pub from_display_name: String,
	#[serde(rename = "fromAvatar")]
	pub from_avatar: String,
	#[serde(rename = "fromElo")]
	pub from_elo: f64,
	pub mode: MatchMode,
	/// Classé (ELO) ou non classé (amical).
	pub ranked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedPlayerView {
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub avatar: String,
	pub elo: f64,
	/// Côté terrain : 1 = domicile (1er joueur), 2 = extérieur (2e joueur). 0 = non assigné.
	pub team: f64,
	/// Saisie du score (double validation), du point de vue du joueur (−1 = non saisi).
	#[serde(rename = "myScore")]
	pub my_score: f64,
	#[serde(rename = "oppScore")]
	pub opp_score: f64,
	/// A cliqué « Début de match ».
	#[serde(rename = "startedMatch")]
	pub started_match: bool,
	/// A validé sa saisie de score.
	pub submitted: bool,
	/// A uploadé sa capture de preuve.
	#[serde(rename = "proofUploaded")]
	pub proof_uploaded: bool,
	/// A cliqué « Fin de match ».
	#[serde(rename = "confirmedFinish")]
	pub confirmed_finish: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedProfile {
	#[serde(rename = "userId")]
	pub user_id: String,
	pub mode: MatchMode,
	pub elo: f64,
	#[serde(rename = "peakRating")]
	pub peak_rating: f64,
	#[serde(rename = "gamesPlayed")]
	pub games_played: f64,
	pub wins: f64,
	pub losses: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub tier: Option<RankTier>,
	#[serde(rename = "seasonId", default, skip_serializing_if = "Option::is_none")]
	pub season_id: Option<String>,
	#[serde(rename = "globalRank", default, skip_serializing_if = "Option::is_none")]
	pub global_rank: Option<f64>,
	#[serde(rename = "totalPlayers", default, skip_serializing_if = "Option::is_none")]
	pub total_players: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub percentile: Option<f64>,
}

/// `POST /ranked/:lobbyId/dispute` — URL de la preuve stockée.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedProofUploaded {
	pub url: String,
}

/// Proposition de revanche reçue en temps réel (`rematch_offer`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedRematchOffer {
	pub code: String,
	#[serde(rename = "fromUserId")]
	pub from_user_id: String,
	#[serde(rename = "fromDisplayName")]
	pub from_display_name: String,
	#[serde(rename = "fromAvatar")]
	pub from_avatar: String,
	#[serde(rename = "fromElo")]
	pub from_elo: f64,
	pub mode: MatchMode,
	pub ranked: bool,
	pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedSeasonConfig {
	#[serde(rename = "kFactor")]
	pub k_factor: f64,
	#[serde(rename = "baseRating")]
	pub base_rating: f64,
	#[serde(rename = "decayRate")]
	pub decay_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedSeasonInput {
	pub name: String,
	#[serde(rename = "startsAt")]
	pub starts_at: String,
	#[serde(rename = "endsAt")]
	pub ends_at: String,
	pub config: RankedSeasonConfig,
}

/// Invitation envoyée (on a défié un joueur, en attente de sa réponse).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedSentInvite {
	#[serde(rename = "targetUserId")]
	pub target_user_id: String,
	#[serde(rename = "targetDisplayName")]
	pub target_display_name: String,
	pub mode: MatchMode,
	pub ranked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RankedState {
	#[serde(rename = "Open")]
	Open,
	#[serde(rename = "Locked")]
	Locked,
	#[serde(rename = "Validating presence")]
	ValidatingPresence,
	#[serde(rename = "Pairing")]
	Pairing,
	#[serde(rename = "Validating start")]
	ValidatingMatchStart,
	#[serde(rename = "Repooling")]
	Repooling,
	#[serde(rename = "Matching")]
	Matching,
	#[serde(rename = "Finished")]
	Finished,
	#[serde(rename = "Canceled")]
	Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedTierInfo {
	pub key: String,
	#[serde(rename = "minElo")]
	pub min_elo: f64,
	#[serde(rename = "maxElo")]
	pub max_elo: f64,
	pub gradient: Vec<String>,
	#[serde(rename = "emojiId", default, skip_serializing_if = "Option::is_none")]
	pub emoji_id: Option<String>,
	#[serde(rename = "emojiKey", default, skip_serializing_if = "Option::is_none")]
	pub emoji_key: Option<String>,
	#[serde(rename = "playerCount")]
	pub player_count: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedTrend {
	pub sparkline: Vec<f64>,
	#[serde(rename = "deltaPeriod")]
	pub delta_period: f64,
	#[serde(rename = "gamesInPeriod")]
	pub games_in_period: f64,
	#[serde(rename = "winRatePeriod")]
	pub win_rate_period: f64,
	pub days: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankTier {
	pub key: String,
	#[serde(rename = "minElo")]
	pub min_elo: f64,
	#[serde(rename = "maxElo")]
	pub max_elo: f64,
	#[serde(rename = "emojiId")]
	pub emoji_id: String,
	#[serde(rename = "emojiKey")]
	pub emoji_key: String,
	pub gradient: Vec<String>,
}

/// `GET /auth/token` — jeton court destiné au client temps réel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealtimeTokenResponse {
	pub token: String,
	#[serde(rename = "expiresIn")]
	pub expires_in: f64,
	#[serde(rename = "userId")]
	pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreTournamentResult {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
	#[serde(rename = "internalState", default, skip_serializing_if = "Option::is_none")]
	pub internal_state: Option<TournamentState>,
}

/// `brackets-model#RoundRobinMode`.
pub type RoundRobinMode = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sanction {
	pub id: String,
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "guildId")]
	pub guild_id: String,
	pub r#type: SanctionType,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub reason: Option<String>,
	#[serde(rename = "durationSec", default, skip_serializing_if = "Option::is_none")]
	pub duration_sec: Option<f64>,
	#[serde(rename = "issuedBy")]
	pub issued_by: String,
	#[serde(rename = "issuedByType")]
	pub issued_by_type: SanctionIssuerType,
	#[serde(rename = "expiresAt", default, skip_serializing_if = "Option::is_none")]
	pub expires_at: Option<String>,
	#[serde(rename = "revokedAt", default, skip_serializing_if = "Option::is_none")]
	pub revoked_at: Option<String>,
	#[serde(rename = "revokedBy", default, skip_serializing_if = "Option::is_none")]
	pub revoked_by: Option<String>,
	#[serde(rename = "revokeReason", default, skip_serializing_if = "Option::is_none")]
	pub revoke_reason: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub evidence: Option<Vec<std::collections::HashMap<String, serde_json::Value>>>,
	#[serde(rename = "createdAt")]
	pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SanctionFilters {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub page: Option<f64>,
	#[serde(rename = "pageSize", default, skip_serializing_if = "Option::is_none")]
	pub page_size: Option<f64>,
	#[serde(rename = "userId", default, skip_serializing_if = "Option::is_none")]
	pub user_id: Option<String>,
	#[serde(rename = "guildId", default, skip_serializing_if = "Option::is_none")]
	pub guild_id: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub r#type: Option<SanctionType>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub active: Option<bool>,
}

/// Origine d'une sanction (qui / quoi l'a émise).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SanctionIssuerType {
	#[serde(rename = "user")]
	User,
	#[serde(rename = "bot")]
	Bot,
	#[serde(rename = "staff")]
	Staff,
	#[serde(rename = "system")]
	System,
}

pub type SanctionListResponse = PagedList<Sanction>;

/// Types de sanction de modération.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SanctionType {
	#[serde(rename = "warn")]
	Warn,
	#[serde(rename = "mute")]
	Mute,
	#[serde(rename = "kick")]
	Kick,
	#[serde(rename = "ban")]
	Ban,
	#[serde(rename = "unmute")]
	Unmute,
	#[serde(rename = "unban")]
	Unban,
	#[serde(rename = "note")]
	Note,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScorePolicyResult {
	pub success: bool,
	#[serde(rename = "scoreReportPolicy")]
	pub score_report_policy: ScoreReportPolicy,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

/// Qui saisit les scores des matchs d'un tournoi.
///
/// `PLAYERS` est le comportement historique : les deux joueurs d'un lobby remplissent
/// eux-mêmes leur score, puis le valident chacun de leur côté (ou un organisateur
/// tranche). `STAFF_ONLY` réserve saisie et validation aux organisateurs — les joueurs
/// gardent la lecture du match, sans aucun bouton.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ScoreReportPolicy {
	#[serde(rename = "players")]
	Players,
	#[serde(rename = "staff_only")]
	StaffOnly,
}

pub type SeasonState = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedBatchResult {
	pub mode: String,
	#[serde(rename = "bracketUpdated")]
	pub bracket_updated: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub assignments: Option<Vec<serde_json::Value>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub cleared: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedingResult {
	#[serde(rename = "participantId")]
	pub participant_id: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub seed: Option<f64>,
	#[serde(rename = "previousSeed", default, skip_serializing_if = "Option::is_none")]
	pub previous_seed: Option<f64>,
	#[serde(rename = "swappedWith", default, skip_serializing_if = "Option::is_none")]
	pub swapped_with: Option<String>,
	#[serde(rename = "bracketUpdated")]
	pub bracket_updated: bool,
}

/// `brackets-model#SeedOrdering`.
pub type SeedOrdering = String;

/// Rang tel qu'embarqué dans une session ou une suggestion.
pub type SessionRankDto = RankDto;

/// Utilisateur de session — ce que renvoie `/auth/me`.
///
/// Même forme que `UserDTO` : l'API sert le même objet, `type` en moins. Alias
/// plutôt que type distinct, pour qu'un utilisateur de session puisse alimenter
/// n'importe quelle référence utilisateur (organisateur, manager, propriétaire).
pub type SessionUserDto = UserDto;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum SocialMedia {
	X = 0,
	Instagram = 1,
	TikTok = 2,
	Youtube = 3,
	Twitch = 4,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialMediaDto {
	pub platform: SocialMedia,
	pub username: String,
	#[serde(rename = "canonicalUrl")]
	pub canonical_url: String,
}

pub type SortDirection = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortQuery<TField> where TField: Serialize + serde::de::DeserializeOwned {
	#[serde(rename = "sortBy", default, skip_serializing_if = "Option::is_none")]
	pub sort_by: Option<TField>,
	#[serde(rename = "sortDir", default, skip_serializing_if = "Option::is_none")]
	pub sort_dir: Option<SortDirection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StageType {
	#[serde(rename = "round_robin")]
	RoundRobin,
	#[serde(rename = "single_elimination")]
	SingleElimination,
	#[serde(rename = "double_elimination")]
	DoubleElimination,
	/// Championnat type Premier League (calendrier + classement par points),
	/// distinct d'une coupe à élimination. Voir `@rosegriffon/achillea-core/league`
	/// et `docs/asytral-league.md` (référence Asytral League).
	#[serde(rename = "league")]
	League,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsHub {
	pub overview: serde_json::Value,
	pub records: serde_json::Value,
	pub players: Vec<StatsHubPlayerEntry>,
	pub clans: Vec<StatsHubClanEntry>,
	#[serde(rename = "tournamentHistory")]
	pub tournament_history: Vec<StatsHubTournamentHistoryEntry>,
	pub tournaments: Vec<CircuitTournamentSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsHubClanEntry {
	pub id: f64,
	pub name: String,
	#[serde(rename = "shortName")]
	pub short_name: String,
	pub avatar: String,
	pub points: f64,
	pub players: f64,
	#[serde(rename = "tournamentsPlayed")]
	pub tournaments_played: f64,
	pub wins: f64,
	pub podiums: f64,
	pub tier: String,
	#[serde(rename = "goalsScored")]
	pub goals_scored: f64,
	#[serde(rename = "goalsConceded")]
	pub goals_conceded: f64,
	#[serde(rename = "goalAverage")]
	pub goal_average: f64,
}

/// Joueur enrichi des stats matchs (buts, séries) pour le hub stats circuit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsHubPlayerEntry {
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub username: String,
	pub avatar: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub clan: Option<CircuitClanTag>,
	#[serde(rename = "tournamentsPlayed")]
	pub tournaments_played: f64,
	pub points: f64,
	pub tournaments: f64,
	pub wins: f64,
	pub podiums: f64,
	pub top4: f64,
	pub top8: f64,
	#[serde(rename = "bestRank")]
	pub best_rank: f64,
	#[serde(rename = "bestRankLabel")]
	pub best_rank_label: String,
	/// Palier circuit — mêmes clés que le ranked (Fer → Légendaire).
	pub tier: String,
	#[serde(rename = "matchesPlayed")]
	pub matches_played: f64,
	#[serde(rename = "matchWins")]
	pub match_wins: f64,
	#[serde(rename = "matchLosses")]
	pub match_losses: f64,
	#[serde(rename = "goalsScored")]
	pub goals_scored: f64,
	#[serde(rename = "goalsConceded")]
	pub goals_conceded: f64,
	#[serde(rename = "goalDiff")]
	pub goal_diff: f64,
	/// Buts marqués / encaissés — départage à points égaux.
	#[serde(rename = "goalAverage")]
	pub goal_average: f64,
	#[serde(rename = "bestStreak")]
	pub best_streak: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsHubRecord {
	pub value: f64,
	#[serde(rename = "tournamentId")]
	pub tournament_id: f64,
	#[serde(rename = "tournamentName")]
	pub tournament_name: String,
	pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsHubTournamentHistoryEntry {
	pub id: f64,
	pub name: String,
	#[serde(rename = "grandFinalAt")]
	pub grand_final_at: String,
	pub size: f64,
	pub matches: f64,
	pub goals: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub champion: Option<String>,
	#[serde(rename = "runnerUp", default, skip_serializing_if = "Option::is_none")]
	pub runner_up: Option<String>,
}

/// Réponse des mutations : `{ success, error? }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuccessResponse {
	pub success: bool,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<String>,
}

/// Entrée d'autocomplétion globale (barre de recherche clans + joueurs).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suggestion {
	pub id: String,
	pub r#type: String,
	pub label: String,
	pub sim: f64,
	#[serde(rename = "clanShortName", default, skip_serializing_if = "Option::is_none")]
	pub clan_short_name: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub avatar: Option<String>,
	#[serde(rename = "soloRank")]
	pub solo_rank: SuggestionRank,
	#[serde(rename = "duoRank")]
	pub duo_rank: SuggestionRank,
	#[serde(rename = "lastInteract", default, skip_serializing_if = "Option::is_none")]
	pub last_interact: Option<Timestamp>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub role: Option<UserRole>,
	#[serde(rename = "currentLevel", default, skip_serializing_if = "Option::is_none")]
	pub current_level: Option<f64>,
	#[serde(rename = "totalXp", default, skip_serializing_if = "Option::is_none")]
	pub total_xp: Option<f64>,
	#[serde(rename = "hasTwitch", default, skip_serializing_if = "Option::is_none")]
	pub has_twitch: Option<bool>,
	#[serde(rename = "hasChallonge", default, skip_serializing_if = "Option::is_none")]
	pub has_challonge: Option<bool>,
	#[serde(rename = "hasYoutube", default, skip_serializing_if = "Option::is_none")]
	pub has_youtube: Option<bool>,
}

/// Alias historique de `SessionRankDTO` (mêmes champs, même origine).
pub type SuggestionRank = SessionRankDto;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum TeamSide {
	Team1 = 1,
	Team2 = 2,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tournament {
	pub id: f64,
	pub name: String,
	pub description: String,
	pub r#type: EventTypeEnum,
	#[serde(rename = "createdAt")]
	pub created_at: Timestamp,
	#[serde(rename = "updatedAt")]
	pub updated_at: Timestamp,
	#[serde(rename = "internalState")]
	pub internal_state: TournamentState,
	#[serde(rename = "startsAt")]
	pub starts_at: Timestamp,
	#[serde(rename = "grandFinalAt")]
	pub grand_final_at: Timestamp,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub series: Option<TournamentSeries>,
	pub organization: OrganizationDto,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub managers: Option<Vec<UserDto>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub participants: Option<Vec<ParticipantDto>>,
	#[serde(rename = "tournamentType")]
	pub tournament_type: StageType,
	#[serde(rename = "participantsNumber", default, skip_serializing_if = "Option::is_none")]
	pub participants_number: Option<f64>,
	#[serde(rename = "seedOrdering", default, skip_serializing_if = "Option::is_none")]
	pub seed_ordering: Option<SeedOrdering>,
	#[serde(rename = "matchFormat", default, skip_serializing_if = "Option::is_none")]
	pub match_format: Option<MatchFormat>,
	#[serde(rename = "customFormatChildCount", default, skip_serializing_if = "Option::is_none")]
	pub custom_format_child_count: Option<f64>,
	#[serde(rename = "groupStageEnabled")]
	pub group_stage_enabled: bool,
	#[serde(rename = "groupStageType", default, skip_serializing_if = "Option::is_none")]
	pub group_stage_type: Option<StageType>,
	pub logo: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub affiche: Option<String>,
	pub planning: String,
	pub ruleset: String,
	/// True une fois le bonus AP podium (top 4) versé.
	/// Absent / false tant que non appliqué (tournois en cours ou formats hors scope).
	#[serde(rename = "placementEloApplied", default, skip_serializing_if = "Option::is_none")]
	pub placement_elo_applied: Option<bool>,
	/// Planning automatisé (voir `docs/plan-tournois.md`).
	#[serde(rename = "registrationOpensAt", default, skip_serializing_if = "Option::is_none")]
	pub registration_opens_at: Option<String>,
	#[serde(rename = "registrationClosesAt", default, skip_serializing_if = "Option::is_none")]
	pub registration_closes_at: Option<String>,
	#[serde(rename = "autoStart", default, skip_serializing_if = "Option::is_none")]
	pub auto_start: Option<bool>,
	#[serde(rename = "discordRoleEnabled", default, skip_serializing_if = "Option::is_none")]
	pub discord_role_enabled: Option<bool>,
	/// Qui saisit les scores (absent sur un tournoi d'avant l'option = joueurs).
	#[serde(rename = "scoreReportPolicy", default, skip_serializing_if = "Option::is_none")]
	pub score_report_policy: Option<ScoreReportPolicy>,
	/// Rôle Discord attribué aux inscrits, créé à l'ouverture des inscriptions.
	#[serde(rename = "discordRoleId", default, skip_serializing_if = "Option::is_none")]
	pub discord_role_id: Option<String>,
	/// Renseignés quand le tournoi a été annulé (l'entité reste en base).
	#[serde(rename = "cancelReason", default, skip_serializing_if = "Option::is_none")]
	pub cancel_reason: Option<String>,
	#[serde(rename = "canceledAt", default, skip_serializing_if = "Option::is_none")]
	pub canceled_at: Option<String>,
	/// Horodatage d'une clôture manuelle (null si passage automatique en Terminé).
	#[serde(rename = "closedAt", default, skip_serializing_if = "Option::is_none")]
	pub closed_at: Option<String>,
}

/// Réponse de `GET /tournaments/:id` — un triplet, pas un objet : c'est la
/// forme réellement servie. Le décrire tel quel évite qu'un client invente une
/// normalisation que le suivant ne ferait pas.
///
/// `[tournoi, inscrits, données brutes de brackets-manager]`.
pub type TournamentDetail = (WireTournament, Vec<WireParticipant>, serde_json::Value);

/// Enveloppe générique des mutations de tournoi.
pub type TournamentEnvelope<T> = ApiEnvelope<T>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentEventActor {
	pub id: String,
	pub username: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub avatar: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentEventDto {
	pub id: String,
	pub r#type: TournamentEventType,
	#[serde(rename = "createdAt")]
	pub created_at: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub actor: Option<TournamentEventActor>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub target: Option<TournamentEventActor>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub payload: Option<std::collections::HashMap<String, serde_json::Value>>,
	/// Motif (DQ, annulation) — null pour les non-organisateurs.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub reason: Option<String>,
}

/// Évènements journalisés d'un tournoi (table `tournament_event`).
///
/// Journal métier destiné à l'affichage — distinct d'`audit_log`, qui est un journal ops
/// signé en chaîne contenant IP et charges utiles arbitraires.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TournamentEventType {
	#[serde(rename = "created")]
	Created,
	#[serde(rename = "updated")]
	Updated,
	#[serde(rename = "registrations_opened")]
	RegistrationsOpened,
	#[serde(rename = "registrations_closed")]
	RegistrationsClosed,
	#[serde(rename = "participant_registered")]
	ParticipantRegistered,
	#[serde(rename = "participant_waitlisted")]
	ParticipantWaitlisted,
	#[serde(rename = "participant_promoted")]
	ParticipantPromoted,
	#[serde(rename = "participant_unregistered")]
	ParticipantUnregistered,
	#[serde(rename = "participant_removed")]
	ParticipantRemoved,
	#[serde(rename = "participant_disqualified")]
	ParticipantDisqualified,
	#[serde(rename = "participant_reinstated")]
	ParticipantReinstated,
	#[serde(rename = "seeding_changed")]
	SeedingChanged,
	#[serde(rename = "bracket_generated")]
	BracketGenerated,
	#[serde(rename = "tournament_started")]
	TournamentStarted,
	#[serde(rename = "score_reported")]
	ScoreReported,
	#[serde(rename = "score_validated")]
	ScoreValidated,
	#[serde(rename = "phase_advanced")]
	PhaseAdvanced,
	#[serde(rename = "organizer_added")]
	OrganizerAdded,
	#[serde(rename = "organizer_removed")]
	OrganizerRemoved,
	#[serde(rename = "tournament_closed")]
	TournamentClosed,
	#[serde(rename = "tournament_canceled")]
	TournamentCanceled,
	#[serde(rename = "tournament_restored")]
	TournamentRestored,
}

/// Projection compacte de la liste publique `/tournaments`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentListItem {
	pub id: f64,
	pub name: String,
	pub description: String,
	pub r#type: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub status: Option<String>,
	#[serde(rename = "createdAt")]
	pub created_at: Timestamp,
	#[serde(rename = "updatedAt")]
	pub updated_at: Timestamp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentMatchStats {
	pub matches: f64,
	#[serde(rename = "totalGoals")]
	pub total_goals: f64,
	#[serde(rename = "avgGoals")]
	pub avg_goals: f64,
	#[serde(rename = "topScore")]
	pub top_score: f64,
	#[serde(rename = "minMargin")]
	pub min_margin: f64,
	#[serde(rename = "maxMargin")]
	pub max_margin: f64,
	#[serde(rename = "biggestBlowout", default, skip_serializing_if = "Option::is_none")]
	pub biggest_blowout: Option<TournamentMatchup>,
	#[serde(rename = "closestMatch", default, skip_serializing_if = "Option::is_none")]
	pub closest_match: Option<TournamentMatchup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentMatchup {
	#[serde(rename = "winnerDisplayName")]
	pub winner_display_name: String,
	#[serde(rename = "winnerAvatar")]
	pub winner_avatar: String,
	#[serde(rename = "loserDisplayName")]
	pub loser_display_name: String,
	#[serde(rename = "loserAvatar")]
	pub loser_avatar: String,
	#[serde(rename = "scoreWinner")]
	pub score_winner: f64,
	#[serde(rename = "scoreLoser")]
	pub score_loser: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentSeries {
	pub id: f64,
	pub name: String,
	pub description: String,
	pub logo: String,
	pub organization: OrganizationDto,
	pub tournaments: Vec<Tournament>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TournamentState {
	#[serde(rename = "Pending")]
	Pending,
	#[serde(rename = "Preregistering")]
	Preregistering,
	#[serde(rename = "Preparing")]
	Preparing,
	#[serde(rename = "Ongoing")]
	Ongoing,
	#[serde(rename = "Finished")]
	Finished,
	#[serde(rename = "Canceled")]
	Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentSummary {
	pub top10: Vec<TournamentTop10Entry>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub stats: Option<TournamentMatchStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentTop10Entry {
	pub rank: f64,
	#[serde(rename = "rankLabel")]
	pub rank_label: String,
	#[serde(rename = "userId")]
	pub user_id: String,
	#[serde(rename = "displayName")]
	pub display_name: String,
	pub avatar: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub clan: Option<CircuitClanTag>,
	/// Points de circuit gagnés pour CE tournoi — pas le cumul all-time.
	pub points: f64,
	pub tier: String,
	#[serde(rename = "goalsScored")]
	pub goals_scored: f64,
	#[serde(rename = "goalsConceded")]
	pub goals_conceded: f64,
	#[serde(rename = "goalAverage")]
	pub goal_average: f64,
}

/// Mise à jour partielle d'un clan (PUT /clans/:id).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateClanPayload {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub name: Option<String>,
	#[serde(rename = "shortenedName", default, skip_serializing_if = "Option::is_none")]
	pub shortened_name: Option<String>,
	#[serde(rename = "clanBiography", default, skip_serializing_if = "Option::is_none")]
	pub clan_biography: Option<String>,
	#[serde(rename = "clanAvatarUrl", default, skip_serializing_if = "Option::is_none")]
	pub clan_avatar_url: Option<String>,
	#[serde(rename = "xUrl", default, skip_serializing_if = "Option::is_none")]
	pub x_url: Option<String>,
	#[serde(rename = "instagramUrl", default, skip_serializing_if = "Option::is_none")]
	pub instagram_url: Option<String>,
	#[serde(rename = "tiktokUrl", default, skip_serializing_if = "Option::is_none")]
	pub tiktok_url: Option<String>,
	#[serde(rename = "isRecruiting", default, skip_serializing_if = "Option::is_none")]
	pub is_recruiting: Option<bool>,
	#[serde(rename = "autoAcceptMembers", default, skip_serializing_if = "Option::is_none")]
	pub auto_accept_members: Option<bool>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub languages: Option<Vec<String>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub origin: Option<String>,
}

/// Champs modifiables par le titulaire du profil.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUserProfilePayload {
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub bio: Option<String>,
	#[serde(rename = "twitchUrl", default, skip_serializing_if = "Option::is_none")]
	pub twitch_url: Option<String>,
}

/// `POST /proxy/upload` — image dédupliquée par hash côté API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadedImage {
	pub id: String,
	pub url: String,
}

/// Identité affichable d'un joueur dans un rendu 2D/3D ou un classement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
	pub id: String,
	pub name: String,
	pub rank: Rank,
	pub logo: String,
}

/// Appartenance de clan résumée, telle qu'embarquée dans un profil enrichi.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserClanSummary {
	pub id: f64,
	#[serde(rename = "shortenedName")]
	pub shortened_name: String,
	pub name: String,
	#[serde(rename = "avatarUrl", default, skip_serializing_if = "Option::is_none")]
	pub avatar_url: Option<String>,
	pub role: ClanMemberRole,
	pub distinctions: Vec<ClanMemberDistinction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserDto {
	pub id: String,
	/// Discriminant d'entité, présent sur les fiches publiques et absent de la
	/// session : optionnel pour que `SessionUserDTO` reste assignable.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub r#type: Option<String>,
	pub username: String,
	/// Canonical Rose Griffon public profile slug when the Discord account is linked.
	#[serde(rename = "rgProfileUsername", default, skip_serializing_if = "Option::is_none")]
	pub rg_profile_username: Option<String>,
	/// Champs présents uniquement sur la session de l'utilisateur courant.
	///
	/// `GET /clans` imbrique un président réduit (identité et profil public) qui
	/// ne les porte pas. Les exiger faisait échouer la validation de la réponse
	/// ENTIÈRE, donc de tous les clans.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub sim: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub avatar: Option<String>,
	/// L'API historique sérialise l'absence de clan en `null` (et non en champ
	/// absent). Les deux formes sont donc recevables dans le contrat partagé.
	#[serde(rename = "clanId", default, skip_serializing_if = "Option::is_none")]
	pub clan_id: Option<f64>,
	#[serde(rename = "soloRank", default, skip_serializing_if = "Option::is_none")]
	pub solo_rank: Option<RankDto>,
	#[serde(rename = "duoRank", default, skip_serializing_if = "Option::is_none")]
	pub duo_rank: Option<RankDto>,
	#[serde(rename = "lastInteract", default, skip_serializing_if = "Option::is_none")]
	pub last_interact: Option<Timestamp>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub role: Option<UserRole>,
	#[serde(rename = "currentLevel", default, skip_serializing_if = "Option::is_none")]
	pub current_level: Option<f64>,
	#[serde(rename = "totalXp", default, skip_serializing_if = "Option::is_none")]
	pub total_xp: Option<f64>,
	#[serde(rename = "hasTwitch", default, skip_serializing_if = "Option::is_none")]
	pub has_twitch: Option<bool>,
	#[serde(rename = "hasChallonge", default, skip_serializing_if = "Option::is_none")]
	pub has_challonge: Option<bool>,
	#[serde(rename = "hasYoutube", default, skip_serializing_if = "Option::is_none")]
	pub has_youtube: Option<bool>,
}

/// Vue minimale d'un utilisateur (avatar + libellé), suffisante pour une liste.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRef {
	pub id: String,
	pub username: String,
	#[serde(rename = "displayName", default, skip_serializing_if = "Option::is_none")]
	pub display_name: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub avatar: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum UserRole {
	User = 0,
	Moderator = 1,
	Administrator = 2,
	SuperAdministrator = 3,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsersAndGuildsResponse {
	#[serde(rename = "activeUsers")]
	pub active_users: Vec<DailyCountRow>,
	pub users: Vec<DailyCountRow>,
	pub guilds: Vec<DailyCountRow>,
}

/// Portefeuille — un solde par utilisateur dans une devise virtuelle (ex. ACH)
/// plus un journal de mouvements.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletBalance {
	pub balance: f64,
	pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletHistoryPage {
	pub transactions: Vec<WalletTransaction>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub total: Option<f64>,
}

/// Une ligne du journal des transactions (`GET /wallet/me/history`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletTransaction {
	/// PostgreSQL UUID of the immutable transaction row.
	pub id: String,
	pub r#type: WalletTransactionType,
	pub amount: f64,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub reason: Option<String>,
	pub direction: WalletTransactionDirection,
	#[serde(rename = "createdAt")]
	pub created_at: String,
}

/// Sens du mouvement vis-à-vis du solde du titulaire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WalletTransactionDirection {
	#[serde(rename = "in")]
	In,
	#[serde(rename = "out")]
	Out,
}

/// Type de mouvement du portefeuille (doit matcher l'enum côté bot).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WalletTransactionType {
	#[serde(rename = "Credit")]
	Credit,
	#[serde(rename = "Debit")]
	Debit,
	#[serde(rename = "Transfer")]
	Transfer,
	#[serde(rename = "Payout")]
	Payout,
	#[serde(rename = "Fine")]
	Fine,
}

/// `ParticipantDTO` tel qu'il circule (le tournoi n'est souvent qu'un id).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireParticipant {
	pub id: f64,
	pub user: UserDto,
	#[serde(rename = "bracketParticipantId", default, skip_serializing_if = "Option::is_none")]
	pub bracket_participant_id: Option<f64>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub seed: Option<f64>,
	#[serde(rename = "hasCheckedIn")]
	pub has_checked_in: bool,
	/// Absent sur les réponses d'API antérieures au statut : traiter comme `ACTIVE`.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub status: Option<ParticipantStatus>,
	#[serde(rename = "registeredAt", default, skip_serializing_if = "Option::is_none")]
	pub registered_at: Option<String>,
	/// Rang dans la liste d'attente (1 = prochain promu).
	#[serde(rename = "waitlistPosition", default, skip_serializing_if = "Option::is_none")]
	pub waitlist_position: Option<f64>,
	/// Motif de DQ — renseigné uniquement pour les organisateurs.
	#[serde(rename = "statusReason", default, skip_serializing_if = "Option::is_none")]
	pub status_reason: Option<String>,
	pub tournament: EntityRef<WireTournament>,
}

/// `Tournament` tel qu'il circule (relations éventuellement réduites à un id).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireTournament {
	pub id: f64,
	pub name: String,
	pub description: String,
	pub r#type: EventTypeEnum,
	#[serde(rename = "createdAt")]
	pub created_at: Timestamp,
	#[serde(rename = "updatedAt")]
	pub updated_at: Timestamp,
	#[serde(rename = "internalState")]
	pub internal_state: TournamentState,
	#[serde(rename = "startsAt")]
	pub starts_at: Timestamp,
	#[serde(rename = "grandFinalAt")]
	pub grand_final_at: Timestamp,
	#[serde(rename = "tournamentType")]
	pub tournament_type: StageType,
	#[serde(rename = "participantsNumber", default, skip_serializing_if = "Option::is_none")]
	pub participants_number: Option<f64>,
	#[serde(rename = "seedOrdering", default, skip_serializing_if = "Option::is_none")]
	pub seed_ordering: Option<SeedOrdering>,
	#[serde(rename = "matchFormat", default, skip_serializing_if = "Option::is_none")]
	pub match_format: Option<MatchFormat>,
	#[serde(rename = "customFormatChildCount", default, skip_serializing_if = "Option::is_none")]
	pub custom_format_child_count: Option<f64>,
	#[serde(rename = "groupStageEnabled")]
	pub group_stage_enabled: bool,
	#[serde(rename = "groupStageType", default, skip_serializing_if = "Option::is_none")]
	pub group_stage_type: Option<StageType>,
	pub logo: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub affiche: Option<String>,
	pub planning: String,
	pub ruleset: String,
	/// True une fois le bonus AP podium (top 4) versé.
	/// Absent / false tant que non appliqué (tournois en cours ou formats hors scope).
	#[serde(rename = "placementEloApplied", default, skip_serializing_if = "Option::is_none")]
	pub placement_elo_applied: Option<bool>,
	/// Planning automatisé (voir `docs/plan-tournois.md`).
	#[serde(rename = "registrationOpensAt", default, skip_serializing_if = "Option::is_none")]
	pub registration_opens_at: Option<String>,
	#[serde(rename = "registrationClosesAt", default, skip_serializing_if = "Option::is_none")]
	pub registration_closes_at: Option<String>,
	#[serde(rename = "autoStart", default, skip_serializing_if = "Option::is_none")]
	pub auto_start: Option<bool>,
	#[serde(rename = "discordRoleEnabled", default, skip_serializing_if = "Option::is_none")]
	pub discord_role_enabled: Option<bool>,
	/// Qui saisit les scores (absent sur un tournoi d'avant l'option = joueurs).
	#[serde(rename = "scoreReportPolicy", default, skip_serializing_if = "Option::is_none")]
	pub score_report_policy: Option<ScoreReportPolicy>,
	/// Rôle Discord attribué aux inscrits, créé à l'ouverture des inscriptions.
	#[serde(rename = "discordRoleId", default, skip_serializing_if = "Option::is_none")]
	pub discord_role_id: Option<String>,
	/// Renseignés quand le tournoi a été annulé (l'entité reste en base).
	#[serde(rename = "cancelReason", default, skip_serializing_if = "Option::is_none")]
	pub cancel_reason: Option<String>,
	#[serde(rename = "canceledAt", default, skip_serializing_if = "Option::is_none")]
	pub canceled_at: Option<String>,
	/// Horodatage d'une clôture manuelle (null si passage automatique en Terminé).
	#[serde(rename = "closedAt", default, skip_serializing_if = "Option::is_none")]
	pub closed_at: Option<String>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub series: Option<EntityRef<WireTournamentSeries>>,
	pub organization: EntityRef<OrganizationDto>,
	/// Relations OPTIONNELLES sur la liste.
	///
	/// `GET /tournaments` ne les peuple pas — seul `GET /tournaments/:id` le
	/// fait. Les exiger faisait rejeter les 9 tournois de la liste et affichait
	/// « Aucun tournoi trouvé » sur une API qui en servait neuf.
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub managers: Option<Vec<EntityRef<UserDto>>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub participants: Option<Vec<EntityRef<WireParticipant>>>,
}

/// `TournamentSeries` sans sa récursion de tournois peuplés.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireTournamentSeries {
	pub id: f64,
	pub name: String,
	pub description: String,
	pub logo: String,
	pub organization: EntityRef<OrganizationDto>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub tournaments: Option<Vec<EntityRef<WireTournament>>>,
}
