// Contrat Achilléa — FICHIER GÉNÉRÉ, ne pas éditer à la main.
// Source : @rosegriffon/achillea-types@1.0.3
// Régénérer : bun --filter @rosegriffon/achillea-contract generate

package fr.rosegriffon.achillea

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class AdminAuditRow(
	val id: String,
	val ts: String,
	val actorId: String?,
	val action: String,
	val targetType: String,
	val targetId: String?,
	val reason: String?,
)

@Serializable
data class AdminGuildRow(
	val id: String,
	val name: String,
	@SerialName("iconURL")
	val iconUrl: String?,
	val memberCount: Double,
	val ownerId: String,
	val createdAt: String?,
)

@Serializable
data class AdminHealthResponse(
	val bot: JsonElement,
	val host: JsonElement,
	val pid: JsonElement,
	val latency: JsonElement,
)

@Serializable
data class AdminInviteResponse(
	val url: String,
)

@Serializable
data class AdminMetricsSummary(
	val counters: Map<String, Double>,
	val rawLines: Double,
)

@Serializable
data class AdminOpsOverview(
	val users: JsonElement,
	val wallet: JsonElement,
	val moderation: JsonElement,
	val community: JsonElement,
	val ranked: JsonElement,
	val audit24h: Double,
	val bot: JsonElement? = null,
	val generatedAt: String? = null,
)

@Serializable
data class AdminRoleUpdateResult(
	val success: Boolean,
	val id: String,
	val role: Double,
)

@Serializable
data class AdminTransactionRow(
	val id: JsonElement,
	val type: String,
	val amount: Double,
	val reason: String?,
	val fromUserId: String?,
	val toUserId: String?,
	val createdAt: String,
)

@Serializable
data class AdminUserRow(
	val id: String,
	val username: String?,
	val displayName: String?,
	val avatar: String?,
	val role: Double,
	val lastInteract: String?,
)

@Serializable
data class AdminWalletAdjustResult(
	val success: Boolean,
	val userId: String,
	val balance: Double,
)

@Serializable
data class AdminWalletRow(
	val userId: String,
	val displayName: String,
	val balance: Double,
	val currency: String,
)

@Serializable
data class AdminWalletsResponse(
	val top: List<AdminWalletRow>,
	val recent: List<AdminTransactionRow>,
)

/// Réponse enveloppée : `{ success, data?, error? }`.
@Serializable
data class ApiEnvelope<T>(
	val success: Boolean,
	val data: T? = null,
	val error: String? = null,
)

@Serializable
data class BotMonitoringResponse(
	val botStatus: JsonElement,
	val host: JsonElement,
	val pid: JsonElement,
	val latency: JsonElement,
)

/// Formes du tableau de bord d'administration : ops, portefeuilles, audit,
/// santé du bot et console base de données.
///
/// Réservées au staff côté API, mais décrites ici comme le reste : un contrat
/// privé reste un contrat, et c'est précisément là que la dérive silencieuse
/// coûte le plus cher (une colonne renommée casse une console d'admin sans que
/// personne ne le voie avant l'incident).
@Serializable
data class BotTotalsResponse(
	val stats: JsonElement,
)

/// Identifiant d'entité bracket (`brackets-model#Id`).
typealias BracketId = JsonElement

/// Statut d'un match de bracket (`brackets-model#Status`), en valeurs numériques.
@Serializable
enum class BracketMatchStatus {
	@SerialName("0")
	LOCKED,
	@SerialName("1")
	WAITING,
	@SerialName("2")
	READY,
	@SerialName("3")
	RUNNING,
	@SerialName("4")
	COMPLETED,
	@SerialName("5")
	ARCHIVED,
}

/// `brackets-model#StageType` — formats de bracket supportés par la lib.
typealias BracketsStageType = String

@Serializable
data class CancelTournamentResult(
	val success: Boolean,
	val error: String? = null,
	val notified: Double? = null,
)

@Serializable
data class CastAttribution(
	val id: String,
	val slotId: String,
	val userId: String?,
	val assignedAt: String,
	val assignedBy: String,
	val confirmedAt: String?,
)

/// `POST /casts/:id/auto-assign`. Générique sur l'attribution : l'API renvoie
/// la forme complète, un appelant peut n'en valider qu'une projection.
@Serializable
data class CastAutoAssignResult<TAttribution>(
	val created: Double,
	val attributions: List<TAttribution>,
)

@Serializable
data class CastAvailability(
	val id: String,
	val userId: String,
	val status: CastAvailabilityStatus,
	val preferredRoles: List<CastSlotRole>?,
	val notes: String?,
	val declaredAt: String,
)

@Serializable
enum class CastAvailabilityStatus {
	@SerialName("available")
	AVAILABLE,
	@SerialName("maybe")
	MAYBE,
	@SerialName("unavailable")
	UNAVAILABLE,
}

@Serializable
data class CasterPublic(
	val id: String,
	val displayName: String,
	val avatar: String?,
	val bio: String?,
	val twitchUrl: String?,
	val recentCasts: Double,
)

@Serializable
data class CastEvent(
	val id: String,
	val name: String,
	val kind: CastEventKind,
	val scheduledAt: String,
	val duration: Double,
	val tournamentId: String?,
	val status: CastEventStatus,
	val description: String?,
	val twitchUrl: String?,
	val createdBy: String,
	val createdAt: String,
	val updatedAt: String,
)

@Serializable
data class CastEventDetail(
	val event: CastEvent,
	val slots: List<CastSlot>,
	val attributions: List<CastAttribution>,
	val checklist: List<ChecklistItem>,
)

@Serializable
data class CastEventFilters(
	val page: Double? = null,
	val pageSize: Double? = null,
	val status: CastEventStatus? = null,
	val from: String? = null,
	val to: String? = null,
)

/// Nature d'un évènement à caster.
@Serializable
enum class CastEventKind {
	@SerialName("match")
	MATCH,
	@SerialName("tournament")
	TOURNAMENT,
	@SerialName("stream")
	STREAM,
	@SerialName("other")
	OTHER,
}

typealias CastEventListResponse = PagedList<CastEvent>

@Serializable
enum class CastEventStatus {
	@SerialName("planned")
	PLANNED,
	@SerialName("open_signup")
	OPENSIGNUP,
	@SerialName("attributed")
	ATTRIBUTED,
	@SerialName("live")
	LIVE,
	@SerialName("done")
	DONE,
	@SerialName("cancelled")
	CANCELLED,
}

@Serializable
data class CastSlot(
	val id: String,
	val role: CastSlotRole,
	val required: Boolean,
	val defraymentAmount: String?,
	val defraymentCurrency: String?,
	val defraymentReason: String?,
	val notes: String?,
)

/// Poste occupé sur une diffusion.
@Serializable
enum class CastSlotRole {
	@SerialName("caster_main")
	CASTERMAIN,
	@SerialName("caster_secondary")
	CASTERSECONDARY,
	@SerialName("observer")
	OBSERVER,
	@SerialName("producer")
	PRODUCER,
	@SerialName("host")
	HOST,
	@SerialName("technical")
	TECHNICAL,
}

@Serializable
data class CastSurveyResult(
	val success: Boolean,
	val eventId: String,
	val poolSize: Double,
)

/// Ligne de checklist : un poste, son attributaire éventuel, sa confirmation.
@Serializable
data class ChecklistItem(
	val slot: CastSlot,
	val attribution: CastAttribution?,
	val casterId: String?,
	val confirmed: Boolean,
)

/// Classement des clans — somme des points circuit de leurs membres actuels.
@Serializable
data class CircuitClanEntry(
	val id: Double,
	val name: String,
	val shortName: String,
	val avatar: String,
	val points: Double,
	val players: Double,
	val tournamentsPlayed: Double,
	val wins: Double,
	val podiums: Double,
	val tier: String,
)

@Serializable
data class CircuitClanTag(
	val id: Double,
	val name: String,
	val shortName: String,
	val avatar: String,
)

/// Classement circuit — cumul de points de circuit sur tous les tournois
/// élimination terminés. Calcul : `@rosegriffon/achillea-core/tournaments`.
@Serializable
data class CircuitLeaderboardEntry(
	val userId: String,
	val displayName: String,
	val username: String,
	val avatar: String,
	val clan: CircuitClanTag?,
	val tournamentsPlayed: Double,
	val points: Double,
	val tournaments: Double,
	val wins: Double,
	val podiums: Double,
	val top4: Double,
	val top8: Double,
	val bestRank: Double,
	val bestRankLabel: String,
	/// Palier circuit — mêmes clés que le ranked (Fer → Légendaire).
	val tier: String,
)

@Serializable
data class CircuitPodiumEntry(
	val rank: Double,
	val rankLabel: String,
	val userId: String,
	val displayName: String,
	val avatar: String,
)

@Serializable
data class CircuitRanking(
	val leaderboard: List<CircuitLeaderboardEntry>,
	val tournaments: List<CircuitTournamentSummary>,
	val clanRanking: List<CircuitClanEntry>,
)

@Serializable
data class CircuitTournamentSummary(
	val id: Double,
	val name: String,
	val size: Double,
	val grandFinalAt: String,
	val podium: List<CircuitPodiumEntry>,
	val standingsStatus: String,
)

/// Forme historique dénormalisée (snake_case) encore servie par quelques vues.
/// Conservée pour compatibilité ; toute nouvelle route doit renvoyer `ClanDTO`.
@Serializable
data class Clan(
	val id: Double,
	val logo: String,
	val name: String,
	val shortName: String,
	val description: String,
	val captain: String,
	val founders: List<String>,
	@SerialName("x_url")
	val xUrl: String? = null,
	@SerialName("instagram_url")
	val instagramUrl: String? = null,
	@SerialName("tiktok_url")
	val tiktokUrl: String? = null,
	val fame: Double,
	val xp: Double,
	val rank: Rank? = null,
	@SerialName("created_at")
	val createdAt: String,
	val isPro: Boolean,
	val isRecruiting: Boolean,
	val autoRecruit: Boolean,
	val langue: String? = null,
)

@Serializable
data class ClanApplicationDTO(
	val id: Double,
	val user: UserDTO,
	val clan: ClanDTO,
	val distinctions: List<ClanMemberDistinction>,
	val createdAt: String,
	val updatedAt: String,
)

@Serializable
data class ClanApplicationResult(
	val success: Boolean,
	val error: String? = null,
	/// `true` quand le clan accepte automatiquement les candidatures.
	val autojoin: Boolean? = null,
)

@Serializable
data class ClanDTO(
	val id: Double,
	/// Identifiants Discord des fondateurs.
	///
	/// L'API en renvoie un TABLEAU. Le contrat disait `string`, donc la
	/// validation rejetait chaque clan : les 42 clans existaient, l'API les
	/// servait, et la page affichait « 0 clan trouvé ».
	val founders: List<String>,
	val name: String,
	val shortenedName: String,
	val normalizedShortName: String,
	val clanAvatarUrl: String,
	val clanBiography: String,
	/// Absent de la charge utile de `GET /clans` : optionnel.
	val fame: Double? = null,
	val xUrl: String? = null,
	val instagramUrl: String? = null,
	val tiktokUrl: String? = null,
	val isRecruiting: Boolean,
	val isInactive: Boolean,
	val isHidden: Boolean,
	val isDisbanded: Boolean,
	val autoAcceptMembers: Boolean,
	val state: ClanState,
	val createdAt: String,
	val languages: List<String>,
	val origin: String,
	val experience: JsonElement,
	val membersCount: Double,
	val president: UserDTO,
)

@Serializable
data class ClanInviteDTO(
	val id: Double,
	val user: UserDTO,
	val clan: ClanDTO,
	val inviter: ClanMemberDTO,
	val threadId: String? = null,
	val distinctions: List<ClanMemberDistinction>,
	val createdAt: String,
	val updatedAt: String,
	val lastNotifiedAt: String,
)

@Serializable
enum class ClanMemberDistinction {
	@SerialName("Joueur")
	PLAYER,
	@SerialName("Staff")
	STAFF,
	@SerialName("Artiste")
	ARTIST,
	@SerialName("Créateur de contenu")
	CONTENTCREATOR,
}

@Serializable
data class ClanMemberDTO(
	/// Rôle du membre dans le clan (Trial, Member, SubCaptain, Captain).
	val clanRole: ClanMemberRole,
	/// Distinctions brutes telles que stockées (`['Staff', 'Player']`).
	val distinctions: List<String>,
	val clanFameContributed: Double,
	val createdAt: String,
	val updatedAt: String,
	val user: UserDTO,
)

@Serializable
data class ClanMemberLimits(
	val playerLimit: Double,
	val staffLimit: Double,
)

@Serializable
enum class ClanMemberRole {
	@SerialName("0")
	TRIAL,
	@SerialName("1")
	MEMBER,
	@SerialName("2")
	SUBCAPTAIN,
	@SerialName("3")
	CAPTAIN,
}

/// `GET /clans/role` — `-1` quand l'appelant n'est dans aucun clan.
@Serializable
data class ClanRoleResponse(
	val role: Double,
)

@Serializable
enum class ClanState {
	@SerialName("0")
	CREATING,
	@SerialName("1")
	PENDINGREVIEW,
	@SerialName("2")
	APPROVED,
}

@Serializable
data class CloseTournamentResult(
	val success: Boolean,
	val error: String? = null,
	val openLobbies: Double? = null,
)

/// Descripteur de colonne — partagé par toutes les tables, quel que soit l'UI.
@Serializable
data class Column(
	val field: String,
	val header: String,
)

@Serializable
data class CommandUsageRow(
	val date: String,
	val slashCommands: Double,
	val simpleCommands: Double,
	val contextMenus: Double,
)

/// Stats agrégées d'un mode de compétition (interclans / tournois).
@Serializable
data class CompetitionStats(
	/// Nombre d'événements distincts (tournois / interclans) auxquels le joueur a participé.
	val total: Double,
	/// Victoires d'équipe / de clan (contrib).
	val wins: Double,
	/// Défaites d'équipe / de clan (contrib).
	val losses: Double,
	/// Nuls d'équipe (si applicable).
	val draws: Double,
	val goalsScoredAvg: Double,
	val goalsReceivedAvg: Double,
	/// Matchs individuels joués.
	val personalTotal: Double,
	val personalWins: Double,
	val personalLosses: Double,
	val personalDraws: Double,
)

/// Pays / langue d'origine d'un clan ou d'une organisation.
///
/// La table de référence elle-même vit dans
/// `@rosegriffon/achillea-core/reference` : c'est une donnée, pas un contrat.
@Serializable
data class Country(
	/// Code ISO 639-1 en minuscules (`fr`, `en`, …).
	val code: String,
	/// Libellé de la langue en français (`Français`).
	val language: String,
	/// Chemin du drapeau, relatif aux assets du front.
	val flag: String,
	/// Nom du pays en français (`France`).
	val name: String,
)

@Serializable
data class CreateCastEventPayload(
	val name: String,
	val kind: CastEventKind,
	val scheduledAt: String,
	val duration: Double? = null,
	val tournamentId: String? = null,
	val twitchUrl: String? = null,
	val description: String? = null,
	val slots: List<JsonElement>,
)

@Serializable
data class CreatePlayerNotePayload(
	val targetId: String,
	val tournamentId: Double? = null,
	val category: PlayerNoteCategory? = null,
	val severity: PlayerNoteSeverity? = null,
	val content: String,
)

@Serializable
data class CreateSanctionPayload(
	val userId: String,
	val guildId: String,
	val type: SanctionType,
	val reason: String? = null,
	val durationSec: Double? = null,
	val evidence: List<Map<String, JsonElement>>? = null,
)

@Serializable
data class DailyCountRow(
	val date: String,
	val count: Double,
)

@Serializable
data class DatabaseBackupResult(
	val message: String,
	val data: JsonElement? = null,
)

/// Métadonnée de colonne SQL — voisine de `Column`, mais côté base.
@Serializable
data class DbColumn(
	val name: String,
	val dataType: String,
	val nullable: Boolean,
	val default: String?,
	val isPrimaryKey: Boolean,
)

@Serializable
data class DbMutationResult(
	val success: Boolean,
	val row: Map<String, JsonElement>? = null,
)

@Serializable
data class DbQueryResult(
	val data: List<Map<String, JsonElement>>,
	val rowCount: Double,
	val durationMs: Double,
)

@Serializable
data class DbRowsPage(
	val data: List<Map<String, JsonElement>>,
	val columns: List<DbColumn>,
	val meta: PageMeta,
)

@Serializable
data class DbTableRow(
	val name: String,
	val estimatedRows: Double,
	val protected: Boolean,
)

@Serializable
data class DisqualifyResult(
	val success: Boolean,
	val error: String? = null,
	val forfeitedLobbies: Double? = null,
	val promoted: String? = null,
)

@Serializable
data class EnrichedUserDTO(
	val id: String,
	/// Discriminant d'entité, présent sur les fiches publiques et absent de la
	/// session : optionnel pour que `SessionUserDTO` reste assignable.
	val type: String? = null,
	val username: String,
	/// Canonical Rose Griffon public profile slug when the Discord account is linked.
	val rgProfileUsername: String? = null,
	/// Champs présents uniquement sur la session de l'utilisateur courant.
	///
	/// `GET /clans` imbrique un président réduit (identité et profil public) qui
	/// ne les porte pas. Les exiger faisait échouer la validation de la réponse
	/// ENTIÈRE, donc de tous les clans.
	val sim: Double? = null,
	val avatar: String? = null,
	/// L'API historique sérialise l'absence de clan en `null` (et non en champ
	/// absent). Les deux formes sont donc recevables dans le contrat partagé.
	val clanId: Double? = null,
	val soloRank: RankDTO? = null,
	val duoRank: RankDTO? = null,
	val lastInteract: String? = null,
	val role: UserRole? = null,
	val currentLevel: Double? = null,
	val totalXp: Double? = null,
	val hasTwitch: Boolean? = null,
	val hasChallonge: Boolean? = null,
	val hasYoutube: Boolean? = null,
	val clan: UserClanSummary? = null,
	val interclans: CompetitionStats,
	/// Stats de matchs de tournoi (brackets / swiss).
	val tournaments: CompetitionStats,
	val ranked: JsonElement,
	/// Éditable par le titulaire du profil (PUT /users/me/profile).
	val bio: String?,
	val twitchUrl: String?,
)

/// Relation sérialisée par l'ORM : soit l'identifiant seul, soit l'entité
/// peuplée, selon que la requête a chargé la relation ou non. Un client doit
/// gérer les deux cas — d'où ce type plutôt qu'un objet supposé toujours présent.
typealias EntityRef = JsonElement

/// Racine commune à tout évènement compétitif (tournoi, interclan, ranked).
@Serializable
data class EventEntity(
	val id: Double,
	val name: String,
	val description: String,
	val type: EventTypeEnum,
	val createdAt: String,
	val updatedAt: String,
)

@Serializable
enum class EventTypeEnum {
	@SerialName("TOURNAMENT")
	TOURNAMENT,
	@SerialName("INTERCLAN")
	INTERCLAN,
	@SerialName("RANKED")
	RANKED,
}

/// Mode d'un formulaire de validation (création / revue / édition).
@Serializable
enum class FormMode {
	@SerialName("0")
	CREATE,
	@SerialName("1")
	VALIDATE,
	@SerialName("2")
	EDIT,
}

@Serializable
data class GameScoreDTO(
	val lobbyId: Double,
	val gameNumber: Double,
	val score1: Double,
	val score2: Double,
)

@Serializable
data class GameValidatorDTO(
	val lobbyId: Double,
	val lobbyMatchId: Double,
)

/// `brackets-model#GrandFinalType`.
typealias GrandFinalType = String

@Serializable
data class HealthCheckResponse(
	val online: Boolean,
	val uptime: Double?,
	val lastStartup: JsonElement? = null,
)

@Serializable
data class ImageGenerationResult(
	val success: Boolean,
	val error: String? = null,
	val path: String? = null,
)

@Serializable
enum class InterclanState {
	@SerialName("0")
	PENDING_APPROVAL,
	@SerialName("1")
	APPROVED,
	@SerialName("2")
	DENIED,
	@SerialName("3")
	READY,
	@SerialName("4")
	ONGOING,
	@SerialName("5")
	FINISHED,
	@SerialName("6")
	CANCELED,
	@SerialName("7")
	RESULT_OK,
	@SerialName("8")
	RESULT_NOK,
}

@Serializable
data class LeaderboardEntry(
	val rank: Double,
	val userId: String,
	val displayName: String,
	val avatar: String,
	val elo: Double,
	val peakRating: Double,
	val gamesPlayed: Double,
)

@Serializable
data class LeaderboardPage(
	val entries: List<LeaderboardEntry>,
	val total: Double,
	val mode: MatchMode,
)

@Serializable
data class LeagueListResponse(
	val items: List<LeagueSummary>,
)

@Serializable
data class LeagueMatchRow(
	val homeId: String,
	val awayId: String,
	val homeScore: Double,
	val awayScore: Double,
	val matchday: Double,
	val overtime: Boolean? = null,
	val winnerId: String? = null,
)

@Serializable
data class LeaguePointsConfig(
	/// Graphie servie par l'API.
	val win: Double? = null,
	val draw: Double? = null,
	val loss: Double? = null,
	/// Graphie historique du contrat, conservée pour les appelants existants.
	val winRegulation: Double? = null,
	val lossRegulation: Double? = null,
	val winOvertime: Double? = null,
	val lossOvertime: Double? = null,
)

@Serializable
data class LeagueSeasonPayload(
	val meta: LeagueSummary,
	val format: Map<String, JsonElement>,
	val teams: List<LeagueTeam>,
	val pointsConfig: LeaguePointsConfig,
	val standings: List<LeagueStandingRow>,
	val results: List<LeagueMatchRow>,
	val playoffs: JsonElement,
	val schedule: JsonElement? = null,
	val details: JsonElement? = null,
)

@Serializable
data class LeagueStandingRow(
	val teamId: String,
	val rank: Double,
	val played: Double,
	val wins: Double,
	val draws: Double,
	val losses: Double,
	val winsOt: Double,
	val lossesOt: Double,
	val points: Double,
	val mapDiff: Double,
	val mapsFor: Double,
	val mapsAgainst: Double,
)

/// Formes de championnat exposées par l'API.
///
/// Le calcul (classement, points, calendrier) vit dans
/// `@rosegriffon/achillea-core/league` ; seules les formes échangées sont ici,
/// pour qu'un client n'ait pas à dépendre de la logique métier pour lire une
/// réponse.
@Serializable
data class LeagueSummary(
	val id: String,
	val name: String,
	val season: String,
	val format: String,
	val description: String,
	val champion: String? = null,
	val teamCount: Double,
	val matchdays: Double,
	val aliases: List<String>,
)

@Serializable
data class LeagueTeam(
	val tag: String,
	val name: String,
)

/// Licence joueur — un titulaire = un userId Discord, une licence active à la
/// fois, vérifiable publiquement via un QR code.
@Serializable
data class License(
	val id: String,
	val userId: String,
	val licenseNumber: String,
	val issuedAt: String,
	val validUntil: String,
	val status: LicenseStatus,
	/// Nullable until the printable licence PDF has been generated.
	val pdfUrl: String?,
	val createdAt: String,
	val updatedAt: String,
)

/// `GET /licenses/me` — `null` tant qu'aucune licence n'a été émise.
@Serializable
data class LicenseHolderResponse(
	val license: License?,
	/// Owner-only bearer token used to share the public verification URL.
	val verificationToken: String?,
)

/// État d'une licence joueur.
@Serializable
enum class LicenseStatus {
	@SerialName("Active")
	ACTIVE,
	@SerialName("Revoked")
	REVOKED,
	@SerialName("Expired")
	EXPIRED,
}

/// Motif d'invalidité renvoyé par la vérification publique.
typealias LicenseVerifyReason = String

/// Résultat de `GET /licenses/verify/{qr}` (endpoint PUBLIC, sans auth).
@Serializable
data class LicenseVerifyResult(
	val valid: Boolean,
	val reason: LicenseVerifyReason? = null,
	val licenseNumber: String? = null,
	val validUntil: String? = null,
	val holder: JsonElement? = null,
)

@Serializable
data class LobbyDTO(
	val id: Double,
	val mode: MatchMode,
	val state: LobbyState,
	val bracketMatchId: Double? = null,
	val lobbyUsers: List<LobbyUserDTO>,
	val lobbyMatches: List<LobbyMatchDTO>,
	val hostUser: LobbyUserDTO?,
	val matchFormat: MatchFormat? = null,
)

@Serializable
data class LobbyMatchDTO(
	val id: Double,
	val gameNumber: Double,
	val scoreTeam1: Double,
	val scoreTeam2: Double,
	val team1Validated: Boolean,
	val team2Validated: Boolean,
	val adminValidated: Boolean,
)

@Serializable
enum class LobbyState {
	@SerialName("Fresh")
	FRESH,
	@SerialName("Ongoing")
	ONGOING,
	@SerialName("Pending validation")
	PENDING_VALIDATION,
	@SerialName("Contested")
	CONTESTED,
	@SerialName("Finished")
	FINISHED,
	@SerialName("Canceled")
	CANCELED,
	@SerialName("Forfeited")
	FORFEITED,
}

@Serializable
data class LobbyUserDataDTO(
	val displayName: String,
	val id: String,
	val avatar: String,
)

@Serializable
data class LobbyUserDTO(
	val id: Double,
	val user: LobbyUserDataDTO,
	val team: TeamSide,
	val forfeit: Boolean,
	val state: LobbyUserState,
)

@Serializable
enum class LobbyUserState {
	@SerialName("Pending")
	PENDING,
	@SerialName("Ready")
	READY,
	@SerialName("Afk")
	AFK,
	@SerialName("Ongoing")
	ONGOING,
	@SerialName("Finished")
	FINISHED,
	@SerialName("Repooled")
	REPOOLED,
}

@Serializable
data class MaintenanceResponse(
	val maintenance: Boolean,
)

@Serializable
enum class MatchFormat {
	@SerialName("bo1")
	BO1,
	@SerialName("bo3")
	BO3,
	@SerialName("bo5")
	BO5,
	@SerialName("double_leg")
	DOUBLE_LEG,
	@SerialName("custom")
	CUSTOM,
}

@Serializable
enum class MatchMode {
	@SerialName("2")
	ONE_VS_ONE,
	@SerialName("4")
	TWO_VS_TWO,
}

typealias MatchResult = String

typealias MatchRoomStatus = String

@Serializable
data class ModerationSyncResult(
	val ok: Boolean,
	val sanctionId: String,
)

/// Création d'un clan (POST /clans/create, API Achilléa historique).
@Serializable
data class NewClanPayload(
	val founders: List<JsonElement>,
	val logo: String,
	val name: String,
	val normalizedName: String,
	val shortName: String,
	val normalizedShortName: String,
	val description: String,
	val twitter: String? = null,
	val instagram: String? = null,
	val tiktok: String? = null,
	val origin: Country? = null,
	val languages: List<Country>? = null,
)

@Serializable
data class NewClanResponse(
	val success: Boolean,
	val error: String? = null,
	val clanId: Double? = null,
	/// Renseigné sur un conflit de nom (409).
	val conflict: String? = null,
)

@Serializable
data class NewTournamentDTO(
	val name: String,
	val description: String,
	val series: TournamentSeries? = null,
	val organization: JsonElement,
	val managers: List<UserDTO>? = null,
	val startsAt: String,
	val grandFinalAt: String,
	val tournamentType: StageType,
	val participantsNumber: Double? = null,
	val seedOrdering: SeedOrdering? = null,
	val matchFormat: MatchFormat? = null,
	val customFormatChildCount: Double? = null,
	val groupStageEnabled: Boolean,
	val groupStageType: StageType? = null,
	val affiche: String? = null,
	val logo: String,
	val ruleset: String,
	val planning: String,
	/// Planning automatisé — facultatif : sans dates, le tournoi se conduit à la main.
	val registrationOpensAt: JsonElement? = null,
	val registrationClosesAt: JsonElement? = null,
	val autoStart: Boolean? = null,
	/// Rôle Discord distribué aux inscrits.
	val discordRoleEnabled: Boolean? = null,
	/// Qui saisit les scores des matchs (défaut : les joueurs).
	val scoreReportPolicy: ScoreReportPolicy? = null,
	/// Dérogation aux règles de publication — SuperAdmin uniquement, côté API.
	val bypassRules: Boolean? = null,
)

@Serializable
enum class NotificationCategory {
	@SerialName("0")
	USER,
	@SerialName("1")
	CLAN,
	@SerialName("2")
	GLOBAL,
	@SerialName("3")
	ORGANIZATION,
}

@Serializable
data class NotificationModel(
	val id: Double,
	val title: String,
	val message: String,
	val type: NotificationType,
	val category: NotificationCategory,
	val payload: Map<String, JsonElement>?,
)

@Serializable
enum class NotificationType {
	@SerialName("0")
	NEW_ORGANIZATION_CREATION_REQUEST,
	@SerialName("1")
	NEW_ORGANIZATION_EDITION_REQUEST,
	@SerialName("2")
	NEW_ORGANIZATION_EDIT_REPLY,
	@SerialName("3")
	NEW_ORGANIZATION_ACCEPT_REPLY,
	@SerialName("4")
	NEW_ORGANIZATION_REJECT_REPLY,
	@SerialName("5")
	CLAN_MEMBER_KICK,
}

@Serializable
data class OpenRegistrationsResult(
	val success: Boolean,
	val id: Double,
	val internalState: TournamentState,
)

@Serializable
data class OrganizationDTO(
	val id: JsonElement? = null,
	val state: OrganizationState? = null,
	val name: String,
	val normalizedName: String,
	val logo: String,
	val description: String,
	val owner: JsonElement? = null,
	val orgManagers: List<UserDTO>? = null,
	val managers: List<OrgManagerDTO>? = null,
	val preapproved: Boolean? = null,
	val socialMedias: List<SocialMediaDTO>? = null,
	val broadcastMedias: List<SocialMediaDTO>? = null,
	val origin: JsonElement? = null,
	val createdAt: String? = null,
	val updatedAt: String? = null,
)

/// Cycle de revue d'une organisation (structure e-sport).
@Serializable
enum class OrganizationState {
	@SerialName("0")
	PENDING,
	@SerialName("1")
	APPROVED,
	@SerialName("2")
	REJECTED,
}

/// Revue d'une demande de création / édition d'organisation.
@Serializable
data class OrganizationValidationDTO(
	val id: JsonElement? = null,
	val reviewer: UserDTO,
	val name: String?,
	val logo: String?,
	val description: String?,
	val twitterUrl: String?,
	val instagramUrl: String?,
	val tiktokUrl: String?,
	val twitchUrl: String?,
	val youtubeUrl: String?,
)

@Serializable
data class OrgManagerDTO(
	val organization: JsonElement? = null,
	val user: UserDTO,
	val createdAt: String? = null,
	val updatedAt: String? = null,
)

@Serializable
data class PagedList<T>(
	val data: List<T>,
	val total: Double,
	val meta: PageSizeMeta,
)

/// Métadonnées de page renvoyées par l'API (style `Paginated<T>` historique).
@Serializable
data class PageMeta(
	/// Seul `total` est garanti.
	///
	/// Mesuré sur `GET /clans` : l'API renvoie `{ total, pageCount: null }`. Une
	/// enveloppe de pagination ne doit jamais pouvoir invalider sa charge utile —
	/// exiger ces champs effaçait les 42 clans pour une histoire de compteur.
	val page: Double? = null,
	val limit: Double? = null,
	val total: Double,
	val pageCount: Double? = null,
)

/// Requête de pagination commune à toutes les listes.
@Serializable
data class PageQuery(
	val page: Double? = null,
	val pageSize: Double? = null,
)

/// Variante « pageSize » utilisée par les contrôleurs récents (casts, sanctions,
/// notes joueur). Conservée distincte de `PageMeta` : les deux formes coexistent
/// réellement sur l'API, les fusionner casserait un des deux appelants.
@Serializable
data class PageSizeMeta(
	val page: Double,
	val pageSize: Double,
	val pageCount: Double,
)

@Serializable
data class Paginated<T>(
	val data: List<T>,
	val meta: PageMeta,
)

@Serializable
data class ParticipantDTO(
	val id: Double,
	val tournament: Tournament,
	val user: UserDTO,
	val bracketParticipantId: Double? = null,
	val seed: Double? = null,
	val hasCheckedIn: Boolean,
	/// Absent sur les réponses d'API antérieures au statut : traiter comme `ACTIVE`.
	val status: ParticipantStatus? = null,
	val registeredAt: String? = null,
	/// Rang dans la liste d'attente (1 = prochain promu).
	val waitlistPosition: Double? = null,
	/// Motif de DQ — renseigné uniquement pour les organisateurs.
	val statusReason: String? = null,
)

@Serializable
data class ParticipantMutationResult(
	val success: Boolean,
	val error: String? = null,
	val participant: WireParticipant? = null,
)

/// Statut d'un inscrit à un tournoi.
///
/// Un seul axe pour deux besoins qui portaient sur la même ligne : la liste d'attente
/// quand le tournoi est plein, et la disqualification. Seuls les `Active` comptent dans
/// la capacité, le seeding et le bracket.
@Serializable
enum class ParticipantStatus {
	@SerialName("Active")
	ACTIVE,
	@SerialName("Waitlisted")
	WAITLISTED,
	@SerialName("Disqualified")
	DISQUALIFIED,
}

@Serializable
data class PlacementPrizesResult(
	val success: Boolean,
	val error: String? = null,
	val applied: Boolean? = null,
	val reason: String? = null,
	val deltas: Map<String, Double>? = null,
	val tournamentSize: Double? = null,
)

/// Profil circuit d'un joueur — page profil public `/users/:id`.
@Serializable
data class PlayerCircuitProfile(
	val tournamentsPlayed: Double,
	val points: Double,
	val tier: String,
	val wins: Double,
	val podiums: Double,
	val top4: Double,
	val top8: Double,
	val bestRankLabel: String,
	val goalsScored: Double,
	val goalsConceded: Double,
	val goalAverage: Double,
	val bestStreak: Double,
	val history: List<PlayerTournamentHistoryEntry>,
)

@Serializable
data class PlayerNote(
	val id: String,
	val target: PlayerNotePerson?,
	val author: PlayerNotePerson?,
	val tournament: JsonElement?,
	val category: PlayerNoteCategory,
	val severity: PlayerNoteSeverity,
	val content: String,
	val resolved: Boolean,
	val resolvedAt: String?,
	val resolvedBy: PlayerNotePerson?,
	val createdAt: String,
	val updatedAt: String,
	/// Registre Drive où le signalement a été consigné (null si Drive non configuré).
	val docsUrl: String?,
)

/// Notes du staff sur un joueur (« espace dédié » où les organisateurs consignent ce
/// qu'ils ont à dire d'un joueur pendant un tournoi, lisible des autres admins).
///
/// Distinct des sanctions : une note est une observation, pas une décision. Elle
/// n'entraîne aucune conséquence automatique et n'est jamais montrée au joueur.
@Serializable
enum class PlayerNoteCategory {
	@SerialName("behavior")
	BEHAVIOR,
	@SerialName("cheating")
	CHEATING,
	@SerialName("no_show")
	NO_SHOW,
	@SerialName("score_dispute")
	SCORE_DISPUTE,
	@SerialName("positive")
	POSITIVE,
	@SerialName("other")
	OTHER,
}

@Serializable
data class PlayerNoteFilters(
	val page: Double? = null,
	val pageSize: Double? = null,
	val targetId: String? = null,
	val tournamentId: Double? = null,
	val category: PlayerNoteCategory? = null,
	val severity: PlayerNoteSeverity? = null,
	val resolved: Boolean? = null,
)

/// Filtres additionnels acceptés par la liste des notes.
@Serializable
data class PlayerNoteFiltersExtra(
	val category: PlayerNoteCategory? = null,
	val severity: PlayerNoteSeverity? = null,
	val search: String? = null,
)

@Serializable
data class PlayerNoteListResponse(
	val data: List<PlayerNote>,
	val total: Double,
	val meta: JsonElement,
)

@Serializable
data class PlayerNotePerson(
	val id: String,
	val username: String,
	val displayName: String,
	val avatar: String,
)

@Serializable
enum class PlayerNoteSeverity {
	@SerialName("info")
	INFO,
	@SerialName("warning")
	WARNING,
	@SerialName("serious")
	SERIOUS,
}

@Serializable
data class PlayerNoteSummary(
	val total: Double,
	val open: Double,
	val bySeverity: Map<String, Double>,
)

@Serializable
data class PlayerTournamentHistoryEntry(
	val tournamentId: Double,
	val tournamentName: String,
	val grandFinalAt: String,
	val size: Double,
	val rank: Double?,
	val rankLabel: String,
	val points: Double,
	val tier: String,
	val goalsScored: Double,
	val goalsConceded: Double,
)

/// Palier de classement nommé (bornes Elo + dégradé).
@Serializable
data class Rank(
	val label: String,
	val minElo: Double,
	val maxElo: Double,
	val gradient: List<String>,
)

/// Palier de rang tel qu'exposé sur un profil (clé FR + dégradé d'affichage).
@Serializable
data class RankDTO(
	val elo: Double,
	val key: String,
	val gradient: List<String>,
)

/// Un match ranked EN COURS (lobby `Ongoing`), avec son état live persisté.
@Serializable
data class RankedActiveMatch(
	val lobbyId: Double,
	val mode: MatchMode,
	val createdAt: String,
	/// Domicile (team 1).
	val player1: RankedActivePlayer,
	/// Extérieur (team 2).
	val player2: RankedActivePlayer,
)

/// Un joueur d'un match EN COURS (vue admin « Matchs en cours »).
@Serializable
data class RankedActivePlayer(
	val userId: String,
	val displayName: String,
	val score: Double,
	val claimedOpponentScore: Double?,
	val submitted: Boolean,
	val hasProof: Boolean,
)

@Serializable
data class RankedAdminDispute(
	val lobbyId: Double,
	val mode: MatchMode,
	val player1: RankedDisputePlayer,
	val player2: RankedDisputePlayer,
	val createdAt: String,
)

@Serializable
data class RankedAdminSeason(
	val id: String,
	val name: String,
	val state: SeasonState,
	val startsAt: String,
	val endsAt: String,
	val config: RankedSeasonConfig,
	val playerCount: Double,
)

@Serializable
data class RankedAdminValidateRequest(
	val scoreTeam1: Double,
	val scoreTeam2: Double,
	val forfeitUserId: String? = null,
)

@Serializable
data class RankedAdminValidateResult(
	val ok: Boolean,
	val eloDelta: Double? = null,
)

/// `POST /ranked/challenge/:code/accept` — la réservation temps réel est opaque.
@Serializable
data class RankedChallengeAccepted(
	val reservation: JsonElement,
	val mode: Double,
	val ranked: Boolean,
)

/// Défi par lien partageable créé par le joueur courant (en attente d'acceptation).
@Serializable
data class RankedChallengeLink(
	val code: String,
	val url: String,
	val mode: MatchMode,
	val ranked: Boolean,
	val toUserId: String?,
	val expiresAt: Double,
)

/// Aperçu d'un défi reçu via un lien.
@Serializable
data class RankedChallengePreview(
	val code: String,
	val fromUserId: String,
	val fromDisplayName: String,
	val fromAvatar: String,
	val fromElo: Double,
	val mode: MatchMode,
	val ranked: Boolean,
	val isOwn: Boolean,
	val expiresAt: Double,
)

@Serializable
data class RankedChatMessage(
	val userId: String,
	val text: String,
	val at: Double,
)

@Serializable
data class RankedDisputePlayer(
	val userId: String,
	val displayName: String,
	/// Score que CE joueur réclame pour lui-même.
	val submittedScore: Double,
	/// Score qu'il attribue à l'adversaire.
	val claimedOpponentScore: Double? = null,
	val screenshotUrl: String? = null,
)

@Serializable
data class RankedDisputeRequest(
	val lobbyId: Double,
	val screenshotUrl: String,
)

@Serializable
data class RankedHistoryEntry(
	val lobbyId: Double,
	val mode: MatchMode,
	val state: String,
	val endedAt: String,
	val myScore: Double,
	val opponentScore: Double,
	val eloDelta: Double,
	val result: MatchResult,
	val opponent: JsonElement,
)

@Serializable
data class RankedLadderResetResult(
	val ok: Boolean,
	val affected: Double,
)

/// Joueur présent dans le salon de présence ranked, pour le défi direct.
@Serializable
data class RankedLobbyPlayer(
	val userId: String,
	val displayName: String,
	val avatar: String,
	val elo: Double,
	val mode: Double,
)

/// Un événement de télémétrie ranked (journal du flow des matchs, vue staff).
@Serializable
data class RankedMatchEvent(
	val id: Double,
	val createdAt: String,
	val lobbyId: Double?,
	val roomCode: String?,
	val mode: Double?,
	val userId: String?,
	val displayName: String?,
	val type: String,
	val detail: Map<String, JsonElement>,
)

@Serializable
data class RankedMatchSummary(
	val lobbyId: Double,
	val roomCode: String,
	val mode: MatchMode,
	/// `false` = partie amicale (aucun ELO appliqué).
	val ranked: Boolean? = null,
	val opponent: JsonElement,
	val result: MatchResult,
	val myScore: Double,
	val opponentScore: Double,
	val eloBefore: Double,
	val eloAfter: Double,
	val eloDelta: Double,
	val newTier: RankTier?,
	val endedAt: String,
)

@Serializable
data class RankedModeStats(
	val mode: MatchMode,
	val total: Double,
	val wins: Double,
	val losses: Double,
	val draws: Double,
	val goalsScored: Double,
	val goalsReceived: Double,
)

/// Compteurs synthétiques du ranked (vue admin overview).
@Serializable
data class RankedOverview(
	val activeMatches: Double,
	val contestedMatches: Double,
	val finishedToday: Double,
	val matchesToday: Double,
	val totalPlayers: Double,
)

/// Invitation reçue (on est défié par un autre joueur).
@Serializable
data class RankedPendingInvite(
	val fromUserId: String,
	val fromDisplayName: String,
	val fromAvatar: String,
	val fromElo: Double,
	val mode: MatchMode,
	/// Classé (ELO) ou non classé (amical).
	val ranked: Boolean,
)

@Serializable
data class RankedPlayerView(
	val userId: String,
	val displayName: String,
	val avatar: String,
	val elo: Double,
	/// Côté terrain : 1 = domicile (1er joueur), 2 = extérieur (2e joueur). 0 = non assigné.
	val team: Double,
	/// Saisie du score (double validation), du point de vue du joueur (−1 = non saisi).
	val myScore: Double,
	val oppScore: Double,
	/// A cliqué « Début de match ».
	val startedMatch: Boolean,
	/// A validé sa saisie de score.
	val submitted: Boolean,
	/// A uploadé sa capture de preuve.
	val proofUploaded: Boolean,
	/// A cliqué « Fin de match ».
	val confirmedFinish: Boolean,
)

@Serializable
data class RankedProfile(
	val userId: String,
	val mode: MatchMode,
	val elo: Double,
	val peakRating: Double,
	val gamesPlayed: Double,
	val wins: Double,
	val losses: Double,
	val tier: RankTier?,
	val seasonId: String?,
	val globalRank: Double? = null,
	val totalPlayers: Double? = null,
	val percentile: Double? = null,
)

/// `POST /ranked/:lobbyId/dispute` — URL de la preuve stockée.
@Serializable
data class RankedProofUploaded(
	val url: String,
)

/// Proposition de revanche reçue en temps réel (`rematch_offer`).
@Serializable
data class RankedRematchOffer(
	val code: String,
	val fromUserId: String,
	val fromDisplayName: String,
	val fromAvatar: String,
	val fromElo: Double,
	val mode: MatchMode,
	val ranked: Boolean,
	val url: String,
)

@Serializable
data class RankedSeasonConfig(
	val kFactor: Double,
	val baseRating: Double,
	val decayRate: Double,
)

@Serializable
data class RankedSeasonInput(
	val name: String,
	val startsAt: String,
	val endsAt: String,
	val config: RankedSeasonConfig,
)

/// Invitation envoyée (on a défié un joueur, en attente de sa réponse).
@Serializable
data class RankedSentInvite(
	val targetUserId: String,
	val targetDisplayName: String,
	val mode: MatchMode,
	val ranked: Boolean,
)

@Serializable
enum class RankedState {
	@SerialName("Open")
	OPEN,
	@SerialName("Locked")
	LOCKED,
	@SerialName("Validating presence")
	VALIDATING_PRESENCE,
	@SerialName("Pairing")
	PAIRING,
	@SerialName("Validating start")
	VALIDATING_MATCH_START,
	@SerialName("Repooling")
	REPOOLING,
	@SerialName("Matching")
	MATCHING,
	@SerialName("Finished")
	FINISHED,
	@SerialName("Canceled")
	CANCELED,
}

@Serializable
data class RankedTierInfo(
	val key: String,
	val minElo: Double,
	val maxElo: Double,
	val gradient: List<String>,
	val emojiId: String?,
	val emojiKey: String?,
	val playerCount: Double,
)

@Serializable
data class RankedTrend(
	val sparkline: List<Double>,
	val deltaPeriod: Double,
	val gamesInPeriod: Double,
	val winRatePeriod: Double,
	val days: Double,
)

@Serializable
data class RankTier(
	val key: String,
	val minElo: Double,
	val maxElo: Double,
	val emojiId: String,
	val emojiKey: String,
	val gradient: List<String>,
)

/// `GET /auth/token` — jeton court destiné au client temps réel.
@Serializable
data class RealtimeTokenResponse(
	val token: String,
	val expiresIn: Double,
	val userId: String,
)

@Serializable
data class RestoreTournamentResult(
	val success: Boolean,
	val error: String? = null,
	val internalState: TournamentState? = null,
)

/// `brackets-model#RoundRobinMode`.
typealias RoundRobinMode = String

@Serializable
data class Sanction(
	val id: String,
	val userId: String,
	val guildId: String,
	val type: SanctionType,
	val reason: String?,
	val durationSec: Double?,
	val issuedBy: String,
	val issuedByType: SanctionIssuerType,
	val expiresAt: String?,
	val revokedAt: String?,
	val revokedBy: String?,
	val revokeReason: String?,
	val evidence: List<Map<String, JsonElement>>?,
	val createdAt: String,
)

@Serializable
data class SanctionFilters(
	val page: Double? = null,
	val pageSize: Double? = null,
	val userId: String? = null,
	val guildId: String? = null,
	val type: SanctionType? = null,
	val active: Boolean? = null,
)

/// Origine d'une sanction (qui / quoi l'a émise).
@Serializable
enum class SanctionIssuerType {
	@SerialName("user")
	USER,
	@SerialName("bot")
	BOT,
	@SerialName("staff")
	STAFF,
	@SerialName("system")
	SYSTEM,
}

typealias SanctionListResponse = PagedList<Sanction>

/// Types de sanction de modération.
@Serializable
enum class SanctionType {
	@SerialName("warn")
	WARN,
	@SerialName("mute")
	MUTE,
	@SerialName("kick")
	KICK,
	@SerialName("ban")
	BAN,
	@SerialName("unmute")
	UNMUTE,
	@SerialName("unban")
	UNBAN,
	@SerialName("note")
	NOTE,
}

@Serializable
data class ScorePolicyResult(
	val success: Boolean,
	val scoreReportPolicy: ScoreReportPolicy,
	val error: String? = null,
)

/// Qui saisit les scores des matchs d'un tournoi.
///
/// `PLAYERS` est le comportement historique : les deux joueurs d'un lobby remplissent
/// eux-mêmes leur score, puis le valident chacun de leur côté (ou un organisateur
/// tranche). `STAFF_ONLY` réserve saisie et validation aux organisateurs — les joueurs
/// gardent la lecture du match, sans aucun bouton.
@Serializable
enum class ScoreReportPolicy {
	@SerialName("players")
	PLAYERS,
	@SerialName("staff_only")
	STAFF_ONLY,
}

typealias SeasonState = String

@Serializable
data class SeedBatchResult(
	val mode: String,
	val bracketUpdated: Boolean,
	val assignments: List<JsonElement>? = null,
	val cleared: Double? = null,
)

@Serializable
data class SeedingResult(
	val participantId: Double,
	val seed: Double?,
	val previousSeed: Double?,
	val swappedWith: String?,
	val bracketUpdated: Boolean,
)

/// `brackets-model#SeedOrdering`.
typealias SeedOrdering = String

/// Rang tel qu'embarqué dans une session ou une suggestion.
typealias SessionRankDTO = RankDTO

/// Utilisateur de session — ce que renvoie `/auth/me`.
///
/// Même forme que `UserDTO` : l'API sert le même objet, `type` en moins. Alias
/// plutôt que type distinct, pour qu'un utilisateur de session puisse alimenter
/// n'importe quelle référence utilisateur (organisateur, manager, propriétaire).
typealias SessionUserDTO = UserDTO

@Serializable
enum class SocialMedia {
	@SerialName("0")
	X,
	@SerialName("1")
	INSTAGRAM,
	@SerialName("2")
	TIKTOK,
	@SerialName("3")
	YOUTUBE,
	@SerialName("4")
	TWITCH,
}

@Serializable
data class SocialMediaDTO(
	val platform: SocialMedia,
	val username: String,
	val canonicalUrl: String,
)

typealias SortDirection = String

@Serializable
data class SortQuery<TField>(
	val sortBy: TField? = null,
	val sortDir: SortDirection? = null,
)

@Serializable
enum class StageType {
	@SerialName("round_robin")
	ROUND_ROBIN,
	@SerialName("single_elimination")
	SINGLE_ELIMINATION,
	@SerialName("double_elimination")
	DOUBLE_ELIMINATION,
	/// Championnat type Premier League (calendrier + classement par points),
	/// distinct d'une coupe à élimination. Voir `@rosegriffon/achillea-core/league`
	/// et `docs/asytral-league.md` (référence Asytral League).
	@SerialName("league")
	LEAGUE,
}

@Serializable
data class StatsHub(
	val overview: JsonElement,
	val records: JsonElement,
	val players: List<StatsHubPlayerEntry>,
	val clans: List<StatsHubClanEntry>,
	val tournamentHistory: List<StatsHubTournamentHistoryEntry>,
	val tournaments: List<CircuitTournamentSummary>,
)

@Serializable
data class StatsHubClanEntry(
	val id: Double,
	val name: String,
	val shortName: String,
	val avatar: String,
	val points: Double,
	val players: Double,
	val tournamentsPlayed: Double,
	val wins: Double,
	val podiums: Double,
	val tier: String,
	val goalsScored: Double,
	val goalsConceded: Double,
	val goalAverage: Double,
)

/// Joueur enrichi des stats matchs (buts, séries) pour le hub stats circuit.
@Serializable
data class StatsHubPlayerEntry(
	val userId: String,
	val displayName: String,
	val username: String,
	val avatar: String,
	val clan: CircuitClanTag?,
	val tournamentsPlayed: Double,
	val points: Double,
	val tournaments: Double,
	val wins: Double,
	val podiums: Double,
	val top4: Double,
	val top8: Double,
	val bestRank: Double,
	val bestRankLabel: String,
	/// Palier circuit — mêmes clés que le ranked (Fer → Légendaire).
	val tier: String,
	val matchesPlayed: Double,
	val matchWins: Double,
	val matchLosses: Double,
	val goalsScored: Double,
	val goalsConceded: Double,
	val goalDiff: Double,
	/// Buts marqués / encaissés — départage à points égaux.
	val goalAverage: Double,
	val bestStreak: Double,
)

@Serializable
data class StatsHubRecord(
	val value: Double,
	val tournamentId: Double,
	val tournamentName: String,
	val detail: String,
)

@Serializable
data class StatsHubTournamentHistoryEntry(
	val id: Double,
	val name: String,
	val grandFinalAt: String,
	val size: Double,
	val matches: Double,
	val goals: Double,
	val champion: String?,
	val runnerUp: String?,
)

/// Réponse des mutations : `{ success, error? }`.
@Serializable
data class SuccessResponse(
	val success: Boolean,
	val error: String? = null,
)

/// Entrée d'autocomplétion globale (barre de recherche clans + joueurs).
@Serializable
data class Suggestion(
	val id: String,
	val type: String,
	val label: String,
	val sim: Double,
	val clanShortName: String? = null,
	val avatar: String? = null,
	val soloRank: SuggestionRank,
	val duoRank: SuggestionRank,
	val lastInteract: String? = null,
	val role: UserRole? = null,
	val currentLevel: Double? = null,
	val totalXp: Double? = null,
	val hasTwitch: Boolean? = null,
	val hasChallonge: Boolean? = null,
	val hasYoutube: Boolean? = null,
)

/// Alias historique de `SessionRankDTO` (mêmes champs, même origine).
typealias SuggestionRank = SessionRankDTO

@Serializable
enum class TeamSide {
	@SerialName("1")
	TEAM_1,
	@SerialName("2")
	TEAM_2,
}

@Serializable
data class Tournament(
	val id: Double,
	val name: String,
	val description: String,
	val type: EventTypeEnum,
	val createdAt: String,
	val updatedAt: String,
	val internalState: TournamentState,
	val startsAt: String,
	val grandFinalAt: String,
	val series: TournamentSeries? = null,
	val organization: OrganizationDTO,
	val managers: List<UserDTO>? = null,
	val participants: List<ParticipantDTO>? = null,
	val tournamentType: StageType,
	val participantsNumber: Double? = null,
	val seedOrdering: SeedOrdering? = null,
	val matchFormat: MatchFormat? = null,
	val customFormatChildCount: Double? = null,
	val groupStageEnabled: Boolean,
	val groupStageType: StageType? = null,
	val logo: String,
	val affiche: String? = null,
	val planning: String,
	val ruleset: String,
	/// True une fois le bonus AP podium (top 4) versé.
	/// Absent / false tant que non appliqué (tournois en cours ou formats hors scope).
	val placementEloApplied: Boolean? = null,
	/// Planning automatisé (voir `docs/plan-tournois.md`).
	val registrationOpensAt: String? = null,
	val registrationClosesAt: String? = null,
	val autoStart: Boolean? = null,
	val discordRoleEnabled: Boolean? = null,
	/// Qui saisit les scores (absent sur un tournoi d'avant l'option = joueurs).
	val scoreReportPolicy: ScoreReportPolicy? = null,
	/// Rôle Discord attribué aux inscrits, créé à l'ouverture des inscriptions.
	val discordRoleId: String? = null,
	/// Renseignés quand le tournoi a été annulé (l'entité reste en base).
	val cancelReason: String? = null,
	val canceledAt: String? = null,
	/// Horodatage d'une clôture manuelle (null si passage automatique en Terminé).
	val closedAt: String? = null,
)

/// Réponse de `GET /tournaments/:id` — un triplet, pas un objet : c'est la
/// forme réellement servie. Le décrire tel quel évite qu'un client invente une
/// normalisation que le suivant ne ferait pas.
///
/// `[tournoi, inscrits, données brutes de brackets-manager]`.
typealias TournamentDetail = Triple<WireTournament, List<WireParticipant>, JsonElement>

/// Enveloppe générique des mutations de tournoi.
typealias TournamentEnvelope = ApiEnvelope<T>

@Serializable
data class TournamentEventActor(
	val id: String,
	val username: String,
	val displayName: String,
	val avatar: String,
)

@Serializable
data class TournamentEventDTO(
	val id: String,
	val type: TournamentEventType,
	val createdAt: String,
	val actor: TournamentEventActor?,
	val target: TournamentEventActor?,
	val payload: Map<String, JsonElement>?,
	/// Motif (DQ, annulation) — null pour les non-organisateurs.
	val reason: String?,
)

/// Évènements journalisés d'un tournoi (table `tournament_event`).
///
/// Journal métier destiné à l'affichage — distinct d'`audit_log`, qui est un journal ops
/// signé en chaîne contenant IP et charges utiles arbitraires.
@Serializable
enum class TournamentEventType {
	@SerialName("created")
	CREATED,
	@SerialName("updated")
	UPDATED,
	@SerialName("registrations_opened")
	REGISTRATIONS_OPENED,
	@SerialName("registrations_closed")
	REGISTRATIONS_CLOSED,
	@SerialName("participant_registered")
	PARTICIPANT_REGISTERED,
	@SerialName("participant_waitlisted")
	PARTICIPANT_WAITLISTED,
	@SerialName("participant_promoted")
	PARTICIPANT_PROMOTED,
	@SerialName("participant_unregistered")
	PARTICIPANT_UNREGISTERED,
	@SerialName("participant_removed")
	PARTICIPANT_REMOVED,
	@SerialName("participant_disqualified")
	PARTICIPANT_DISQUALIFIED,
	@SerialName("participant_reinstated")
	PARTICIPANT_REINSTATED,
	@SerialName("seeding_changed")
	SEEDING_CHANGED,
	@SerialName("bracket_generated")
	BRACKET_GENERATED,
	@SerialName("tournament_started")
	TOURNAMENT_STARTED,
	@SerialName("score_reported")
	SCORE_REPORTED,
	@SerialName("score_validated")
	SCORE_VALIDATED,
	@SerialName("phase_advanced")
	PHASE_ADVANCED,
	@SerialName("organizer_added")
	ORGANIZER_ADDED,
	@SerialName("organizer_removed")
	ORGANIZER_REMOVED,
	@SerialName("tournament_closed")
	TOURNAMENT_CLOSED,
	@SerialName("tournament_canceled")
	TOURNAMENT_CANCELED,
	@SerialName("tournament_restored")
	TOURNAMENT_RESTORED,
}

/// Projection compacte de la liste publique `/tournaments`.
@Serializable
data class TournamentListItem(
	val id: Double,
	val name: String,
	val description: String,
	val type: String,
	val status: String?,
	val createdAt: String,
	val updatedAt: String,
)

@Serializable
data class TournamentMatchStats(
	val matches: Double,
	val totalGoals: Double,
	val avgGoals: Double,
	val topScore: Double,
	val minMargin: Double,
	val maxMargin: Double,
	val biggestBlowout: TournamentMatchup?,
	val closestMatch: TournamentMatchup?,
)

@Serializable
data class TournamentMatchup(
	val winnerDisplayName: String,
	val winnerAvatar: String,
	val loserDisplayName: String,
	val loserAvatar: String,
	val scoreWinner: Double,
	val scoreLoser: Double,
)

@Serializable
data class TournamentSeries(
	val id: Double,
	val name: String,
	val description: String,
	val logo: String,
	val organization: OrganizationDTO,
	val tournaments: List<Tournament>,
)

@Serializable
enum class TournamentState {
	@SerialName("Pending")
	PENDING,
	@SerialName("Preregistering")
	PREREGISTERING,
	@SerialName("Preparing")
	PREPARING,
	@SerialName("Ongoing")
	ONGOING,
	@SerialName("Finished")
	FINISHED,
	@SerialName("Canceled")
	CANCELED,
}

@Serializable
data class TournamentSummary(
	val top10: List<TournamentTop10Entry>,
	val stats: TournamentMatchStats?,
)

@Serializable
data class TournamentTop10Entry(
	val rank: Double,
	val rankLabel: String,
	val userId: String,
	val displayName: String,
	val avatar: String,
	val clan: CircuitClanTag?,
	/// Points de circuit gagnés pour CE tournoi — pas le cumul all-time.
	val points: Double,
	val tier: String,
	val goalsScored: Double,
	val goalsConceded: Double,
	val goalAverage: Double,
)

/// Mise à jour partielle d'un clan (PUT /clans/:id).
@Serializable
data class UpdateClanPayload(
	val name: String? = null,
	val shortenedName: String? = null,
	val clanBiography: String? = null,
	val clanAvatarUrl: String? = null,
	val xUrl: String? = null,
	val instagramUrl: String? = null,
	val tiktokUrl: String? = null,
	val isRecruiting: Boolean? = null,
	val autoAcceptMembers: Boolean? = null,
	val languages: List<String>? = null,
	val origin: String? = null,
)

/// Champs modifiables par le titulaire du profil.
@Serializable
data class UpdateUserProfilePayload(
	val bio: String? = null,
	val twitchUrl: String? = null,
)

/// `POST /proxy/upload` — image dédupliquée par hash côté API.
@Serializable
data class UploadedImage(
	val id: String,
	val url: String,
)

/// Identité affichable d'un joueur dans un rendu 2D/3D ou un classement.
@Serializable
data class User(
	val id: String,
	val name: String,
	val rank: Rank,
	val logo: String,
)

/// Appartenance de clan résumée, telle qu'embarquée dans un profil enrichi.
@Serializable
data class UserClanSummary(
	val id: Double,
	val shortenedName: String,
	val name: String,
	val avatarUrl: String? = null,
	val role: ClanMemberRole,
	val distinctions: List<ClanMemberDistinction>,
)

@Serializable
data class UserDTO(
	val id: String,
	/// Discriminant d'entité, présent sur les fiches publiques et absent de la
	/// session : optionnel pour que `SessionUserDTO` reste assignable.
	val type: String? = null,
	val username: String,
	/// Canonical Rose Griffon public profile slug when the Discord account is linked.
	val rgProfileUsername: String? = null,
	/// Champs présents uniquement sur la session de l'utilisateur courant.
	///
	/// `GET /clans` imbrique un président réduit (identité et profil public) qui
	/// ne les porte pas. Les exiger faisait échouer la validation de la réponse
	/// ENTIÈRE, donc de tous les clans.
	val sim: Double? = null,
	val avatar: String? = null,
	/// L'API historique sérialise l'absence de clan en `null` (et non en champ
	/// absent). Les deux formes sont donc recevables dans le contrat partagé.
	val clanId: Double? = null,
	val soloRank: RankDTO? = null,
	val duoRank: RankDTO? = null,
	val lastInteract: String? = null,
	val role: UserRole? = null,
	val currentLevel: Double? = null,
	val totalXp: Double? = null,
	val hasTwitch: Boolean? = null,
	val hasChallonge: Boolean? = null,
	val hasYoutube: Boolean? = null,
)

/// Vue minimale d'un utilisateur (avatar + libellé), suffisante pour une liste.
@Serializable
data class UserRef(
	val id: String,
	val username: String,
	val displayName: String? = null,
	val avatar: String? = null,
)

@Serializable
enum class UserRole {
	@SerialName("0")
	USER,
	@SerialName("1")
	MODERATOR,
	@SerialName("2")
	ADMINISTRATOR,
	@SerialName("3")
	SUPERADMINISTRATOR,
}

@Serializable
data class UsersAndGuildsResponse(
	val activeUsers: List<DailyCountRow>,
	val users: List<DailyCountRow>,
	val guilds: List<DailyCountRow>,
)

/// Portefeuille — un solde par utilisateur dans une devise virtuelle (ex. ACH)
/// plus un journal de mouvements.
@Serializable
data class WalletBalance(
	val balance: Double,
	val currency: String,
)

@Serializable
data class WalletHistoryPage(
	val transactions: List<WalletTransaction>,
	val total: Double? = null,
)

/// Une ligne du journal des transactions (`GET /wallet/me/history`).
@Serializable
data class WalletTransaction(
	/// PostgreSQL UUID of the immutable transaction row.
	val id: String,
	val type: WalletTransactionType,
	val amount: Double,
	val reason: String?,
	val direction: WalletTransactionDirection,
	val createdAt: String,
)

/// Sens du mouvement vis-à-vis du solde du titulaire.
@Serializable
enum class WalletTransactionDirection {
	@SerialName("in")
	IN,
	@SerialName("out")
	OUT,
}

/// Type de mouvement du portefeuille (doit matcher l'enum côté bot).
@Serializable
enum class WalletTransactionType {
	@SerialName("Credit")
	CREDIT,
	@SerialName("Debit")
	DEBIT,
	@SerialName("Transfer")
	TRANSFER,
	@SerialName("Payout")
	PAYOUT,
	@SerialName("Fine")
	FINE,
}

/// `ParticipantDTO` tel qu'il circule (le tournoi n'est souvent qu'un id).
@Serializable
data class WireParticipant(
	val id: Double,
	val user: UserDTO,
	val bracketParticipantId: Double? = null,
	val seed: Double? = null,
	val hasCheckedIn: Boolean,
	/// Absent sur les réponses d'API antérieures au statut : traiter comme `ACTIVE`.
	val status: ParticipantStatus? = null,
	val registeredAt: String? = null,
	/// Rang dans la liste d'attente (1 = prochain promu).
	val waitlistPosition: Double? = null,
	/// Motif de DQ — renseigné uniquement pour les organisateurs.
	val statusReason: String? = null,
	val tournament: EntityRef<WireTournament>,
)

/// `Tournament` tel qu'il circule (relations éventuellement réduites à un id).
@Serializable
data class WireTournament(
	val id: Double,
	val name: String,
	val description: String,
	val type: EventTypeEnum,
	val createdAt: String,
	val updatedAt: String,
	val internalState: TournamentState,
	val startsAt: String,
	val grandFinalAt: String,
	val tournamentType: StageType,
	val participantsNumber: Double? = null,
	val seedOrdering: SeedOrdering? = null,
	val matchFormat: MatchFormat? = null,
	val customFormatChildCount: Double? = null,
	val groupStageEnabled: Boolean,
	val groupStageType: StageType? = null,
	val logo: String,
	val affiche: String? = null,
	val planning: String,
	val ruleset: String,
	/// True une fois le bonus AP podium (top 4) versé.
	/// Absent / false tant que non appliqué (tournois en cours ou formats hors scope).
	val placementEloApplied: Boolean? = null,
	/// Planning automatisé (voir `docs/plan-tournois.md`).
	val registrationOpensAt: String? = null,
	val registrationClosesAt: String? = null,
	val autoStart: Boolean? = null,
	val discordRoleEnabled: Boolean? = null,
	/// Qui saisit les scores (absent sur un tournoi d'avant l'option = joueurs).
	val scoreReportPolicy: ScoreReportPolicy? = null,
	/// Rôle Discord attribué aux inscrits, créé à l'ouverture des inscriptions.
	val discordRoleId: String? = null,
	/// Renseignés quand le tournoi a été annulé (l'entité reste en base).
	val cancelReason: String? = null,
	val canceledAt: String? = null,
	/// Horodatage d'une clôture manuelle (null si passage automatique en Terminé).
	val closedAt: String? = null,
	val series: EntityRef<WireTournamentSeries>? = null,
	val organization: EntityRef<OrganizationDTO>,
	/// Relations OPTIONNELLES sur la liste.
	///
	/// `GET /tournaments` ne les peuple pas — seul `GET /tournaments/:id` le
	/// fait. Les exiger faisait rejeter les 9 tournois de la liste et affichait
	/// « Aucun tournoi trouvé » sur une API qui en servait neuf.
	val managers: List<EntityRef<UserDTO>>? = null,
	val participants: List<EntityRef<WireParticipant>>? = null,
)

/// `TournamentSeries` sans sa récursion de tournois peuplés.
@Serializable
data class WireTournamentSeries(
	val id: Double,
	val name: String,
	val description: String,
	val logo: String,
	val organization: EntityRef<OrganizationDTO>,
	val tournaments: List<EntityRef<WireTournament>>? = null,
)
