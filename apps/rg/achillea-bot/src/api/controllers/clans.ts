// src/controllers/ClansController.ts

import {
	BodyParams,
	Context,
	Controller,
	Get,
	Patch,
	PathParams,
	Post,
	QueryParams,
	Req,
	Res,
	UseBefore,
} from "@tsed/common";
import { BadRequest, Forbidden, Unauthorized } from "@tsed/exceptions";
import { Default, Default as DefaultValue, Maximum, Minimum } from "@tsed/schema";
import type { Request, Response } from "express";

import { CookieAuthorize, NotInClan } from "@/api/middlewares";
import type {
	ClanApplicationDTO,
	ClanDTO,
	ClanInviteDTO,
	ClanMemberDTO,
	NewClanDTO,
	UpdateClanDTO,
} from "@/api/models/dtos";
import type { Paginated } from "@/api/models/interfaces";
import { coreManagerConfig, urlsConfig } from "@/configs";
import type { UserDTO } from "@/services";
import {
	ClanPosterService,
	ClanService,
	CustomImagesUpload,
	UserService,
} from "@/services";
import { BaseController } from "@/utils/classes";
import {
	ClanCreationErrors,
	ClanMemberDistinction,
	ClanMemberRole,
	ClanState,
	isClanCreationError,
	UserRole,
} from "@/utils/enums";
import {
	getClanMemberLimits,
	normalizeClanMemberLimits,
	setClanMemberLimits,
} from "@/utils/functions/clanLimits";
import { resolveDependenciesSync } from "@/utils/functions";

import { createClanSpecificChannel } from "../../utils/functions/channel";

@Controller("/clans")
export class ClansController extends BaseController {
	private clanService: ClanService;
	private userService: UserService;
	private imageService: CustomImagesUpload;
	private posterService: ClanPosterService;

	constructor() {
		super();

		[this.clanService, this.userService, this.imageService, this.posterService] =
			resolveDependenciesSync([
				ClanService,
				UserService,
				CustomImagesUpload,
				ClanPosterService,
			]);
	}

	private async assertAdmin(ctx: Context): Promise<void> {
		const u = ctx.get("user") as UserDTO | undefined;
		if (!u || (u.role ?? 0) < UserRole.Administrator) {
			throw new Forbidden("Réservé aux administrateurs");
		}
	}

	/**
	 * Membres: projection canonique détenue par l'API unifiée.
	 *
	 * Les mutations Discord ci-dessous restent dans ce contrôleur, mais leur
	 * réponse ne relit plus MikroORM (et ses vues/rangs historiques). Cela
	 * garantit que l'état renvoyé après une action est le même que celui servi
	 * au site et aux autres clients.
	 */
	private async fetchUnifiedMembers(clanId: number, req: Request): Promise<ClanMemberDTO[]> {
		const headers: Record<string, string> = { accept: "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		const upstream = await fetch(new URL(`/v1/achillea/clans/${clanId}/members`, urlsConfig.unifiedApi), { headers });
		if (!upstream.ok) {
			throw new BadRequest("Impossible de relire les membres depuis l'API unifiée.");
		}
		return await upstream.json() as ClanMemberDTO[];
	}

	private async proxyUnifiedClanRead(path: "/invites" | "/applications", req: Request, res: Response): Promise<Response> {
		const headers: Record<string, string> = { accept: "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		const upstream = await fetch(new URL(`/v1/achillea/clans${path}`, urlsConfig.unifiedApi), { headers });
		return res.status(upstream.status || 503).json(
			await upstream.json().catch(() => ({ message: "Unified API unavailable" }))
		);
	}

	@Get("/")
	async getClans(
		@Res() res: Response,
		@QueryParams("page")
		@DefaultValue(1)
		@Minimum(1)
		page: number,

		@QueryParams("pagination")
		@DefaultValue(25)
		@Minimum(1)
		@Maximum(50)
		pagination: number,

		@QueryParams("state")
		@Default(ClanState.Approved)
		state: ClanState
	): Promise<any> {
		const upstreamUrl = new URL("/v1/achillea/clans", urlsConfig.unifiedApi);
		upstreamUrl.searchParams.set("page", String(page ?? 1));
		upstreamUrl.searchParams.set("pageSize", String(pagination ?? 25));
		if (state !== undefined) upstreamUrl.searchParams.set("state", String(state));
		const upstream = await fetch(upstreamUrl);
		if (upstream.ok) {
			const payload = await upstream.json() as { data?: unknown[]; count?: number };
			const total = payload.count ?? payload.data?.length ?? 0;
			res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
			return res.json({ data: payload.data ?? [], meta: { page: page ?? 1, limit: pagination ?? 25, total, pageCount: Math.ceil(total / (pagination ?? 25)) } });
		}
		// Les lectures publiques ne doivent plus retomber sur MikroORM dans le bot :
		// une panne de l'API unifiée doit être visible et surveillable, pas produire
		// deux projections divergentes de la même table.
		return res.status(upstream.status || 503).json(
			await upstream.json().catch(() => ({ message: "Unified API unavailable" }))
		);
	}

	@Get("/member-limits")
	async getMemberLimits(@Res() res: Response) {
		const limits = await getClanMemberLimits();
		res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
		return res.status(200).json(limits);
	}

	@Patch("/member-limits")
	@UseBefore(CookieAuthorize)
	async updateMemberLimits(
		@Context() ctx: Context,
		@BodyParams("playerLimit") playerLimit: number,
		@BodyParams("staffLimit") staffLimit: number,
		@Res() res: Response
	) {
		await this.assertAdmin(ctx);
		const limits = await setClanMemberLimits(normalizeClanMemberLimits({ playerLimit, staffLimit }));
		return res.status(200).json(limits);
	}

	@Get("/:id/members")
	async getClanMembers(
		@PathParams("id") id: number,
		@Res() res: Response
	): Promise<any> {
		const upstream = await fetch(new URL(`/v1/achillea/clans/${id}/members`, urlsConfig.unifiedApi));
		res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
		return res.status(upstream.status || 503).json(await upstream.json().catch(() => ({ message: "Unified API unavailable" })));
	}

	@Post("/create")
	@UseBefore(CookieAuthorize, NotInClan)
	async submitForm(@BodyParams() dto: NewClanDTO, @Res() res: Response, @Context() ctx: Context) {
		// You can validate/process/store the form here
		let founders: any[];
		try {
			founders = await Promise.all(
				dto.founders.map((founder) => this.userService.getDiscordUser(founder.id))
			);
		} catch (error) {
			return res.status(400).json({
				error: ClanCreationErrors.DISCORD_USER_FETCH_ERROR,
				code: "DISCORD_USER_FETCH_ERROR",
			});
		}

		const president = ctx.get("user") as UserDTO;
		const fullFounders = [president, ...founders];
		const validFounders = await this.clanService.validateFounders(fullFounders);
		if (isClanCreationError(validFounders)) {
			return res.status(400).json({
				error: validFounders,
				code: "FOUNDERS",
			});
		}

		const validName = await this.clanService.validateName(dto.name);
		if (isClanCreationError(validName)) {
			return res.status(400).json({
				error: validName,
				code: "NAME",
			});
		}

		const validShortName = await this.clanService.validateShortName(dto.shortName);
		if (isClanCreationError(validShortName)) {
			return res.status(400).json({
				error: validShortName,
				code: "SHORT_NAME",
			});
		}

		const socials = [dto.twitter, dto.instagram, dto.tiktok].filter(
			(value) => value && value.trim() !== ""
		) as string[];
		if (socials.length === 0) {
			return res.status(400).json({
				error: ClanCreationErrors.INVALID_SOCIALS,
				code: "SOCIALS",
			});
		}

		const validatedSocials = await this.clanService.validateSocials(socials);
		if (validatedSocials.length === 0) {
			return res.status(400).json({
				error: ClanCreationErrors.INVALID_SOCIALS,
				code: "SOCIALS",
			});
		}

		const achillea = await this.clanService.getAchillea();

		let foundersAsMembers: any[];
		try {
			foundersAsMembers = await Promise.all(
				dto.founders.map((founder) => this.userService.getUserAsGuildMember(achillea, founder.id))
			);
		} catch (error) {
			return res.status(400).json({
				error: ClanCreationErrors.DISCORD_USER_FETCH_ERROR,
				code: "DISCORD_USER_FETCH_ERROR",
			});
		}

		try {
			const newRole = await this.clanService.createAndSetupClanRole(
				dto.normalizedName,
				president.id,
				foundersAsMembers
			);
			const clanChannel = await createClanSpecificChannel(
				achillea,
				coreManagerConfig.clanCategoryId,
				dto.normalizedName,
				newRole.id,
				president.id
			);

			const { buffer, mimeType } = await this.imageService.fetchImageAsBuffer(dto.logo);
			const { url, emojiId } = await this.imageService.uploadAsEmoji(
				buffer,
				mimeType,
				dto.normalizedShortName,
				dto.logo
			);

			const foundersIds = founders.map((founder) => founder.id);
			const fullFoundersIds = fullFounders.map((founder) => founder.id);
			const success = await this.clanService.createClan(
				dto,
				fullFoundersIds,
				validatedSocials,
				clanChannel.id,
				newRole.id,
				emojiId,
				president.id
			);
			if (!success.success) {
				console.warn("Clan creation returned false:", success.error);

				return res.status(409).json({
					error: `Erreur critique, veuillez remonter le message d'erreur au développeur: ${success.error}`,
					code: "CLAN_CREATION_FAIL",
				});
			}

			await this.clanService.initFoundingVoteProcedure(foundersIds, success.clan!, president);

			return res.status(200).json({ success: true, clanId: success.clan!.id });
		} catch (err: any) {
			console.error("CLAN CREATION FAILED:", err.message, err.code, err.stack);
			try {
				const clanThatFailed = await this.clanService.getNewlyCreatedClanIfExists(
					dto,
					president.id
				);
				if (clanThatFailed) await this.clanService.tryDisbandingNewCreatedClan(clanThatFailed);
			} catch (e: any) {
				console.error("Cleanup also failed:", e.message);
			}

			return res.status(409).json({
				error: `Erreur critique, veuillez remonter le message d'erreur au développeur: ${err.message || err}`,
				code: "CLAN_CREATION_FAIL",
			});
		}
	}

	@Post("/kick/:id")
	@UseBefore(CookieAuthorize)
	async kickMember(
		@PathParams("id") id: string,
		@BodyParams("reason") reason: string,
		@Context() ctx: Context,
		@Req() req: Request,
		@Res() res: Response
	) {
		const executor = ctx.get("user");

		const verification = await this.clanService.verifyClanMemberManagementPermissions(executor, id);
		if (!verification.success) {
			return res.status(verification.status!).json({
				success: false,
				error: verification.error,
			});
		}

		const { executorAsMember, targetAsMember } = verification;

		if (executorAsMember!.user.id === id) {
			return res.status(400).json({
				success: false,
				error: "Vous ne pouvez pas vous exclure vous-même",
			});
		}

		try {
			if (!reason || reason.trim().length < 3) {
				return res.status(400).json({
					success: false,
					error: "Veuillez fournir une raison valide (au moins 3 caractères).",
				});
			}

			await this.clanService.kickMember(targetAsMember!, reason.trim(), executor);

			const updatedMembers = await this.fetchUnifiedMembers(executorAsMember!.clan.id, req);

			return res.status(200).json({
				success: true,
				members: updatedMembers,
			});
		} catch (error: any) {
			console.error("Error kicking member:", error);

			return res.status(400).json({
				success: false,
				error: error.message ?? "Erreur inconnue.",
			});
		}
	}

	@Get("/role")
	@UseBefore(CookieAuthorize)
	async getUserClanRole(@Context() ctx: Context, @Res() res: Response) {
		const user = ctx.get("user");

		if (!user) throw new Unauthorized("Not authenticated");

		const clanMember = await this.clanService.getMember(user.id);
		if (!clanMember) {
			return res.status(200).json({ role: -1 });
		}

		return res.status(200).json({ role: clanMember.role });
	}

	@Post("/updateMember")
	@UseBefore(CookieAuthorize)
	async updateMember(
		@BodyParams() member: ClanMemberDTO,
		@Context() ctx: Context,
		@Req() req: Request,
		@Res() res: Response
	) {
		const executor = ctx.get("user");

		const verification = await this.clanService.verifyClanMemberManagementPermissions(
			executor,
			member.user.id
		);
		if (!verification.success) {
			return res.status(verification.status!).json({
				success: false,
				error: verification.error,
			});
		}

		const { executorAsMember, targetAsMember } = verification;

		try {
			// // ✅ 2. Validate inputs
			const validRoles = Object.values(ClanMemberRole);
			if (!validRoles.includes(member.clanRole)) {
				return res.status(400).json({
					success: false,
					error: "Rôle invalide.",
				});
			}
			const validDistinctions = Object.values(ClanMemberDistinction);
			member.distinctions.forEach((distinction) => {
				if (!validDistinctions.includes(distinction as ClanMemberDistinction)) {
					return res.status(400).json({
						success: false,
						error: "Distinction invalide.",
					});
				}
			});

			// ✅ 3. Update member in DB
			await this.clanService.UpdateMemberRolesAndDistinctions(
				member.clanRole,
				member.distinctions as ClanMemberDistinction[],
				targetAsMember!
			);

			// // ✅ 4. Fetch updated members list
			const updatedMembers = await this.fetchUnifiedMembers(executorAsMember!.clan.id, req);

			return res.status(200).json({
				success: true,
				members: updatedMembers,
			});
		} catch (err: any) {
			console.error("Error updating clan member:", err);

			return res.status(500).json({
				success: false,
				error: "Erreur interne lors de la mise à jour du membre.",
			});
		}
	}

	@Post("/invites/create")
	@UseBefore(CookieAuthorize)
	async createInvite(
		@BodyParams("userId") targetUserId: string,
		@BodyParams("distinctions") distinctions: ClanMemberDistinction[],
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const executor = ctx.get("user");
		if (!executor) {
			return res.status(401).json({
				success: false,
				error: "Non authentifié.",
			});
		}

		try {
			// 1. Executor must be in a clan
			const executorAsMember = await this.clanService.getMember(executor.id);
			if (!executorAsMember) {
				throw new BadRequest("Vous ne faites pas partie d'un Clan.");
			}

			// 2. Role check (SubCaptain or Captain)
			if (executorAsMember.role < ClanMemberRole.SubCaptain) {
				throw new Unauthorized("Vous n'avez pas les droits pour effectuer cette action");
			}

			// 3. Validate distinctions array
			if (!Array.isArray(distinctions)) {
				throw new BadRequest("Les distinctions fournies sont invalides.");
			}

			// 4. Create invite
			await this.clanService.inviteUser(
				targetUserId,
				executorAsMember.clan.id,
				distinctions,
				executor
			);

			return res.status(200).json({ success: true });
		} catch (error: any) {
			console.error("Erreur lors de la création de l’invitation :", error);

			return res.status(error.status || 400).json({
				success: false,
				error: error.message || "Impossible de créer cette invitation.",
			});
		}
	}

	@Post("/invites/revoke")
	@UseBefore(CookieAuthorize)
	async revokeInvite(
		@BodyParams() invite: ClanInviteDTO,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const executor = ctx.get("user");
		if (!executor) {
			return res.status(401).json({ success: false, error: "Non authentifié." });
		}
		try {
			const executorAsMember = await this.clanService.getMember(executor.id);
			if (!executorAsMember) {
				throw new BadRequest("Vous ne faites pas partie d'un Clan.");
			}
			if (executorAsMember.role < ClanMemberRole.SubCaptain) {
				throw new Unauthorized("Vous n'avez pas les droits pour effectuer cette action");
			}
			if (
				executorAsMember.user.id !== invite.inviter.user.id &&
				executorAsMember.role <= invite.inviter.clanRole &&
				executorAsMember.role !== ClanMemberRole.Captain
			) {
				throw new Unauthorized("Vous n'avez pas les droits pour effectuer cette action");
			}

			await this.clanService.revokeInvite(invite);

			return res.status(200).json({ success: true });
		} catch (error: any) {
			console.error("Erreur lors de la révocation de l’invitation :", error);

			return res.status(error.status || 400).json({
				success: false,
				error: error.message || "Impossible de révoquer cette invitation.",
			});
		}
	}

	@Post("/invites/notify")
	@UseBefore(CookieAuthorize)
	async notifyInvite(
		@BodyParams() invite: ClanInviteDTO,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const executor = ctx.get("user");
		if (!executor) {
			return res.status(401).json({ success: false, error: "Non authentifié." });
		}

		try {
			// Vérifier que l’exécuteur est membre d’un clan
			const executorAsMember = await this.clanService.getMember(executor.id);
			if (!executorAsMember) {
				throw new BadRequest("Vous ne faites pas partie d'un Clan.");
			}
			// Vérifier permissions (même logique que revoke)
			if (executorAsMember.role < ClanMemberRole.SubCaptain) {
				throw new Unauthorized("Vous n'avez pas les droits pour effectuer cette action");
			}

			// Notifier via Discord / logger
			await this.clanService.sendInviteNotification(invite);

			return res.status(200).json({ success: true });
		} catch (error: any) {
			console.error("Erreur lors de la notification :", error);

			return res.status(error.status || 400).json({
				success: false,
				error: error.message || "Impossible de notifier cette invitation.",
			});
		}
	}

	@Get("/invites")
	@UseBefore(CookieAuthorize)
	async getClanInvites(@Req() req: Request, @Res() res: Response): Promise<any> {
		return this.proxyUnifiedClanRead("/invites", req, res);
	}

	@Post("/applications/create")
	@UseBefore(CookieAuthorize)
	async createApplication(
		@BodyParams("clanId") targetClanId: number,
		@BodyParams("distinctions") distinctions: ClanMemberDistinction[],
		@Req() req: Request,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const executor = ctx.get("user");
		if (!executor) {
			return res.status(401).json({
				success: false,
				error: "Non authentifié.",
			});
		}

		try {
			// 1. Executor must not already be in an ACTIVE clan (une adhésion à un
			// Clan inactif ne bloque pas — transfert/prêt implicite).
				const headers: Record<string, string> = { accept: "application/json" };
				if (req.headers.cookie) headers.cookie = req.headers.cookie;
				if (req.headers.authorization) headers.authorization = req.headers.authorization;
				const membership = await fetch(new URL("/v1/achillea/clans/me", urlsConfig.unifiedApi), { headers });
				if (!membership.ok) throw new BadRequest("Impossible de vérifier votre adhésion au Clan.");
				const membershipBody = await membership.json() as { clanId?: number | null };
				if (membershipBody.clanId != null) {
					throw new BadRequest("Vous faites déjà partie d'un Clan.");
				}

			// 3. Validate distinctions array
			if (!Array.isArray(distinctions)) {
				throw new BadRequest("Les distinctions fournies sont invalides.");
			}

			// 4. Create application
			const autojoin = await this.clanService.applyToClan(executor.id, targetClanId, distinctions);

			return res.status(200).json({ success: true, autojoin });
		} catch (error: any) {
			console.error("Erreur lors de la création de la candidature :", error);

			return res.status(error.status || 400).json({
				success: false,
				error: error.message || "Impossible de créer cette candidature.",
			});
		}
	}

	@Post("/applications/reject")
	@UseBefore(CookieAuthorize)
	async rejectApplication(
		@BodyParams() applicationDTO: ClanApplicationDTO,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const executor = ctx.get("user");
		if (!executor) {
			return res.status(401).json({ success: false, error: "Non authentifié." });
		}
		try {
			const executorAsMember = await this.clanService.getMember(executor.id);
			if (!executorAsMember) {
				throw new BadRequest("Vous ne faites pas partie d'un Clan.");
			}
			if (executorAsMember.role < ClanMemberRole.SubCaptain) {
				throw new Unauthorized("Vous n'avez pas les droits pour effectuer cette action");
			}

			await this.clanService.rejectApplication(applicationDTO.id, executorAsMember);

			return res.status(200).json({ success: true });
		} catch (error: any) {
			console.error("Erreur lors du rejet de la candidature :", error);

			return res.status(error.status || 400).json({
				success: false,
				error: error.message || "Impossible de rejeter cette candidature.",
			});
		}
	}

	@Post("/applications/accept")
	@UseBefore(CookieAuthorize)
	async acceptApplication(
		@BodyParams() applicationDTO: ClanApplicationDTO,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const executor = ctx.get("user");
		if (!executor) {
			return res.status(401).json({ success: false, error: "Non authentifié." });
		}
		try {
			const executorAsMember = await this.clanService.getMember(executor.id);
			if (!executorAsMember) {
				throw new BadRequest("Vous ne faites pas partie d'un Clan.");
			}
			if (executorAsMember.role < ClanMemberRole.SubCaptain) {
				throw new Unauthorized("Vous n'avez pas les droits pour effectuer cette action");
			}

			await this.clanService.acceptApplication(applicationDTO.id, executorAsMember);

			return res.status(200).json({ success: true });
		} catch (error: any) {
			console.error("Erreur lors de l'acceptation de la candidature :", error);

			return res.status(error.status || 400).json({
				success: false,
				error: error.message || "Impossible d'accepter cette candidature.",
			});
		}
	}

	@Get("/applications")
	@UseBefore(CookieAuthorize)
	async getClanApplications(@Req() req: Request, @Res() res: Response): Promise<any> {
		return this.proxyUnifiedClanRead("/applications", req, res);
	}

	@Patch("/:id")
	@UseBefore(CookieAuthorize)
	async updateClanInfo(
		@PathParams("id") id: number,
		@BodyParams() patch: UpdateClanDTO,
		@Req() req: Request,
		@Res() res: Response
	) {
		const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
		if (req.headers.cookie) headers.cookie = req.headers.cookie;
		if (req.headers.authorization) headers.authorization = req.headers.authorization;
		const upstream = await fetch(new URL(`/v1/achillea/clans/${id}`, urlsConfig.unifiedApi), {
			method: "PATCH", headers, body: JSON.stringify(patch),
		});
		const payload = await upstream.json().catch(() => ({ message: "Unified API unavailable" })) as {
			success?: boolean; previousName?: string; roleId?: string; clan?: { name: string }; message?: string; error?: string;
		};
		if (upstream.ok && payload.previousName && payload.roleId && payload.clan?.name && payload.previousName !== payload.clan.name) {
			await this.clanService.renameClanRole(payload.roleId, id, payload.clan.name);
		}
		return res.status(upstream.status || 503).json(payload);
	}

	@Get("/:id")
	async getClanById(@PathParams("id") id: number, @Res() res: Response): Promise<any> {
		const upstream = await fetch(new URL(`/v1/achillea/clans/${id}`, urlsConfig.unifiedApi));
		res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
		return res.status(upstream.status || 503).json(
			await upstream.json().catch(() => ({ message: "Unified API unavailable" }))
		);
	}

	@Get("/:id/poster.png")
	async getClanPoster(@PathParams("id") id: number, @Res() res: Response) {
		try {
			const buf = await this.posterService.generatePoster(id);
			res.setHeader("Content-Type", "image/png");
			res.setHeader("Content-Length", buf.length);
			res.setHeader("Cache-Control", "public, max-age=300");
			res.setHeader("Content-Disposition", `inline; filename="clan-${id}-poster.png"`);

			return res.status(200).send(buf);
		} catch (err: any) {
			if (err?.status === 404) throw err;

			throw new BadRequest(err?.message ?? "Erreur lors de la génération de l'affiche");
		}
	}

	@Post("/:id/poster/regenerate")
	@UseBefore(CookieAuthorize)
	async regenerateClanPoster(
		@PathParams("id") id: number,
		@Context() ctx: Context,
		@Res() res: Response
	) {
		const executor = ctx.get("user");
		if (!executor) throw new Unauthorized("Non authentifié");

		try {
			const path = await this.posterService.generateAndSave(id);

			return res.status(200).json({ success: true, path });
		} catch (err: any) {
			if (err?.status === 404) throw err;

			return res
				.status(400)
				.json({ success: false, error: err?.message ?? "Génération impossible" });
		}
	}
}
