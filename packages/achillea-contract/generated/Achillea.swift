// Contrat Achilléa — FICHIER GÉNÉRÉ, ne pas éditer à la main.
// Source : @rosegriffon/achillea-types@1.4.4
// Régénérer : bun --filter @rosegriffon/achillea-contract generate

import Foundation

/// Valeur JSON arbitraire — utilisée pour les charges utiles libres du contrat.
public struct AnyCodable: Codable, Sendable {
	public let value: Data?

	public init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		self.value = try? JSONSerialization.data(
			withJSONObject: container.decode(AnyDecodableBox.self).unwrapped,
			options: [.fragmentsAllowed]
		)
	}

	public func encode(to encoder: Encoder) throws {
		var container = encoder.singleValueContainer()
		guard let value,
			let object = try? JSONSerialization.jsonObject(with: value, options: [.fragmentsAllowed])
		else {
			try container.encodeNil()
			return
		}
		try container.encode(AnyDecodableBox(unwrapped: object))
	}
}

private struct AnyDecodableBox: Codable, @unchecked Sendable {
	let unwrapped: Any

	init(unwrapped: Any) { self.unwrapped = unwrapped }

	init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		if container.decodeNil() { unwrapped = NSNull() }
		else if let bool = try? container.decode(Bool.self) { unwrapped = bool }
		else if let int = try? container.decode(Int.self) { unwrapped = int }
		else if let double = try? container.decode(Double.self) { unwrapped = double }
		else if let string = try? container.decode(String.self) { unwrapped = string }
		else if let array = try? container.decode([AnyDecodableBox].self) {
			unwrapped = array.map(\.unwrapped)
		} else if let object = try? container.decode([String: AnyDecodableBox].self) {
			unwrapped = object.mapValues(\.unwrapped)
		} else {
			unwrapped = NSNull()
		}
	}

	func encode(to encoder: Encoder) throws {
		var container = encoder.singleValueContainer()
		switch unwrapped {
		case let bool as Bool: try container.encode(bool)
		case let int as Int: try container.encode(int)
		case let double as Double: try container.encode(double)
		case let string as String: try container.encode(string)
		case let array as [Any]: try container.encode(array.map { AnyDecodableBox(unwrapped: $0) })
		case let object as [String: Any]:
			try container.encode(object.mapValues { AnyDecodableBox(unwrapped: $0) })
		default: try container.encodeNil()
		}
	}
}

public struct AdminAuditRow: Codable, Sendable {
	public let id: String
	public let ts: String
	public let actorId: String?
	public let action: String
	public let targetType: String
	public let targetId: String?
	public let reason: String?
}

public struct AdminGuildRow: Codable, Sendable {
	public let id: String
	public let name: String
	public let iconUrl: String?
	public let memberCount: Double
	public let ownerId: String
	public let createdAt: String?

	public enum CodingKeys: String, CodingKey {
		case id = "id"
		case name = "name"
		case iconUrl = "iconURL"
		case memberCount = "memberCount"
		case ownerId = "ownerId"
		case createdAt = "createdAt"
	}
}

public struct AdminHealthResponse: Codable, Sendable {
	public let bot: AnyCodable
	public let host: AnyCodable
	public let pid: AnyCodable
	public let latency: AnyCodable
}

public struct AdminInviteResponse: Codable, Sendable {
	public let url: String
}

public struct AdminMetricsSummary: Codable, Sendable {
	public let counters: [String: Double]
	public let rawLines: Double
}

public struct AdminOpsOverview: Codable, Sendable {
	public let users: AnyCodable
	public let wallet: AnyCodable
	public let moderation: AnyCodable
	public let community: AnyCodable
	public let ranked: AnyCodable
	public let audit24h: Double
	public let bot: AnyCodable?
	public let generatedAt: String?
}

public struct AdminRoleUpdateResult: Codable, Sendable {
	public let success: Bool
	public let id: String
	public let role: Double
}

public struct AdminTransactionRow: Codable, Sendable {
	public let id: AnyCodable
	public let type: String
	public let amount: Double
	public let reason: String?
	public let fromUserId: String?
	public let toUserId: String?
	public let createdAt: String
}

public struct AdminUserRow: Codable, Sendable {
	public let id: String
	public let username: String?
	public let displayName: String?
	public let avatar: String?
	public let role: Double
	public let lastInteract: String?
}

public struct AdminWalletAdjustResult: Codable, Sendable {
	public let success: Bool
	public let userId: String
	public let balance: Double
}

public struct AdminWalletRow: Codable, Sendable {
	public let userId: String
	public let displayName: String
	public let balance: Double
	public let currency: String
}

public struct AdminWalletsResponse: Codable, Sendable {
	public let top: [AdminWalletRow]
	public let recent: [AdminTransactionRow]
}

/// Réponse enveloppée : `{ success, data?, error? }`.
public struct ApiEnvelope<T: Codable>: Codable, Sendable {
	public let success: Bool
	public let data: T?
	public let error: String?
}

public struct BotMonitoringResponse: Codable, Sendable {
	public let botStatus: AnyCodable
	public let host: AnyCodable
	public let pid: AnyCodable
	public let latency: AnyCodable
}

/// Formes du tableau de bord d'administration : ops, portefeuilles, audit,
/// santé du bot et console base de données.
///
/// Réservées au staff côté API, mais décrites ici comme le reste : un contrat
/// privé reste un contrat, et c'est précisément là que la dérive silencieuse
/// coûte le plus cher (une colonne renommée casse une console d'admin sans que
/// personne ne le voie avant l'incident).
public struct BotTotalsResponse: Codable, Sendable {
	public let stats: AnyCodable
}

/// Identifiant d'entité bracket (`brackets-model#Id`).
public typealias BracketId = AnyCodable

/// Statut d'un match de bracket (`brackets-model#Status`), en valeurs numériques.
public enum BracketMatchStatus: Int, Codable, Sendable, CaseIterable {
	case locked = 0
	case waiting = 1
	case ready = 2
	case running = 3
	case completed = 4
	case archived = 5
}

/// `brackets-model#StageType` — formats de bracket supportés par la lib.
public typealias BracketsStageType = String

public struct CancelTournamentResult: Codable, Sendable {
	public let success: Bool
	public let error: String?
	public let notified: Double?
}

public struct CastAttribution: Codable, Sendable {
	public let id: String
	public let slotId: String
	public let userId: String?
	public let assignedAt: String
	public let assignedBy: String
	public let confirmedAt: String?
}

/// `POST /casts/:id/auto-assign`. Générique sur l'attribution : l'API renvoie
/// la forme complète, un appelant peut n'en valider qu'une projection.
public struct CastAutoAssignResult<TAttribution: Codable>: Codable, Sendable {
	public let created: Double
	public let attributions: [TAttribution]
}

public struct CastAvailability: Codable, Sendable {
	public let id: String
	public let userId: String
	public let status: CastAvailabilityStatus
	public let preferredRoles: [CastSlotRole]?
	public let notes: String?
	public let declaredAt: String
}

public enum CastAvailabilityStatus: String, Codable, Sendable, CaseIterable {
	case available = "available"
	case maybe = "maybe"
	case unavailable = "unavailable"
}

public struct CasterPublic: Codable, Sendable {
	public let id: String
	public let displayName: String
	public let avatar: String?
	public let bio: String?
	public let twitchUrl: String?
	public let recentCasts: Double
}

public struct CastEvent: Codable, Sendable {
	public let id: String
	public let name: String
	public let kind: CastEventKind
	public let scheduledAt: String
	public let duration: Double
	public let tournamentId: String?
	public let status: CastEventStatus
	public let description: String?
	public let twitchUrl: String?
	public let createdBy: String
	public let createdAt: String
	public let updatedAt: String
}

public struct CastEventDetail: Codable, Sendable {
	public let event: CastEvent
	public let slots: [CastSlot]
	public let attributions: [CastAttribution]
	public let checklist: [ChecklistItem]
}

public struct CastEventFilters: Codable, Sendable {
	public let page: Double?
	public let pageSize: Double?
	public let status: CastEventStatus?
	public let from: String?
	public let to: String?
}

/// Nature d'un évènement à caster.
public enum CastEventKind: String, Codable, Sendable, CaseIterable {
	case match = "match"
	case tournament = "tournament"
	case stream = "stream"
	case other = "other"
}

public typealias CastEventListResponse = PagedList<CastEvent>

public enum CastEventStatus: String, Codable, Sendable, CaseIterable {
	case planned = "planned"
	case openSignup = "open_signup"
	case attributed = "attributed"
	case live = "live"
	case done = "done"
	case cancelled = "cancelled"
}

public struct CastSlot: Codable, Sendable {
	public let id: String
	public let role: CastSlotRole
	public let required: Bool
	public let defraymentAmount: String?
	public let defraymentCurrency: String?
	public let defraymentReason: String?
	public let notes: String?
}

/// Poste occupé sur une diffusion.
public enum CastSlotRole: String, Codable, Sendable, CaseIterable {
	case casterMain = "caster_main"
	case casterSecondary = "caster_secondary"
	case observer = "observer"
	case producer = "producer"
	case host = "host"
	case technical = "technical"
}

public struct CastSurveyResult: Codable, Sendable {
	public let success: Bool
	public let eventId: String
	public let poolSize: Double
}

/// Ligne de checklist : un poste, son attributaire éventuel, sa confirmation.
public struct ChecklistItem: Codable, Sendable {
	public let slot: CastSlot
	public let attribution: CastAttribution?
	public let casterId: String?
	public let confirmed: Bool
}

/// Classement des clans — somme des points circuit de leurs membres actuels.
public struct CircuitClanEntry: Codable, Sendable {
	public let id: Double
	public let name: String
	public let shortName: String
	public let avatar: String
	public let points: Double
	public let players: Double
	public let tournamentsPlayed: Double
	public let wins: Double
	public let podiums: Double
	public let tier: String
}

public struct CircuitClanTag: Codable, Sendable {
	public let id: Double
	public let name: String
	public let shortName: String
	public let avatar: String
}

/// Classement circuit — cumul de points de circuit sur tous les tournois
/// élimination terminés. Calcul : `@rosegriffon/achillea-core/tournaments`.
public struct CircuitLeaderboardEntry: Codable, Sendable {
	public let userId: String
	public let displayName: String
	public let username: String
	public let avatar: String
	public let clan: CircuitClanTag?
	public let tournamentsPlayed: Double
	public let points: Double
	public let tournaments: Double
	public let wins: Double
	public let podiums: Double
	public let top4: Double
	public let top8: Double
	public let bestRank: Double
	public let bestRankLabel: String
	/// Palier circuit — mêmes clés que le ranked (Fer → Légendaire).
	public let tier: String
}

public struct CircuitPodiumEntry: Codable, Sendable {
	public let rank: Double
	public let rankLabel: String
	public let userId: String
	public let displayName: String
	public let avatar: String
}

public struct CircuitRanking: Codable, Sendable {
	public let leaderboard: [CircuitLeaderboardEntry]
	public let tournaments: [CircuitTournamentSummary]
	public let clanRanking: [CircuitClanEntry]
}

public struct CircuitTournamentSummary: Codable, Sendable {
	public let id: Double
	public let name: String
	public let size: Double
	public let grandFinalAt: String
	public let podium: [CircuitPodiumEntry]
	public let standingsStatus: String
}

/// Forme historique dénormalisée (snake_case) encore servie par quelques vues.
/// Conservée pour compatibilité ; toute nouvelle route doit renvoyer `ClanDTO`.
public struct Clan: Codable, Sendable {
	public let id: Double
	public let logo: String
	public let name: String
	public let shortName: String
	public let description: String
	public let captain: String
	public let founders: [String]
	public let xUrl: String?
	public let instagramUrl: String?
	public let tiktokUrl: String?
	public let fame: Double
	public let xp: Double
	public let rank: Rank?
	public let createdAt: String
	public let isPro: Bool
	public let isRecruiting: Bool
	public let autoRecruit: Bool
	public let langue: String?

	public enum CodingKeys: String, CodingKey {
		case id = "id"
		case logo = "logo"
		case name = "name"
		case shortName = "shortName"
		case description = "description"
		case captain = "captain"
		case founders = "founders"
		case xUrl = "x_url"
		case instagramUrl = "instagram_url"
		case tiktokUrl = "tiktok_url"
		case fame = "fame"
		case xp = "xp"
		case rank = "rank"
		case createdAt = "created_at"
		case isPro = "isPro"
		case isRecruiting = "isRecruiting"
		case autoRecruit = "autoRecruit"
		case langue = "langue"
	}
}

public struct ClanApplicationDTO: Codable, Sendable {
	public let id: Double
	public let user: UserDTO
	public let clan: ClanDTO
	public let distinctions: [ClanMemberDistinction]
	public let createdAt: String
	public let updatedAt: String
}

public struct ClanApplicationResult: Codable, Sendable {
	public let success: Bool
	public let error: String?
	/// `true` quand le clan accepte automatiquement les candidatures.
	public let autojoin: Bool?
}

public struct ClanDTO: Codable, Sendable {
	public let id: Double
	/// Identifiants Discord des fondateurs.
	///
	/// L'API en renvoie un TABLEAU. Le contrat disait `string`, donc la
	/// validation rejetait chaque clan : les 42 clans existaient, l'API les
	/// servait, et la page affichait « 0 clan trouvé ».
	public let founders: [String]
	public let name: String
	public let shortenedName: String
	public let normalizedShortName: String
	public let clanAvatarUrl: String
	public let clanBiography: String
	/// Absent de la charge utile de `GET /clans` : optionnel.
	public let fame: Double?
	public let xUrl: String?
	public let instagramUrl: String?
	public let tiktokUrl: String?
	public let isRecruiting: Bool
	public let isInactive: Bool
	public let isHidden: Bool
	public let isDisbanded: Bool
	public let autoAcceptMembers: Bool
	public let state: ClanState
	public let createdAt: String
	public let languages: [String]
	public let origin: String
	public let experience: AnyCodable
	public let membersCount: Double
	public let president: UserDTO
}

public struct ClanInviteDTO: Codable, Sendable {
	public let id: Double
	public let user: UserDTO
	public let clan: ClanDTO
	public let inviter: ClanMemberDTO
	public let threadId: String?
	public let distinctions: [ClanMemberDistinction]
	public let createdAt: String
	public let updatedAt: String
	public let lastNotifiedAt: String
}

public enum ClanMemberDistinction: String, Codable, Sendable, CaseIterable {
	case player = "Joueur"
	case staff = "Staff"
	case artist = "Artiste"
	case contentCreator = "Créateur de contenu"
}

public struct ClanMemberDTO: Codable, Sendable {
	/// Rôle du membre dans le clan (Trial, Member, SubCaptain, Captain).
	public let clanRole: ClanMemberRole
	/// Distinctions brutes telles que stockées (`['Staff', 'Player']`).
	public let distinctions: [String]
	public let clanFameContributed: Double
	public let createdAt: String
	public let updatedAt: String
	public let user: UserDTO
}

public struct ClanMemberLimits: Codable, Sendable {
	public let playerLimit: Double
	public let staffLimit: Double
}

public enum ClanMemberRole: Int, Codable, Sendable, CaseIterable {
	case trial = 0
	case member = 1
	case subCaptain = 2
	case captain = 3
}

/// `GET /clans/role` — `-1` quand l'appelant n'est dans aucun clan.
public struct ClanRoleResponse: Codable, Sendable {
	public let role: Double
}

public enum ClanState: Int, Codable, Sendable, CaseIterable {
	case creating = 0
	case pendingReview = 1
	case approved = 2
}

public struct CloseTournamentResult: Codable, Sendable {
	public let success: Bool
	public let error: String?
	public let openLobbies: Double?
}

/// Descripteur de colonne — partagé par toutes les tables, quel que soit l'UI.
public struct Column: Codable, Sendable {
	public let field: String
	public let header: String
}

public struct CommandUsageRow: Codable, Sendable {
	public let date: String
	public let slashCommands: Double
	public let simpleCommands: Double
	public let contextMenus: Double
}

/// Stats agrégées d'un mode de compétition (interclans / tournois).
public struct CompetitionStats: Codable, Sendable {
	/// Nombre d'événements distincts (tournois / interclans) auxquels le joueur a participé.
	public let total: Double
	/// Victoires d'équipe / de clan (contrib).
	public let wins: Double
	/// Défaites d'équipe / de clan (contrib).
	public let losses: Double
	/// Nuls d'équipe (si applicable).
	public let draws: Double
	public let goalsScoredAvg: Double
	public let goalsReceivedAvg: Double
	/// Matchs individuels joués.
	public let personalTotal: Double
	public let personalWins: Double
	public let personalLosses: Double
	public let personalDraws: Double
}

/// Pays / langue d'origine d'un clan ou d'une organisation.
///
/// La table de référence elle-même vit dans
/// `@rosegriffon/achillea-core/reference` : c'est une donnée, pas un contrat.
public struct Country: Codable, Sendable {
	/// Code ISO 639-1 en minuscules (`fr`, `en`, …).
	public let code: String
	/// Libellé de la langue en français (`Français`).
	public let language: String
	/// Chemin du drapeau, relatif aux assets du front.
	public let flag: String
	/// Nom du pays en français (`France`).
	public let name: String
}

public struct CreateCastEventPayload: Codable, Sendable {
	public let name: String
	public let kind: CastEventKind
	public let scheduledAt: String
	public let duration: Double?
	public let tournamentId: String?
	public let twitchUrl: String?
	public let description: String?
	public let slots: [AnyCodable]
}

public struct CreatePlayerNotePayload: Codable, Sendable {
	public let targetId: String
	public let tournamentId: Double?
	public let category: PlayerNoteCategory?
	public let severity: PlayerNoteSeverity?
	public let content: String
}

public struct CreateSanctionPayload: Codable, Sendable {
	public let userId: String
	public let guildId: String
	public let type: SanctionType
	public let reason: String?
	public let durationSec: Double?
	public let evidence: [[String: AnyCodable]]?
}

public struct DailyCountRow: Codable, Sendable {
	public let date: String
	public let count: Double
}

public struct DatabaseBackupResult: Codable, Sendable {
	public let message: String
	public let data: AnyCodable?
}

/// Métadonnée de colonne SQL — voisine de `Column`, mais côté base.
public struct DbColumn: Codable, Sendable {
	public let name: String
	public let dataType: String
	public let nullable: Bool
	public let `default`: String?
	public let isPrimaryKey: Bool
}

public struct DbMutationResult: Codable, Sendable {
	public let success: Bool
	public let row: [String: AnyCodable]?
}

public struct DbQueryResult: Codable, Sendable {
	public let data: [[String: AnyCodable]]
	public let rowCount: Double
	public let durationMs: Double
}

public struct DbRowsPage: Codable, Sendable {
	public let data: [[String: AnyCodable]]
	public let columns: [DbColumn]
	public let meta: PageMeta
}

public struct DbTableRow: Codable, Sendable {
	public let name: String
	public let estimatedRows: Double
	public let protected: Bool
}

public struct DisqualifyResult: Codable, Sendable {
	public let success: Bool
	public let error: String?
	public let forfeitedLobbies: Double?
	public let promoted: String?
}

public struct EnrichedUserDTO: Codable, Sendable {
	public let id: String
	/// Discriminant d'entité, présent sur les fiches publiques et absent de la
	/// session : optionnel pour que `SessionUserDTO` reste assignable.
	public let type: String?
	public let username: String
	/// Canonical Rose Griffon public profile slug when the Discord account is linked.
	public let rgProfileUsername: String?
	/// Champs présents uniquement sur la session de l'utilisateur courant.
	///
	/// `GET /clans` imbrique un président réduit (identité et profil public) qui
	/// ne les porte pas. Les exiger faisait échouer la validation de la réponse
	/// ENTIÈRE, donc de tous les clans.
	public let sim: Double?
	public let avatar: String?
	/// L'API historique sérialise l'absence de clan en `null` (et non en champ
	/// absent). Les deux formes sont donc recevables dans le contrat partagé.
	public let clanId: Double?
	public let soloRank: RankDTO?
	public let duoRank: RankDTO?
	public let lastInteract: String?
	public let role: UserRole?
	public let currentLevel: Double?
	public let totalXp: Double?
	public let hasTwitch: Bool?
	public let hasChallonge: Bool?
	public let hasYoutube: Bool?
	public let clan: UserClanSummary?
	public let interclans: CompetitionStats
	/// Stats de matchs de tournoi (brackets / swiss).
	public let tournaments: CompetitionStats
	public let ranked: AnyCodable
	/// Éditable par le titulaire du profil (PUT /users/me/profile).
	public let bio: String?
	public let twitchUrl: String?
}

/// Relation sérialisée par l'ORM : soit l'identifiant seul, soit l'entité
/// peuplée, selon que la requête a chargé la relation ou non. Un client doit
/// gérer les deux cas — d'où ce type plutôt qu'un objet supposé toujours présent.
public typealias EntityRef = AnyCodable

/// Racine commune à tout évènement compétitif (tournoi, interclan, ranked).
public struct EventEntity: Codable, Sendable {
	public let id: Double
	public let name: String
	public let description: String
	public let type: EventTypeEnum
	public let createdAt: String
	public let updatedAt: String
}

public enum EventTypeEnum: String, Codable, Sendable, CaseIterable {
	case tournament = "TOURNAMENT"
	case interclan = "INTERCLAN"
	case ranked = "RANKED"
}

/// Mode d'un formulaire de validation (création / revue / édition).
public enum FormMode: Int, Codable, Sendable, CaseIterable {
	case create = 0
	case validate = 1
	case edit = 2
}

public struct GameScoreDTO: Codable, Sendable {
	public let lobbyId: Double
	public let gameNumber: Double
	public let score1: Double
	public let score2: Double
}

public struct GameValidatorDTO: Codable, Sendable {
	public let lobbyId: Double
	public let lobbyMatchId: Double
}

/// `brackets-model#GrandFinalType`.
public typealias GrandFinalType = String

public struct HealthCheckResponse: Codable, Sendable {
	public let online: Bool
	public let uptime: Double?
	public let lastStartup: AnyCodable?
}

public struct ImageGenerationResult: Codable, Sendable {
	public let success: Bool
	public let error: String?
	public let path: String?
}

public enum InterclanState: Int, Codable, Sendable, CaseIterable {
	case pendingApproval = 0
	case approved = 1
	case denied = 2
	case ready = 3
	case ongoing = 4
	case finished = 5
	case canceled = 6
	case resultOk = 7
	case resultNok = 8
}

public struct LeaderboardEntry: Codable, Sendable {
	public let rank: Double
	public let userId: String
	public let displayName: String
	public let avatar: String
	public let elo: Double
	public let peakRating: Double
	public let gamesPlayed: Double
}

public struct LeaderboardPage: Codable, Sendable {
	public let entries: [LeaderboardEntry]
	public let total: Double
	public let mode: MatchMode
}

public struct LeagueListResponse: Codable, Sendable {
	public let items: [LeagueSummary]
}

public struct LeagueMatchRow: Codable, Sendable {
	public let homeId: String
	public let awayId: String
	public let homeScore: Double
	public let awayScore: Double
	public let matchday: Double
	public let overtime: Bool?
	public let winnerId: String?
}

public struct LeaguePointsConfig: Codable, Sendable {
	/// Graphie servie par l'API.
	public let win: Double?
	public let draw: Double?
	public let loss: Double?
	/// Graphie historique du contrat, conservée pour les appelants existants.
	public let winRegulation: Double?
	public let lossRegulation: Double?
	public let winOvertime: Double?
	public let lossOvertime: Double?
}

public struct LeagueSeasonPayload: Codable, Sendable {
	public let meta: LeagueSummary
	public let format: [String: AnyCodable]
	public let teams: [LeagueTeam]
	public let pointsConfig: LeaguePointsConfig
	public let standings: [LeagueStandingRow]
	public let results: [LeagueMatchRow]
	public let playoffs: AnyCodable
	public let schedule: AnyCodable?
	public let details: AnyCodable?
}

public struct LeagueStandingRow: Codable, Sendable {
	public let teamId: String
	public let rank: Double
	public let played: Double
	public let wins: Double
	public let draws: Double
	public let losses: Double
	public let winsOt: Double
	public let lossesOt: Double
	public let points: Double
	public let mapDiff: Double
	public let mapsFor: Double
	public let mapsAgainst: Double
}

/// Formes de championnat exposées par l'API.
///
/// Le calcul (classement, points, calendrier) vit dans
/// `@rosegriffon/achillea-core/league` ; seules les formes échangées sont ici,
/// pour qu'un client n'ait pas à dépendre de la logique métier pour lire une
/// réponse.
public struct LeagueSummary: Codable, Sendable {
	public let id: String
	public let name: String
	public let season: String
	public let format: String
	public let description: String
	public let champion: String?
	public let teamCount: Double
	public let matchdays: Double
	public let aliases: [String]
}

public struct LeagueTeam: Codable, Sendable {
	public let tag: String
	public let name: String
}

/// Licence joueur — un titulaire = un userId Discord, une licence active à la
/// fois, vérifiable publiquement via un QR code.
public struct License: Codable, Sendable {
	public let id: String
	public let userId: String
	public let licenseNumber: String
	public let issuedAt: String
	public let validUntil: String
	public let status: LicenseStatus
	/// Nullable until the printable licence PDF has been generated.
	public let pdfUrl: String?
	public let createdAt: String
	public let updatedAt: String
}

/// `GET /licenses/me` — `null` tant qu'aucune licence n'a été émise.
public struct LicenseHolderResponse: Codable, Sendable {
	public let license: License?
	/// Owner-only bearer token used to share the public verification URL.
	public let verificationToken: String?
}

/// État d'une licence joueur.
public enum LicenseStatus: String, Codable, Sendable, CaseIterable {
	case active = "Active"
	case revoked = "Revoked"
	case expired = "Expired"
}

/// Motif d'invalidité renvoyé par la vérification publique.
public typealias LicenseVerifyReason = String

/// Résultat de `GET /licenses/verify/{qr}` (endpoint PUBLIC, sans auth).
public struct LicenseVerifyResult: Codable, Sendable {
	public let valid: Bool
	public let reason: LicenseVerifyReason?
	public let licenseNumber: String?
	public let validUntil: String?
	public let holder: AnyCodable?
}

public struct LobbyDTO: Codable, Sendable {
	public let id: Double
	public let mode: MatchMode
	public let state: LobbyState
	public let bracketMatchId: Double?
	public let lobbyUsers: [LobbyUserDTO]
	public let lobbyMatches: [LobbyMatchDTO]
	public let hostUser: LobbyUserDTO?
	public let matchFormat: MatchFormat?
}

public struct LobbyMatchDTO: Codable, Sendable {
	public let id: Double
	public let gameNumber: Double
	public let scoreTeam1: Double
	public let scoreTeam2: Double
	public let team1Validated: Bool
	public let team2Validated: Bool
	public let adminValidated: Bool
}

public enum LobbyState: String, Codable, Sendable, CaseIterable {
	case fresh = "Fresh"
	case ongoing = "Ongoing"
	case pendingValidation = "Pending validation"
	case contested = "Contested"
	case finished = "Finished"
	case canceled = "Canceled"
	case forfeited = "Forfeited"
}

public struct LobbyUserDataDTO: Codable, Sendable {
	public let displayName: String
	public let id: String
	public let avatar: String
}

public struct LobbyUserDTO: Codable, Sendable {
	public let id: Double
	public let user: LobbyUserDataDTO
	public let team: TeamSide
	public let forfeit: Bool
	public let state: LobbyUserState
}

public enum LobbyUserState: String, Codable, Sendable, CaseIterable {
	case pending = "Pending"
	case ready = "Ready"
	case afk = "Afk"
	case ongoing = "Ongoing"
	case finished = "Finished"
	case repooled = "Repooled"
}

public struct MaintenanceResponse: Codable, Sendable {
	public let maintenance: Bool
}

public enum MatchFormat: String, Codable, Sendable, CaseIterable {
	case bo1 = "bo1"
	case bo3 = "bo3"
	case bo5 = "bo5"
	case doubleLeg = "double_leg"
	case custom = "custom"
}

public enum MatchMode: Int, Codable, Sendable, CaseIterable {
	case oneVsOne = 2
	case twoVsTwo = 4
}

public typealias MatchResult = String

public typealias MatchRoomStatus = String

public struct ModerationSyncResult: Codable, Sendable {
	public let ok: Bool
	public let sanctionId: String
}

/// Création d'un clan (POST /clans/create, API Achilléa historique).
public struct NewClanPayload: Codable, Sendable {
	public let founders: [AnyCodable]
	public let logo: String
	public let name: String
	public let normalizedName: String
	public let shortName: String
	public let normalizedShortName: String
	public let description: String
	public let twitter: String?
	public let instagram: String?
	public let tiktok: String?
	public let origin: Country?
	public let languages: [Country]?
}

public struct NewClanResponse: Codable, Sendable {
	public let success: Bool
	public let error: String?
	public let clanId: Double?
	/// Renseigné sur un conflit de nom (409).
	public let conflict: String?
}

public struct NewTournamentDTO: Codable, Sendable {
	public let name: String
	public let description: String
	public let series: TournamentSeries?
	public let organization: AnyCodable
	public let managers: [UserDTO]?
	public let startsAt: String
	public let grandFinalAt: String
	public let tournamentType: StageType
	public let participantsNumber: Double?
	public let seedOrdering: SeedOrdering?
	public let matchFormat: MatchFormat?
	public let customFormatChildCount: Double?
	public let groupStageEnabled: Bool
	public let groupStageType: StageType?
	public let affiche: String?
	public let logo: String
	public let ruleset: String
	public let planning: String
	/// Planning automatisé — facultatif : sans dates, le tournoi se conduit à la main.
	public let registrationOpensAt: AnyCodable?
	public let registrationClosesAt: AnyCodable?
	public let autoStart: Bool?
	/// Rôle Discord distribué aux inscrits.
	public let discordRoleEnabled: Bool?
	/// Qui saisit les scores des matchs (défaut : les joueurs).
	public let scoreReportPolicy: ScoreReportPolicy?
	/// Dérogation aux règles de publication — SuperAdmin uniquement, côté API.
	public let bypassRules: Bool?
}

public enum NotificationCategory: Int, Codable, Sendable, CaseIterable {
	case user = 0
	case clan = 1
	case global = 2
	case organization = 3
}

public struct NotificationModel: Codable, Sendable {
	public let id: Double
	public let title: String
	public let message: String
	public let type: NotificationType
	public let category: NotificationCategory
	public let payload: [String: AnyCodable]?
}

public enum NotificationType: Int, Codable, Sendable, CaseIterable {
	case newOrganizationCreationRequest = 0
	case newOrganizationEditionRequest = 1
	case newOrganizationEditReply = 2
	case newOrganizationAcceptReply = 3
	case newOrganizationRejectReply = 4
	case clanMemberKick = 5
}

public struct OpenRegistrationsResult: Codable, Sendable {
	public let success: Bool
	public let id: Double
	public let internalState: TournamentState
}

public struct OrganizationDTO: Codable, Sendable {
	public let id: AnyCodable?
	public let state: OrganizationState?
	public let name: String
	public let normalizedName: String
	public let logo: String
	public let description: String
	public let owner: AnyCodable?
	public let orgManagers: [UserDTO]?
	public let managers: [OrgManagerDTO]?
	public let preapproved: Bool?
	public let socialMedias: [SocialMediaDTO]?
	public let broadcastMedias: [SocialMediaDTO]?
	public let origin: AnyCodable?
	public let createdAt: String?
	public let updatedAt: String?
}

/// Cycle de revue d'une organisation (structure e-sport).
public enum OrganizationState: Int, Codable, Sendable, CaseIterable {
	case pending = 0
	case approved = 1
	case rejected = 2
}

/// Revue d'une demande de création / édition d'organisation.
public struct OrganizationValidationDTO: Codable, Sendable {
	public let id: AnyCodable?
	public let reviewer: UserDTO
	public let name: String?
	public let logo: String?
	public let description: String?
	public let twitterUrl: String?
	public let instagramUrl: String?
	public let tiktokUrl: String?
	public let twitchUrl: String?
	public let youtubeUrl: String?
}

public struct OrgManagerDTO: Codable, Sendable {
	public let organization: AnyCodable?
	public let user: UserDTO
	public let createdAt: String?
	public let updatedAt: String?
}

public struct PagedList<T: Codable>: Codable, Sendable {
	public let data: [T]
	public let total: Double
	public let meta: PageSizeMeta
}

/// Métadonnées de page renvoyées par l'API (style `Paginated<T>` historique).
public struct PageMeta: Codable, Sendable {
	/// Seul `total` est garanti.
	///
	/// Mesuré sur `GET /clans` : l'API renvoie `{ total, pageCount: null }`. Une
	/// enveloppe de pagination ne doit jamais pouvoir invalider sa charge utile —
	/// exiger ces champs effaçait les 42 clans pour une histoire de compteur.
	public let page: Double?
	public let limit: Double?
	public let total: Double
	public let pageCount: Double?
}

/// Requête de pagination commune à toutes les listes.
public struct PageQuery: Codable, Sendable {
	public let page: Double?
	public let pageSize: Double?
}

/// Variante « pageSize » utilisée par les contrôleurs récents (casts, sanctions,
/// notes joueur). Conservée distincte de `PageMeta` : les deux formes coexistent
/// réellement sur l'API, les fusionner casserait un des deux appelants.
public struct PageSizeMeta: Codable, Sendable {
	public let page: Double
	public let pageSize: Double
	public let pageCount: Double
}

public struct Paginated<T: Codable>: Codable, Sendable {
	public let data: [T]
	public let meta: PageMeta
}

public struct ParticipantDTO: Codable, Sendable {
	public let id: Double
	public let tournament: Tournament
	public let user: UserDTO
	public let bracketParticipantId: Double?
	public let seed: Double?
	public let hasCheckedIn: Bool
	/// Absent sur les réponses d'API antérieures au statut : traiter comme `ACTIVE`.
	public let status: ParticipantStatus?
	public let registeredAt: String?
	/// Rang dans la liste d'attente (1 = prochain promu).
	public let waitlistPosition: Double?
	/// Motif de DQ — renseigné uniquement pour les organisateurs.
	public let statusReason: String?
}

public struct ParticipantMutationResult: Codable, Sendable {
	public let success: Bool
	public let error: String?
	public let participant: WireParticipant?
}

/// Statut d'un inscrit à un tournoi.
///
/// Un seul axe pour deux besoins qui portaient sur la même ligne : la liste d'attente
/// quand le tournoi est plein, et la disqualification. Seuls les `Active` comptent dans
/// la capacité, le seeding et le bracket.
public enum ParticipantStatus: String, Codable, Sendable, CaseIterable {
	case active = "Active"
	case waitlisted = "Waitlisted"
	case disqualified = "Disqualified"
}

public struct PlacementPrizesResult: Codable, Sendable {
	public let success: Bool
	public let error: String?
	public let applied: Bool?
	public let reason: String?
	public let deltas: [String: Double]?
	public let tournamentSize: Double?
}

/// Profil circuit d'un joueur — page profil public `/users/:id`.
public struct PlayerCircuitProfile: Codable, Sendable {
	public let tournamentsPlayed: Double
	public let points: Double
	public let tier: String
	public let wins: Double
	public let podiums: Double
	public let top4: Double
	public let top8: Double
	public let bestRankLabel: String
	public let goalsScored: Double
	public let goalsConceded: Double
	public let goalAverage: Double
	public let bestStreak: Double
	public let history: [PlayerTournamentHistoryEntry]
}

public struct PlayerNote: Codable, Sendable {
	public let id: String
	public let target: PlayerNotePerson?
	public let author: PlayerNotePerson?
	public let tournament: AnyCodable?
	public let category: PlayerNoteCategory
	public let severity: PlayerNoteSeverity
	public let content: String
	public let resolved: Bool
	public let resolvedAt: String?
	public let resolvedBy: PlayerNotePerson?
	public let createdAt: String
	public let updatedAt: String
	/// Registre Drive où le signalement a été consigné (null si Drive non configuré).
	public let docsUrl: String?
}

/// Notes du staff sur un joueur (« espace dédié » où les organisateurs consignent ce
/// qu'ils ont à dire d'un joueur pendant un tournoi, lisible des autres admins).
///
/// Distinct des sanctions : une note est une observation, pas une décision. Elle
/// n'entraîne aucune conséquence automatique et n'est jamais montrée au joueur.
public enum PlayerNoteCategory: String, Codable, Sendable, CaseIterable {
	case behavior = "behavior"
	case cheating = "cheating"
	case noShow = "no_show"
	case scoreDispute = "score_dispute"
	case positive = "positive"
	case other = "other"
}

public struct PlayerNoteFilters: Codable, Sendable {
	public let page: Double?
	public let pageSize: Double?
	public let targetId: String?
	public let tournamentId: Double?
	public let category: PlayerNoteCategory?
	public let severity: PlayerNoteSeverity?
	public let resolved: Bool?
}

/// Filtres additionnels acceptés par la liste des notes.
public struct PlayerNoteFiltersExtra: Codable, Sendable {
	public let category: PlayerNoteCategory?
	public let severity: PlayerNoteSeverity?
	public let search: String?
}

public struct PlayerNoteListResponse: Codable, Sendable {
	public let data: [PlayerNote]
	public let total: Double
	public let meta: AnyCodable
}

public struct PlayerNotePerson: Codable, Sendable {
	public let id: String
	public let username: String
	public let displayName: String
	public let avatar: String
}

public enum PlayerNoteSeverity: String, Codable, Sendable, CaseIterable {
	case info = "info"
	case warning = "warning"
	case serious = "serious"
}

public struct PlayerNoteSummary: Codable, Sendable {
	public let total: Double
	public let open: Double
	public let bySeverity: [String: Double]
}

public struct PlayerTournamentHistoryEntry: Codable, Sendable {
	public let tournamentId: Double
	public let tournamentName: String
	public let grandFinalAt: String
	public let size: Double
	public let rank: Double?
	public let rankLabel: String
	public let points: Double
	public let tier: String
	public let goalsScored: Double
	public let goalsConceded: Double
}

/// Palier de classement nommé (bornes Elo + dégradé).
public struct Rank: Codable, Sendable {
	public let label: String
	public let minElo: Double
	public let maxElo: Double
	public let gradient: [String]
}

/// Palier de rang tel qu'exposé sur un profil (clé FR + dégradé d'affichage).
public struct RankDTO: Codable, Sendable {
	public let elo: Double
	public let key: String
	public let gradient: [String]
}

/// Un match ranked EN COURS (lobby `Ongoing`), avec son état live persisté.
public struct RankedActiveMatch: Codable, Sendable {
	public let lobbyId: Double
	public let mode: MatchMode
	public let createdAt: String
	/// Domicile (team 1).
	public let player1: RankedActivePlayer
	/// Extérieur (team 2).
	public let player2: RankedActivePlayer
}

/// Un joueur d'un match EN COURS (vue admin « Matchs en cours »).
public struct RankedActivePlayer: Codable, Sendable {
	public let userId: String
	public let displayName: String
	public let score: Double
	public let claimedOpponentScore: Double?
	public let submitted: Bool
	public let hasProof: Bool
}

public struct RankedAdminDispute: Codable, Sendable {
	public let lobbyId: Double
	public let mode: MatchMode
	public let player1: RankedDisputePlayer
	public let player2: RankedDisputePlayer
	public let createdAt: String
}

public struct RankedAdminSeason: Codable, Sendable {
	public let id: String
	public let name: String
	public let state: SeasonState
	public let startsAt: String
	public let endsAt: String
	public let config: RankedSeasonConfig
	public let playerCount: Double
}

public struct RankedAdminValidateRequest: Codable, Sendable {
	public let scoreTeam1: Double
	public let scoreTeam2: Double
	public let forfeitUserId: String?
}

public struct RankedAdminValidateResult: Codable, Sendable {
	public let ok: Bool
	public let eloDelta: Double?
}

/// `POST /ranked/challenge/:code/accept` — la réservation temps réel est opaque.
public struct RankedChallengeAccepted: Codable, Sendable {
	public let reservation: AnyCodable
	public let mode: Double
	public let ranked: Bool
}

/// Défi par lien partageable créé par le joueur courant (en attente d'acceptation).
public struct RankedChallengeLink: Codable, Sendable {
	public let code: String
	public let url: String
	public let mode: MatchMode
	public let ranked: Bool
	public let toUserId: String?
	public let expiresAt: Double
}

/// Aperçu d'un défi reçu via un lien.
public struct RankedChallengePreview: Codable, Sendable {
	public let code: String
	public let fromUserId: String
	public let fromDisplayName: String
	public let fromAvatar: String
	public let fromElo: Double
	public let mode: MatchMode
	public let ranked: Bool
	public let isOwn: Bool
	public let expiresAt: Double
}

public struct RankedChatMessage: Codable, Sendable {
	public let userId: String
	public let text: String
	public let at: Double
}

public struct RankedDisputePlayer: Codable, Sendable {
	public let userId: String
	public let displayName: String
	/// Score que CE joueur réclame pour lui-même.
	public let submittedScore: Double
	/// Score qu'il attribue à l'adversaire.
	public let claimedOpponentScore: Double?
	public let screenshotUrl: String?
}

public struct RankedDisputeRequest: Codable, Sendable {
	public let lobbyId: Double
	public let screenshotUrl: String
}

public struct RankedHistoryEntry: Codable, Sendable {
	public let lobbyId: Double
	public let mode: MatchMode
	public let state: String
	public let endedAt: String
	public let myScore: Double
	public let opponentScore: Double
	public let eloDelta: Double
	public let result: MatchResult
	public let opponent: AnyCodable
}

public struct RankedLadderResetResult: Codable, Sendable {
	public let ok: Bool
	public let affected: Double
}

/// Joueur présent dans le salon de présence ranked, pour le défi direct.
public struct RankedLobbyPlayer: Codable, Sendable {
	public let userId: String
	public let displayName: String
	public let avatar: String
	public let elo: Double
	public let mode: Double
}

/// Un événement de télémétrie ranked (journal du flow des matchs, vue staff).
public struct RankedMatchEvent: Codable, Sendable {
	public let id: Double
	public let createdAt: String
	public let lobbyId: Double?
	public let roomCode: String?
	public let mode: Double?
	public let userId: String?
	public let displayName: String?
	public let type: String
	public let detail: [String: AnyCodable]
}

public struct RankedMatchSummary: Codable, Sendable {
	public let lobbyId: Double
	public let roomCode: String
	public let mode: MatchMode
	/// `false` = partie amicale (aucun ELO appliqué).
	public let ranked: Bool?
	public let opponent: AnyCodable
	public let result: MatchResult
	public let myScore: Double
	public let opponentScore: Double
	public let eloBefore: Double
	public let eloAfter: Double
	public let eloDelta: Double
	public let newTier: RankTier?
	public let endedAt: String
}

public struct RankedModeStats: Codable, Sendable {
	public let mode: MatchMode
	public let total: Double
	public let wins: Double
	public let losses: Double
	public let draws: Double
	public let goalsScored: Double
	public let goalsReceived: Double
}

/// Compteurs synthétiques du ranked (vue admin overview).
public struct RankedOverview: Codable, Sendable {
	public let activeMatches: Double
	public let contestedMatches: Double
	public let finishedToday: Double
	public let matchesToday: Double
	public let totalPlayers: Double
}

/// Invitation reçue (on est défié par un autre joueur).
public struct RankedPendingInvite: Codable, Sendable {
	public let fromUserId: String
	public let fromDisplayName: String
	public let fromAvatar: String
	public let fromElo: Double
	public let mode: MatchMode
	/// Classé (ELO) ou non classé (amical).
	public let ranked: Bool
}

public struct RankedPlayerView: Codable, Sendable {
	public let userId: String
	public let displayName: String
	public let avatar: String
	public let elo: Double
	/// Côté terrain : 1 = domicile (1er joueur), 2 = extérieur (2e joueur). 0 = non assigné.
	public let team: Double
	/// Saisie du score (double validation), du point de vue du joueur (−1 = non saisi).
	public let myScore: Double
	public let oppScore: Double
	/// A cliqué « Début de match ».
	public let startedMatch: Bool
	/// A validé sa saisie de score.
	public let submitted: Bool
	/// A uploadé sa capture de preuve.
	public let proofUploaded: Bool
	/// A cliqué « Fin de match ».
	public let confirmedFinish: Bool
}

public struct RankedProfile: Codable, Sendable {
	public let userId: String
	public let mode: MatchMode
	public let elo: Double
	public let peakRating: Double
	public let gamesPlayed: Double
	public let wins: Double
	public let losses: Double
	public let tier: RankTier?
	public let seasonId: String?
	public let globalRank: Double?
	public let totalPlayers: Double?
	public let percentile: Double?
}

/// `POST /ranked/:lobbyId/dispute` — URL de la preuve stockée.
public struct RankedProofUploaded: Codable, Sendable {
	public let url: String
}

/// Proposition de revanche reçue en temps réel (`rematch_offer`).
public struct RankedRematchOffer: Codable, Sendable {
	public let code: String
	public let fromUserId: String
	public let fromDisplayName: String
	public let fromAvatar: String
	public let fromElo: Double
	public let mode: MatchMode
	public let ranked: Bool
	public let url: String
}

public struct RankedSeasonConfig: Codable, Sendable {
	public let kFactor: Double
	public let baseRating: Double
	public let decayRate: Double
}

public struct RankedSeasonInput: Codable, Sendable {
	public let name: String
	public let startsAt: String
	public let endsAt: String
	public let config: RankedSeasonConfig
}

/// Invitation envoyée (on a défié un joueur, en attente de sa réponse).
public struct RankedSentInvite: Codable, Sendable {
	public let targetUserId: String
	public let targetDisplayName: String
	public let mode: MatchMode
	public let ranked: Bool
}

public enum RankedState: String, Codable, Sendable, CaseIterable {
	case open = "Open"
	case locked = "Locked"
	case validatingPresence = "Validating presence"
	case pairing = "Pairing"
	case validatingMatchStart = "Validating start"
	case repooling = "Repooling"
	case matching = "Matching"
	case finished = "Finished"
	case canceled = "Canceled"
}

public struct RankedTierInfo: Codable, Sendable {
	public let key: String
	public let minElo: Double
	public let maxElo: Double
	public let gradient: [String]
	public let emojiId: String?
	public let emojiKey: String?
	public let playerCount: Double
}

public struct RankedTrend: Codable, Sendable {
	public let sparkline: [Double]
	public let deltaPeriod: Double
	public let gamesInPeriod: Double
	public let winRatePeriod: Double
	public let days: Double
}

public struct RankTier: Codable, Sendable {
	public let key: String
	public let minElo: Double
	public let maxElo: Double
	public let emojiId: String
	public let emojiKey: String
	public let gradient: [String]
}

/// `GET /auth/token` — jeton court destiné au client temps réel.
public struct RealtimeTokenResponse: Codable, Sendable {
	public let token: String
	public let expiresIn: Double
	public let userId: String
}

public struct RestoreTournamentResult: Codable, Sendable {
	public let success: Bool
	public let error: String?
	public let internalState: TournamentState?
}

/// `brackets-model#RoundRobinMode`.
public typealias RoundRobinMode = String

public struct Sanction: Codable, Sendable {
	public let id: String
	public let userId: String
	public let guildId: String
	public let type: SanctionType
	public let reason: String?
	public let durationSec: Double?
	public let issuedBy: String
	public let issuedByType: SanctionIssuerType
	public let expiresAt: String?
	public let revokedAt: String?
	public let revokedBy: String?
	public let revokeReason: String?
	public let evidence: [[String: AnyCodable]]?
	public let createdAt: String
}

public struct SanctionFilters: Codable, Sendable {
	public let page: Double?
	public let pageSize: Double?
	public let userId: String?
	public let guildId: String?
	public let type: SanctionType?
	public let active: Bool?
}

/// Origine d'une sanction (qui / quoi l'a émise).
public enum SanctionIssuerType: String, Codable, Sendable, CaseIterable {
	case user = "user"
	case bot = "bot"
	case staff = "staff"
	case system = "system"
}

public typealias SanctionListResponse = PagedList<Sanction>

/// Types de sanction de modération.
public enum SanctionType: String, Codable, Sendable, CaseIterable {
	case warn = "warn"
	case mute = "mute"
	case kick = "kick"
	case ban = "ban"
	case unmute = "unmute"
	case unban = "unban"
	case note = "note"
}

public struct ScorePolicyResult: Codable, Sendable {
	public let success: Bool
	public let scoreReportPolicy: ScoreReportPolicy
	public let error: String?
}

/// Qui saisit les scores des matchs d'un tournoi.
///
/// `PLAYERS` est le comportement historique : les deux joueurs d'un lobby remplissent
/// eux-mêmes leur score, puis le valident chacun de leur côté (ou un organisateur
/// tranche). `STAFF_ONLY` réserve saisie et validation aux organisateurs — les joueurs
/// gardent la lecture du match, sans aucun bouton.
public enum ScoreReportPolicy: String, Codable, Sendable, CaseIterable {
	case players = "players"
	case staffOnly = "staff_only"
}

public typealias SeasonState = String

public struct SeedBatchResult: Codable, Sendable {
	public let mode: String
	public let bracketUpdated: Bool
	public let assignments: [AnyCodable]?
	public let cleared: Double?
}

public struct SeedingResult: Codable, Sendable {
	public let participantId: Double
	public let seed: Double?
	public let previousSeed: Double?
	public let swappedWith: String?
	public let bracketUpdated: Bool
}

/// `brackets-model#SeedOrdering`.
public typealias SeedOrdering = String

/// Rang tel qu'embarqué dans une session ou une suggestion.
public typealias SessionRankDTO = RankDTO

/// Utilisateur de session — ce que renvoie `/auth/me`.
///
/// Même forme que `UserDTO` : l'API sert le même objet, `type` en moins. Alias
/// plutôt que type distinct, pour qu'un utilisateur de session puisse alimenter
/// n'importe quelle référence utilisateur (organisateur, manager, propriétaire).
public typealias SessionUserDTO = UserDTO

public enum SocialMedia: Int, Codable, Sendable, CaseIterable {
	case x = 0
	case instagram = 1
	case tikTok = 2
	case youtube = 3
	case twitch = 4
}

public struct SocialMediaDTO: Codable, Sendable {
	public let platform: SocialMedia
	public let username: String
	public let canonicalUrl: String
}

public typealias SortDirection = String

public struct SortQuery<TField: Codable>: Codable, Sendable {
	public let sortBy: TField?
	public let sortDir: SortDirection?
}

public enum StageType: String, Codable, Sendable, CaseIterable {
	case roundRobin = "round_robin"
	case singleElimination = "single_elimination"
	case doubleElimination = "double_elimination"
	/// Championnat type Premier League (calendrier + classement par points),
	/// distinct d'une coupe à élimination. Voir `@rosegriffon/achillea-core/league`
	/// et `docs/asytral-league.md` (référence Asytral League).
	case league = "league"
}

public struct StatsHub: Codable, Sendable {
	public let overview: AnyCodable
	public let records: AnyCodable
	public let players: [StatsHubPlayerEntry]
	public let clans: [StatsHubClanEntry]
	public let tournamentHistory: [StatsHubTournamentHistoryEntry]
	public let tournaments: [CircuitTournamentSummary]
}

public struct StatsHubClanEntry: Codable, Sendable {
	public let id: Double
	public let name: String
	public let shortName: String
	public let avatar: String
	public let points: Double
	public let players: Double
	public let tournamentsPlayed: Double
	public let wins: Double
	public let podiums: Double
	public let tier: String
	public let goalsScored: Double
	public let goalsConceded: Double
	public let goalAverage: Double
}

/// Joueur enrichi des stats matchs (buts, séries) pour le hub stats circuit.
public struct StatsHubPlayerEntry: Codable, Sendable {
	public let userId: String
	public let displayName: String
	public let username: String
	public let avatar: String
	public let clan: CircuitClanTag?
	public let tournamentsPlayed: Double
	public let points: Double
	public let tournaments: Double
	public let wins: Double
	public let podiums: Double
	public let top4: Double
	public let top8: Double
	public let bestRank: Double
	public let bestRankLabel: String
	/// Palier circuit — mêmes clés que le ranked (Fer → Légendaire).
	public let tier: String
	public let matchesPlayed: Double
	public let matchWins: Double
	public let matchLosses: Double
	public let goalsScored: Double
	public let goalsConceded: Double
	public let goalDiff: Double
	/// Buts marqués / encaissés — départage à points égaux.
	public let goalAverage: Double
	public let bestStreak: Double
}

public struct StatsHubRecord: Codable, Sendable {
	public let value: Double
	public let tournamentId: Double
	public let tournamentName: String
	public let detail: String
}

public struct StatsHubTournamentHistoryEntry: Codable, Sendable {
	public let id: Double
	public let name: String
	public let grandFinalAt: String
	public let size: Double
	public let matches: Double
	public let goals: Double
	public let champion: String?
	public let runnerUp: String?
}

/// Réponse des mutations : `{ success, error? }`.
public struct SuccessResponse: Codable, Sendable {
	public let success: Bool
	public let error: String?
}

/// Entrée d'autocomplétion globale (barre de recherche clans + joueurs).
public struct Suggestion: Codable, Sendable {
	public let id: String
	public let type: String
	public let label: String
	public let sim: Double
	public let clanShortName: String?
	public let avatar: String?
	public let soloRank: SuggestionRank
	public let duoRank: SuggestionRank
	public let lastInteract: String?
	public let role: UserRole?
	public let currentLevel: Double?
	public let totalXp: Double?
	public let hasTwitch: Bool?
	public let hasChallonge: Bool?
	public let hasYoutube: Bool?
}

/// Alias historique de `SessionRankDTO` (mêmes champs, même origine).
public typealias SuggestionRank = SessionRankDTO

public enum TeamSide: Int, Codable, Sendable, CaseIterable {
	case team1 = 1
	case team2 = 2
}

public struct Tournament: Codable, Sendable {
	public let id: Double
	public let name: String
	public let description: String
	public let type: EventTypeEnum
	public let createdAt: String
	public let updatedAt: String
	public let internalState: TournamentState
	public let startsAt: String
	public let grandFinalAt: String
	public let series: TournamentSeries?
	public let organization: OrganizationDTO
	public let managers: [UserDTO]?
	public let participants: [ParticipantDTO]?
	public let tournamentType: StageType
	public let participantsNumber: Double?
	public let seedOrdering: SeedOrdering?
	public let matchFormat: MatchFormat?
	public let customFormatChildCount: Double?
	public let groupStageEnabled: Bool
	public let groupStageType: StageType?
	public let logo: String
	public let affiche: String?
	public let planning: String
	public let ruleset: String
	/// True une fois le bonus AP podium (top 4) versé.
	/// Absent / false tant que non appliqué (tournois en cours ou formats hors scope).
	public let placementEloApplied: Bool?
	/// Planning automatisé (voir `docs/plan-tournois.md`).
	public let registrationOpensAt: String?
	public let registrationClosesAt: String?
	public let autoStart: Bool?
	public let discordRoleEnabled: Bool?
	/// Qui saisit les scores (absent sur un tournoi d'avant l'option = joueurs).
	public let scoreReportPolicy: ScoreReportPolicy?
	/// Rôle Discord attribué aux inscrits, créé à l'ouverture des inscriptions.
	public let discordRoleId: String?
	/// Renseignés quand le tournoi a été annulé (l'entité reste en base).
	public let cancelReason: String?
	public let canceledAt: String?
	/// Horodatage d'une clôture manuelle (null si passage automatique en Terminé).
	public let closedAt: String?
}

/// Réponse de `GET /tournaments/:id` — un triplet, pas un objet : c'est la
/// forme réellement servie. Le décrire tel quel évite qu'un client invente une
/// normalisation que le suivant ne ferait pas.
///
/// `[tournoi, inscrits, données brutes de brackets-manager]`.
public typealias TournamentDetail = (WireTournament, [WireParticipant], AnyCodable)

/// Enveloppe générique des mutations de tournoi.
public typealias TournamentEnvelope = ApiEnvelope<T>

public struct TournamentEventActor: Codable, Sendable {
	public let id: String
	public let username: String
	public let displayName: String
	public let avatar: String
}

public struct TournamentEventDTO: Codable, Sendable {
	public let id: String
	public let type: TournamentEventType
	public let createdAt: String
	public let actor: TournamentEventActor?
	public let target: TournamentEventActor?
	public let payload: [String: AnyCodable]?
	/// Motif (DQ, annulation) — null pour les non-organisateurs.
	public let reason: String?
}

/// Évènements journalisés d'un tournoi (table `tournament_event`).
///
/// Journal métier destiné à l'affichage — distinct d'`audit_log`, qui est un journal ops
/// signé en chaîne contenant IP et charges utiles arbitraires.
public enum TournamentEventType: String, Codable, Sendable, CaseIterable {
	case created = "created"
	case updated = "updated"
	case registrationsOpened = "registrations_opened"
	case registrationsClosed = "registrations_closed"
	case participantRegistered = "participant_registered"
	case participantWaitlisted = "participant_waitlisted"
	case participantPromoted = "participant_promoted"
	case participantUnregistered = "participant_unregistered"
	case participantRemoved = "participant_removed"
	case participantDisqualified = "participant_disqualified"
	case participantReinstated = "participant_reinstated"
	case seedingChanged = "seeding_changed"
	case bracketGenerated = "bracket_generated"
	case tournamentStarted = "tournament_started"
	case scoreReported = "score_reported"
	case scoreValidated = "score_validated"
	case phaseAdvanced = "phase_advanced"
	case organizerAdded = "organizer_added"
	case organizerRemoved = "organizer_removed"
	case tournamentClosed = "tournament_closed"
	case tournamentCanceled = "tournament_canceled"
	case tournamentRestored = "tournament_restored"
}

/// Projection compacte de la liste publique `/tournaments`.
public struct TournamentListItem: Codable, Sendable {
	public let id: Double
	public let name: String
	public let description: String
	public let type: String
	public let status: String?
	public let createdAt: String
	public let updatedAt: String
}

public struct TournamentMatchStats: Codable, Sendable {
	public let matches: Double
	public let totalGoals: Double
	public let avgGoals: Double
	public let topScore: Double
	public let minMargin: Double
	public let maxMargin: Double
	public let biggestBlowout: TournamentMatchup?
	public let closestMatch: TournamentMatchup?
}

public struct TournamentMatchup: Codable, Sendable {
	public let winnerDisplayName: String
	public let winnerAvatar: String
	public let loserDisplayName: String
	public let loserAvatar: String
	public let scoreWinner: Double
	public let scoreLoser: Double
}

public struct TournamentSeries: Codable, Sendable {
	public let id: Double
	public let name: String
	public let description: String
	public let logo: String
	public let organization: OrganizationDTO
	public let tournaments: [Tournament]
}

public enum TournamentState: String, Codable, Sendable, CaseIterable {
	case pending = "Pending"
	case preregistering = "Preregistering"
	case preparing = "Preparing"
	case ongoing = "Ongoing"
	case finished = "Finished"
	case canceled = "Canceled"
}

public struct TournamentSummary: Codable, Sendable {
	public let top10: [TournamentTop10Entry]
	public let stats: TournamentMatchStats?
}

public struct TournamentTop10Entry: Codable, Sendable {
	public let rank: Double
	public let rankLabel: String
	public let userId: String
	public let displayName: String
	public let avatar: String
	public let clan: CircuitClanTag?
	/// Points de circuit gagnés pour CE tournoi — pas le cumul all-time.
	public let points: Double
	public let tier: String
	public let goalsScored: Double
	public let goalsConceded: Double
	public let goalAverage: Double
}

/// Mise à jour partielle d'un clan (PUT /clans/:id).
public struct UpdateClanPayload: Codable, Sendable {
	public let name: String?
	public let shortenedName: String?
	public let clanBiography: String?
	public let clanAvatarUrl: String?
	public let xUrl: String?
	public let instagramUrl: String?
	public let tiktokUrl: String?
	public let isRecruiting: Bool?
	public let autoAcceptMembers: Bool?
	public let languages: [String]?
	public let origin: String?
}

/// Champs modifiables par le titulaire du profil.
public struct UpdateUserProfilePayload: Codable, Sendable {
	public let bio: String?
	public let twitchUrl: String?
}

/// `POST /proxy/upload` — image dédupliquée par hash côté API.
public struct UploadedImage: Codable, Sendable {
	public let id: String
	public let url: String
}

/// Identité affichable d'un joueur dans un rendu 2D/3D ou un classement.
public struct User: Codable, Sendable {
	public let id: String
	public let name: String
	public let rank: Rank
	public let logo: String
}

/// Appartenance de clan résumée, telle qu'embarquée dans un profil enrichi.
public struct UserClanSummary: Codable, Sendable {
	public let id: Double
	public let shortenedName: String
	public let name: String
	public let avatarUrl: String?
	public let role: ClanMemberRole
	public let distinctions: [ClanMemberDistinction]
}

public struct UserDTO: Codable, Sendable {
	public let id: String
	/// Discriminant d'entité, présent sur les fiches publiques et absent de la
	/// session : optionnel pour que `SessionUserDTO` reste assignable.
	public let type: String?
	public let username: String
	/// Canonical Rose Griffon public profile slug when the Discord account is linked.
	public let rgProfileUsername: String?
	/// Champs présents uniquement sur la session de l'utilisateur courant.
	///
	/// `GET /clans` imbrique un président réduit (identité et profil public) qui
	/// ne les porte pas. Les exiger faisait échouer la validation de la réponse
	/// ENTIÈRE, donc de tous les clans.
	public let sim: Double?
	public let avatar: String?
	/// L'API historique sérialise l'absence de clan en `null` (et non en champ
	/// absent). Les deux formes sont donc recevables dans le contrat partagé.
	public let clanId: Double?
	public let soloRank: RankDTO?
	public let duoRank: RankDTO?
	public let lastInteract: String?
	public let role: UserRole?
	public let currentLevel: Double?
	public let totalXp: Double?
	public let hasTwitch: Bool?
	public let hasChallonge: Bool?
	public let hasYoutube: Bool?
}

/// Vue minimale d'un utilisateur (avatar + libellé), suffisante pour une liste.
public struct UserRef: Codable, Sendable {
	public let id: String
	public let username: String
	public let displayName: String?
	public let avatar: String?
}

public enum UserRole: Int, Codable, Sendable, CaseIterable {
	case user = 0
	case moderator = 1
	case administrator = 2
	case superAdministrator = 3
}

public struct UsersAndGuildsResponse: Codable, Sendable {
	public let activeUsers: [DailyCountRow]
	public let users: [DailyCountRow]
	public let guilds: [DailyCountRow]
}

/// Portefeuille — un solde par utilisateur dans une devise virtuelle (ex. ACH)
/// plus un journal de mouvements.
public struct WalletBalance: Codable, Sendable {
	public let balance: Double
	public let currency: String
}

public struct WalletHistoryPage: Codable, Sendable {
	public let transactions: [WalletTransaction]
	public let total: Double?
}

/// Une ligne du journal des transactions (`GET /wallet/me/history`).
public struct WalletTransaction: Codable, Sendable {
	/// PostgreSQL UUID of the immutable transaction row.
	public let id: String
	public let type: WalletTransactionType
	public let amount: Double
	public let reason: String?
	public let direction: WalletTransactionDirection
	public let createdAt: String
}

/// Sens du mouvement vis-à-vis du solde du titulaire.
public enum WalletTransactionDirection: String, Codable, Sendable, CaseIterable {
	case `in` = "in"
	case out = "out"
}

/// Type de mouvement du portefeuille (doit matcher l'enum côté bot).
public enum WalletTransactionType: String, Codable, Sendable, CaseIterable {
	case credit = "Credit"
	case debit = "Debit"
	case transfer = "Transfer"
	case payout = "Payout"
	case fine = "Fine"
}

/// `ParticipantDTO` tel qu'il circule (le tournoi n'est souvent qu'un id).
public struct WireParticipant: Codable, Sendable {
	public let id: Double
	public let user: UserDTO
	public let bracketParticipantId: Double?
	public let seed: Double?
	public let hasCheckedIn: Bool
	/// Absent sur les réponses d'API antérieures au statut : traiter comme `ACTIVE`.
	public let status: ParticipantStatus?
	public let registeredAt: String?
	/// Rang dans la liste d'attente (1 = prochain promu).
	public let waitlistPosition: Double?
	/// Motif de DQ — renseigné uniquement pour les organisateurs.
	public let statusReason: String?
	public let tournament: EntityRef<WireTournament>
}

/// `Tournament` tel qu'il circule (relations éventuellement réduites à un id).
public struct WireTournament: Codable, Sendable {
	public let id: Double
	public let name: String
	public let description: String
	public let type: EventTypeEnum
	public let createdAt: String
	public let updatedAt: String
	public let internalState: TournamentState
	public let startsAt: String
	public let grandFinalAt: String
	public let tournamentType: StageType
	public let participantsNumber: Double?
	public let seedOrdering: SeedOrdering?
	public let matchFormat: MatchFormat?
	public let customFormatChildCount: Double?
	public let groupStageEnabled: Bool
	public let groupStageType: StageType?
	public let logo: String
	public let affiche: String?
	public let planning: String
	public let ruleset: String
	/// True une fois le bonus AP podium (top 4) versé.
	/// Absent / false tant que non appliqué (tournois en cours ou formats hors scope).
	public let placementEloApplied: Bool?
	/// Planning automatisé (voir `docs/plan-tournois.md`).
	public let registrationOpensAt: String?
	public let registrationClosesAt: String?
	public let autoStart: Bool?
	public let discordRoleEnabled: Bool?
	/// Qui saisit les scores (absent sur un tournoi d'avant l'option = joueurs).
	public let scoreReportPolicy: ScoreReportPolicy?
	/// Rôle Discord attribué aux inscrits, créé à l'ouverture des inscriptions.
	public let discordRoleId: String?
	/// Renseignés quand le tournoi a été annulé (l'entité reste en base).
	public let cancelReason: String?
	public let canceledAt: String?
	/// Horodatage d'une clôture manuelle (null si passage automatique en Terminé).
	public let closedAt: String?
	public let series: EntityRef<WireTournamentSeries>?
	public let organization: EntityRef<OrganizationDTO>
	/// Relations OPTIONNELLES sur la liste.
	///
	/// `GET /tournaments` ne les peuple pas — seul `GET /tournaments/:id` le
	/// fait. Les exiger faisait rejeter les 9 tournois de la liste et affichait
	/// « Aucun tournoi trouvé » sur une API qui en servait neuf.
	public let managers: [EntityRef<UserDTO>]?
	public let participants: [EntityRef<WireParticipant>]?
}

/// `TournamentSeries` sans sa récursion de tournois peuplés.
public struct WireTournamentSeries: Codable, Sendable {
	public let id: Double
	public let name: String
	public let description: String
	public let logo: String
	public let organization: EntityRef<OrganizationDTO>
	public let tournaments: [EntityRef<WireTournament>]?
}
