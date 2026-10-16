import { Elysia } from "elysia";
import { dbPlugin } from "../../plugins/db";
import { ContentModel } from "./model";
import { ContentService } from "./service";

export const contentController = new Elysia({ prefix: "/content" })
	.use(dbPlugin)
	.get("/news/feed", async ({ db, query }) => {
		return await ContentService.getNewsFeed(db, query.page, query.category, query.q);
	}, {
		query: ContentModel.feedQuery,
		response: { 200: ContentModel.feedResponse }
	})
	.get("/calendar-events", async ({ db }) => {
		return await ContentService.getCalendarEvents(db);
	}, {
		response: { 200: ContentModel.calendarResponse }
	});
