/**
 * `AchilleaClient` — agrégat de ressources au-dessus du transport `AchilleaHttp`.
 *
 * Aucune méthode ne lève : tout appel rend un `AchilleaClientResult<T>` que
 * l'appelant discrimine sur `ok`. Le client est isomorphe (RSC Next.js,
 * navigateur, Bun) et ne dépend d'aucun framework.
 */

import { AdminResource } from "./admin";
import { AuthResource } from "./auth";
import { CastsResource } from "./casts";
import { ClansResource } from "./clans";
import { GuildsResource } from "./guilds";
import { AchilleaHttp, type AchilleaClientOptions, type AchilleaFetch } from "./http";
import { LeaguesResource } from "./leagues";
import { LicensesResource } from "./licenses";
import { NotificationsResource } from "./notifications";
import { OrganizationsResource } from "./organizations";
import { PlayerNotesResource } from "./player-notes";
import { RankedResource } from "./ranked";
import { SanctionsResource } from "./sanctions";
import { StatsResource } from "./stats";
import { TournamentsResource } from "./tournaments";
import { UsersResource } from "./users";
import { WalletResource } from "./wallet";

export class AchilleaClient {
  readonly http: AchilleaHttp;

  readonly admin: AdminResource;
  readonly auth: AuthResource;
  readonly casts: CastsResource;
  readonly clans: ClansResource;
  readonly guilds: GuildsResource;
  readonly leagues: LeaguesResource;
  readonly licenses: LicensesResource;
  readonly notifications: NotificationsResource;
  readonly organizations: OrganizationsResource;
  readonly playerNotes: PlayerNotesResource;
  readonly ranked: RankedResource;
  readonly sanctions: SanctionsResource;
  readonly stats: StatsResource;
  readonly tournaments: TournamentsResource;
  readonly users: UsersResource;
  readonly wallet: WalletResource;

  constructor(options: AchilleaClientOptions = {}) {
    this.http = new AchilleaHttp(options);

    this.admin = new AdminResource(this.http);
    this.auth = new AuthResource(this.http);
    this.casts = new CastsResource(this.http);
    this.clans = new ClansResource(this.http);
    this.guilds = new GuildsResource(this.http);
    this.leagues = new LeaguesResource(this.http);
    this.licenses = new LicensesResource(this.http);
    this.notifications = new NotificationsResource(this.http);
    this.organizations = new OrganizationsResource(this.http);
    this.playerNotes = new PlayerNotesResource(this.http);
    this.ranked = new RankedResource(this.http);
    this.sanctions = new SanctionsResource(this.http);
    this.stats = new StatsResource(this.http);
    this.tournaments = new TournamentsResource(this.http);
    this.users = new UsersResource(this.http);
    this.wallet = new WalletResource(this.http);
  }

  /** Origine de l'API, préfixe de chemin inclus. */
  get baseUrl(): string {
    return this.http.baseUrl;
  }

  /** Délai d'abandon par défaut, en millisecondes. */
  get timeoutMs(): number {
    return this.http.timeoutMs;
  }

  /** Implémentation de Fetch effectivement utilisée. */
  get fetch(): AchilleaFetch {
    return this.http.fetch;
  }
}

export function createAchilleaClient(options: AchilleaClientOptions = {}): AchilleaClient {
  return new AchilleaClient(options);
}
