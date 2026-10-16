import { Elysia, t } from "elysia";
import { dbPlugin } from "../../plugins/db";
import { CommunityModel } from "./model";
import { CommunityService } from "./service";

export const communityController = new Elysia({ prefix: "/community" })
	.use(dbPlugin)
	.get("/info", () => {
		return CommunityService.getInfo();
	}, {
		response: { 200: CommunityModel.infoResponse }
	})
	.get("/emotes", () => {
		return CommunityService.getEmotes();
	}, {
		response: { 200: CommunityModel.emotesResponse }
	})
	.get("/tags/popular", async ({ db, query }) => {
		const limit = query.limit ?? 15;
		return await CommunityService.getPopularTags(db, limit);
	}, {
		query: t.Object({
			limit: t.Optional(t.Numeric({ default: 15 }))
		}),
		response: { 200: CommunityModel.tagsResponse }
	});
