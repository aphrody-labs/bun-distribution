/**
 * Tests des domaines extraits lors de la modularisation : pagination, URL,
 * brackets, identité, portefeuille, clans, casts, stats, libellés, tonalités.
 */

import { describe, expect, test } from "bun:test";

import {
  CastAvailabilityStatus,
  CastEventStatus,
  CastSlotRole,
  ClanMemberDistinction,
  ClanMemberRole,
  ClanState,
  ParticipantStatus,
  MatchFormat,
  SanctionType,
  StageType,
  WalletTransactionDirection,
  WalletTransactionType,
  type CastAvailability,
  type ChecklistItem,
  type WalletTransaction,
} from "@rosegriffon/achillea-types";

import { buildQueryString, joinApiUrl, withQuery } from "../src/http/index";
import {
  buildPageMeta,
  clampPage,
  clampPageSize,
  hasNextPage,
  normalizePageQuery,
  pageCount,
  pageOffset,
  pageWindow,
} from "../src/pagination/index";
import {
  byeCount,
  doubleEliminationRounds,
  gamesToWin,
  isPowerOfTwo,
  matchGameCount,
  nextPowerOfTwo,
  roundLabel,
  singleEliminationRounds,
  stageMatchCount,
  standardSeedOrder,
} from "../src/brackets/index";
import {
  discordDefaultAvatarIndex,
  rankImagePath,
  rankImageSlug,
  resolveDiscordAvatarUrl,
} from "../src/identity/index";
import { canAfford, netAmount, signedAmount, totalsByType } from "../src/wallet/index";
import {
  canActOnMember,
  canDissolveClan,
  distinctionPriority,
  isClanRecruiting,
  memberDistinctionPriority,
  sortClanMembers,
  sortDistinctions,
} from "../src/clans/index";
import {
  activeParticipants,
  canTransitionParticipantStatus,
  disqualifiedCount,
  freeSeeds,
  freeSlots,
  hasFreeSlot,
  participantStatus,
  rosterParticipants,
  seedByElo,
  seededCount,
  sortBySeed,
  waitlist,
} from "../src/participants/index";
import { canTransitionCastStatus, castReadiness, rankCandidatesForRole } from "../src/casts/index";
import { downsample, longestStreak, median, tierDistribution, winRatePercent } from "../src/stats/index";
import { stageTypeLabel, sanctionTypeLabel, STAGE_TYPE_OPTIONS } from "../src/labels/index";
import { sanctionTypeTone, TONE_TO_SHADCN_BADGE } from "../src/presentation/index";
import { isTournamentOrganizer } from "../src/tournaments/organizers";

describe("pagination", () => {
  test("pageCount : une liste vide ne fait aucune page", () => {
    expect(pageCount(0, 20)).toBe(0);
    expect(pageCount(1, 20)).toBe(1);
    expect(pageCount(41, 20)).toBe(3);
  });

  test("clampPageSize borne à MAX_PAGE_SIZE et retombe sur le défaut", () => {
    expect(clampPageSize(500)).toBe(100);
    expect(clampPageSize(0)).toBe(20);
    expect(clampPageSize(undefined, 50)).toBe(50);
  });

  test("clampPage ne dépasse jamais la dernière page", () => {
    expect(clampPage(99, 41, 20)).toBe(3);
    expect(clampPage(0, 41, 20)).toBe(1);
    expect(clampPage(2, 0, 20)).toBe(1);
  });

  test("pageOffset reste cohérent même sur une page hors bornes", () => {
    expect(pageOffset(1, 20)).toBe(0);
    expect(pageOffset(3, 20)).toBe(40);
    expect(pageOffset(undefined, 20)).toBe(0);
  });

  test("buildPageMeta produit des métadonnées cohérentes", () => {
    expect(buildPageMeta(9, 20, 41)).toEqual({ page: 3, limit: 20, total: 41, pageCount: 3 });
  });

  test("hasNextPage et pageWindow", () => {
    expect(hasNextPage(1, 41, 20)).toBe(true);
    expect(hasNextPage(3, 41, 20)).toBe(false);
    expect(pageWindow(5, 20, 2)).toEqual([3, 4, 5, 6, 7]);
    expect(pageWindow(1, 3, 2)).toEqual([1, 2, 3]);
  });

  test("normalizePageQuery assainit une query string", () => {
    expect(normalizePageQuery({ page: -4, pageSize: 999 })).toEqual({
      page: 1,
      pageSize: 100,
      offset: 0,
    });
  });
});

describe("URL d'API", () => {
  test("joinApiUrl ne double jamais la frontière /api", () => {
    expect(joinApiUrl("https://x.fr/api", "/api/users")).toBe("https://x.fr/api/users");
    expect(joinApiUrl("https://x.fr/api", "/users")).toBe("https://x.fr/api/users");
    expect(joinApiUrl("", "/users")).toBe("/users");
  });

  test("joinApiUrl laisse passer une URL absolue", () => {
    expect(joinApiUrl("https://x.fr/api", "https://cdn.fr/a.png")).toBe("https://cdn.fr/a.png");
  });

  test("buildQueryString omet les valeurs vides et répète les tableaux", () => {
    expect(buildQueryString({ page: 2, q: "", tag: ["a", "b"], off: null })).toBe("?page=2&tag=a&tag=b");
    expect(buildQueryString({})).toBe("");
    expect(withQuery("/users")).toBe("/users");
    expect(withQuery("/users", { page: 1 })).toBe("/users?page=1");
  });
});

describe("brackets", () => {
  test("puissances de deux et exempts", () => {
    expect(nextPowerOfTwo(12)).toBe(16);
    expect(isPowerOfTwo(16)).toBe(true);
    expect(isPowerOfTwo(12)).toBe(false);
    expect(byeCount(12)).toBe(4);
    expect(byeCount(16)).toBe(0);
    expect(byeCount(1)).toBe(0);
  });

  test("nombre de tours par format", () => {
    expect(singleEliminationRounds(16)).toBe(4);
    expect(singleEliminationRounds(12)).toBe(4);
    expect(doubleEliminationRounds(16)).toBe(8);
    expect(singleEliminationRounds(1)).toBe(0);
  });

  test("nombre de matchs par format", () => {
    expect(stageMatchCount(StageType.single_elimination, 16)).toBe(15);
    expect(stageMatchCount(StageType.double_elimination, 16)).toBe(30);
    expect(stageMatchCount(StageType.round_robin, 8)).toBe(28);
    expect(stageMatchCount(StageType.round_robin, 8, true)).toBe(56);
  });

  test("libellé de tour", () => {
    expect(roundLabel(4, 16)).toBe("Finale");
    expect(roundLabel(3, 16)).toBe("Demi-finales");
    expect(roundLabel(1, 16)).toBe("Huitièmes de finale");
  });

  test("manches d'un match", () => {
    expect(matchGameCount(MatchFormat.BO3)).toBe(3);
    expect(matchGameCount(MatchFormat.CUSTOM, 7)).toBe(7);
    expect(gamesToWin(MatchFormat.BO5)).toBe(3);
    expect(gamesToWin(MatchFormat.DOUBLE_LEG)).toBe(2);
  });

  test("le seeding standard oppose la tête de série au dernier seed", () => {
    expect(standardSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(standardSeedOrder(2)).toEqual([1, 2]);
  });
});

describe("identité", () => {
  test("index d'avatar Discord par défaut", () => {
    expect(discordDefaultAvatarIndex("not-a-snowflake")).toBe(0);
    expect(discordDefaultAvatarIndex("123456789012345678")).toBeLessThan(6);
  });

  test("un hash d'avatar devient une URL CDN dimensionnée", () => {
    expect(resolveDiscordAvatarUrl("42", "abc123")).toBe("https://cdn.discordapp.com/avatars/42/abc123.webp?size=256");
  });

  test("un avatar animé est servi en .gif", () => {
    expect(resolveDiscordAvatarUrl("42", "a_ff00aa")).toContain(".gif");
    expect(resolveDiscordAvatarUrl("42", "https://cdn.discordapp.com/avatars/42/a_ff00aa.webp")).toContain(".gif");
  });

  test("sans avatar, on retombe sur l'embed Discord", () => {
    expect(resolveDiscordAvatarUrl("42", null)).toContain("/embed/avatars/");
  });

  test("slug d'image de rang insensible aux accents", () => {
    expect(rankImageSlug("Émeraude")).toBe("emeraude");
    expect(rankImageSlug("inconnu")).toBe("fer");
    expect(rankImagePath("Or")).toBe("ranks/or.webp");
    expect(rankImagePath("Or", "https://cdn.fr/img/")).toBe("https://cdn.fr/img/or.webp");
  });
});

describe("portefeuille", () => {
  const tx = (type: WalletTransactionType, amount: number, direction: WalletTransactionDirection) =>
    ({ id: 1, type, amount, reason: null, direction, createdAt: "" }) satisfies WalletTransaction;

  test("le montant est signé selon le sens du mouvement", () => {
    expect(signedAmount(tx(WalletTransactionType.Credit, 50, WalletTransactionDirection.In))).toBe(50);
    expect(signedAmount(tx(WalletTransactionType.Fine, 20, WalletTransactionDirection.Out))).toBe(-20);
  });

  test("netAmount somme les mouvements signés", () => {
    expect(
      netAmount([
        tx(WalletTransactionType.Credit, 50, WalletTransactionDirection.In),
        tx(WalletTransactionType.Fine, 20, WalletTransactionDirection.Out),
      ]),
    ).toBe(30);
  });

  test("canAfford refuse un montant négatif", () => {
    expect(canAfford({ balance: 100, currency: "ACH" }, 50)).toBe(true);
    expect(canAfford({ balance: 10, currency: "ACH" }, 50)).toBe(false);
    expect(canAfford({ balance: 100, currency: "ACH" }, -1)).toBe(false);
  });

  test("totalsByType ventile en valeur absolue", () => {
    const totals = totalsByType([tx(WalletTransactionType.Fine, 20, WalletTransactionDirection.Out)]);
    expect(totals[WalletTransactionType.Fine]).toBe(20);
    expect(totals[WalletTransactionType.Credit]).toBe(0);
  });
});

describe("clans", () => {
  test("les distinctions se trient Staff → Player → Artist → ContentCreator", () => {
    expect(sortDistinctions(["ContentCreator", "Staff", "Player"])).toEqual(["Staff", "Player", "ContentCreator"]);
    expect(distinctionPriority("Inconnu")).toBe(99);
  });

  test("on n'agit que sur un rôle strictement inférieur", () => {
    expect(canActOnMember(ClanMemberRole.Captain, ClanMemberRole.SubCaptain)).toBe(true);
    expect(canActOnMember(ClanMemberRole.SubCaptain, ClanMemberRole.SubCaptain)).toBe(false);
    expect(canDissolveClan(ClanMemberRole.SubCaptain)).toBe(false);
  });

  test("un clan caché ou dissous ne recrute pas", () => {
    const base = {
      state: ClanState.Approved,
      isHidden: false,
      isDisbanded: false,
      isRecruiting: true,
      isInactive: false,
    };
    expect(isClanRecruiting(base)).toBe(true);
    expect(isClanRecruiting({ ...base, isHidden: true })).toBe(false);
    expect(isClanRecruiting({ ...base, isInactive: true })).toBe(false);
    expect(isClanRecruiting({ ...base, state: ClanState.PendingReview })).toBe(false);
  });
});

describe("casts", () => {
  const slot = (role: CastSlotRole, required: boolean) => ({
    id: role,
    role,
    required,
    defraymentAmount: null,
    defraymentCurrency: null,
    defraymentReason: null,
    notes: null,
  });
  const item = (role: CastSlotRole, required: boolean, settled: boolean): ChecklistItem => ({
    slot: slot(role, required),
    attribution: null,
    casterId: settled ? "u1" : null,
    confirmed: settled,
  });

  test("une checklist incomplète n'est pas prête", () => {
    const readiness = castReadiness([
      item(CastSlotRole.CasterMain, true, true),
      item(CastSlotRole.Producer, true, false),
    ]);
    expect(readiness.ready).toBe(false);
    expect(readiness.missingEssential).toEqual([CastSlotRole.Producer]);
    expect(readiness.ratio).toBe(0.5);
  });

  test("tous les postes requis pourvus → prête", () => {
    const readiness = castReadiness([
      item(CastSlotRole.CasterMain, true, true),
      item(CastSlotRole.Producer, true, true),
      item(CastSlotRole.Observer, false, false),
    ]);
    expect(readiness.ready).toBe(true);
    expect(readiness.filled).toBe(2);
    expect(readiness.total).toBe(3);
  });

  test("les transitions de statut interdites sont refusées", () => {
    expect(canTransitionCastStatus(CastEventStatus.Planned, CastEventStatus.OpenSignup)).toBe(true);
    expect(canTransitionCastStatus(CastEventStatus.Planned, CastEventStatus.Live)).toBe(false);
    expect(canTransitionCastStatus(CastEventStatus.Done, CastEventStatus.Live)).toBe(false);
  });

  test("les candidats sont triés par disponibilité puis ancienneté", () => {
    const avail = (
      userId: string,
      status: CastAvailabilityStatus,
      declaredAt: string,
      preferredRoles: CastSlotRole[] | null = null,
    ): CastAvailability => ({ id: userId, userId, status, preferredRoles, notes: null, declaredAt });

    const ranked = rankCandidatesForRole(
      [
        avail("maybe", CastAvailabilityStatus.Maybe, "2026-01-01T00:00:00Z"),
        avail("no", CastAvailabilityStatus.Unavailable, "2026-01-01T00:00:00Z"),
        avail("late", CastAvailabilityStatus.Available, "2026-01-03T00:00:00Z"),
        avail("early", CastAvailabilityStatus.Available, "2026-01-02T00:00:00Z"),
      ],
      CastSlotRole.CasterMain,
    );
    expect(ranked.map(a => a.userId)).toEqual(["early", "late", "maybe"]);
  });

  test("un caster qui a exclu le rôle n'est pas proposé", () => {
    const ranked = rankCandidatesForRole(
      [
        {
          id: "a",
          userId: "a",
          status: CastAvailabilityStatus.Available,
          preferredRoles: [CastSlotRole.Observer],
          notes: null,
          declaredAt: "2026-01-01T00:00:00Z",
        },
      ],
      CastSlotRole.CasterMain,
    );
    expect(ranked).toEqual([]);
  });
});

describe("stats", () => {
  test("taux de victoire", () => {
    expect(winRatePercent(3, 4)).toBe(75);
    expect(winRatePercent(0, 0)).toBe(0);
    expect(winRatePercent(1, 3, 1)).toBe(33.3);
  });

  test("séries de victoires", () => {
    expect(longestStreak([true, true, false, true, true, true])).toBe(3);
    expect(longestStreak([])).toBe(0);
  });

  test("médiane et sous-échantillonnage", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(downsample([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([1, 5, 9]);
    expect(downsample([1, 2], 5)).toEqual([1, 2]);
  });

  test("distribution par palier", () => {
    const tiers = [
      { key: "Fer", minElo: 0, maxElo: 99, gradient: [] },
      { key: "Or", minElo: 100, maxElo: 199, gradient: [] },
    ];
    const buckets = tierDistribution([10, 50, 150], tiers);
    expect(buckets.map(b => b.count)).toEqual([2, 1]);
    expect(buckets[0]?.share).toBeCloseTo(2 / 3);
  });
});

describe("libellés et tonalités", () => {
  test("chaque format de tournoi a un libellé", () => {
    expect(stageTypeLabel(StageType.league)).toBe("Championnat (ligue)");
    expect(STAGE_TYPE_OPTIONS).toHaveLength(4);
    expect(STAGE_TYPE_OPTIONS.every(option => option.label.length > 0)).toBe(true);
  });

  test("la gravité d'une sanction est neutre vis-à-vis de l'UI", () => {
    expect(sanctionTypeLabel(SanctionType.Ban)).toBe("Bannissement");
    expect(sanctionTypeTone(SanctionType.Ban)).toBe("danger");
    expect(TONE_TO_SHADCN_BADGE[sanctionTypeTone(SanctionType.Ban)]).toBe("destructive");
  });
});

describe("organisateurs de tournoi", () => {
  const tournament = {
    organization: { owner: { id: "owner" }, managers: [{ user: { id: "orgmanager" } }] },
    managers: [{ id: "to" }],
  };

  test("un visiteur anonyme n'est jamais organisateur", () => {
    expect(isTournamentOrganizer(null, tournament)).toBe(false);
    expect(isTournamentOrganizer({}, { organization: { owner: {} } })).toBe(false);
  });

  test("owner, manager d'org et TO passent", () => {
    expect(isTournamentOrganizer({ id: "owner" }, tournament)).toBe(true);
    expect(isTournamentOrganizer({ id: "orgmanager" }, tournament)).toBe(true);
    expect(isTournamentOrganizer({ id: "to" }, tournament)).toBe(true);
    expect(isTournamentOrganizer({ id: "autre" }, tournament)).toBe(false);
  });

  test("le SuperAdministrator passe partout", () => {
    expect(isTournamentOrganizer({ id: "x", role: 3 }, tournament)).toBe(true);
    expect(isTournamentOrganizer({ id: "x", role: 2 }, tournament)).toBe(false);
  });
});

describe("inscrits de tournoi", () => {
  const participant = (
    username: string,
    status: ParticipantStatus | undefined,
    extra: { seed?: number | null; waitlistPosition?: number | null; elo?: number } = {},
  ) => ({
    status,
    seed: extra.seed ?? null,
    waitlistPosition: extra.waitlistPosition ?? null,
    user: { username, soloRank: { elo: extra.elo ?? 0 } },
  });

  const roster = [
    participant("actif", ParticipantStatus.ACTIVE, { seed: 2, elo: 900 }),
    participant("hérité", undefined, { elo: 1200 }),
    participant("attente-2", ParticipantStatus.WAITLISTED, { waitlistPosition: 2 }),
    participant("attente-1", ParticipantStatus.WAITLISTED, { waitlistPosition: 1 }),
    participant("dq", ParticipantStatus.DISQUALIFIED, { elo: 1500 }),
  ];

  test("un statut absent vaut ACTIVE (réponses d'API antérieures)", () => {
    expect(participantStatus({})).toBe(ParticipantStatus.ACTIVE);
    expect(activeParticipants(roster).map(p => p.user.username)).toEqual(["actif", "hérité"]);
  });

  test("le tableau montre tout sauf la liste d'attente", () => {
    expect(rosterParticipants(roster).map(p => p.user.username)).toEqual(["actif", "hérité", "dq"]);
    expect(disqualifiedCount(roster)).toBe(1);
  });

  test("la liste d'attente suit l'ordre de promotion", () => {
    expect(waitlist(roster).map(p => p.user.username)).toEqual(["attente-1", "attente-2"]);
  });

  test("la capacité ne compte que les actifs", () => {
    expect(hasFreeSlot(roster, 2)).toBe(false);
    expect(hasFreeSlot(roster, 3)).toBe(true);
    expect(freeSlots(roster, 1)).toBe(0);
    expect(freeSlots(roster, 5)).toBe(3);
  });

  test("le tri par seed met les non-seedés en bas", () => {
    expect(sortBySeed(roster).map(p => p.user.username)).toEqual(["actif", "attente-1", "attente-2", "dq", "hérité"]);
    expect(seededCount(roster)).toBe(1);
    expect(freeSeeds(roster, 4)).toEqual([1, 3, 4]);
  });

  test("le seeding par Elo classe le mieux noté premier", () => {
    expect(seedByElo(activeParticipants(roster)).map(s => s.participant.user.username)).toEqual(["hérité", "actif"]);
  });

  test("une disqualification est réversible, pas définitive", () => {
    expect(canTransitionParticipantStatus(ParticipantStatus.DISQUALIFIED, ParticipantStatus.ACTIVE)).toBe(true);
    expect(canTransitionParticipantStatus(ParticipantStatus.ACTIVE, ParticipantStatus.ACTIVE)).toBe(false);
  });
});

describe("distinctions de clan", () => {
  test("la priorité suit la valeur d'enum réellement stockée", () => {
    expect(distinctionPriority(ClanMemberDistinction.Staff)).toBe(1);
    expect(distinctionPriority(ClanMemberDistinction.Player)).toBe(2);
    expect(distinctionPriority(ClanMemberDistinction.ContentCreator)).toBe(4);
  });

  test("les clés anglaises historiques restent reconnues", () => {
    // Régression : le front envoyait « Content Creator » avec un espace,
    // clé absente de l'ancienne table — les créateurs tombaient en dernier.
    expect(distinctionPriority("ContentCreator")).toBe(4);
    expect(distinctionPriority("Content Creator")).toBe(4);
    expect(distinctionPriority("Inconnu")).toBe(99);
  });

  test("un membre est classé par sa distinction la plus haute", () => {
    expect(memberDistinctionPriority([ClanMemberDistinction.ContentCreator, ClanMemberDistinction.Staff])).toBe(1);
    expect(memberDistinctionPriority([])).toBe(99);
  });

  test("le tri des membres départage rôle, puis distinction, puis renommée", () => {
    const member = (username: string, clanRole: ClanMemberRole, distinctions: string[], clanFameContributed = 0) =>
      ({
        clanRole,
        distinctions,
        clanFameContributed,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        user: { username },
      }) as unknown as Parameters<typeof sortClanMembers>[0][number];

    const sorted = sortClanMembers([
      member("membre-createur", ClanMemberRole.Member, [ClanMemberDistinction.ContentCreator]),
      member("president", ClanMemberRole.Captain, []),
      member("membre-staff", ClanMemberRole.Member, [ClanMemberDistinction.Staff]),
      member("membre-joueur-riche", ClanMemberRole.Member, [ClanMemberDistinction.Player], 500),
    ]);

    expect(sorted.map(m => m.user.username)).toEqual([
      "president",
      "membre-staff",
      "membre-joueur-riche",
      "membre-createur",
    ]);
  });
});
