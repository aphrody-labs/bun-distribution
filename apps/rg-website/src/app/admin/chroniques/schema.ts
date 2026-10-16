import { articleSchema } from "@rosegriffon/types/schemas";
import type { ArticleInput as SharedArticleInput } from "@rosegriffon/types/schemas";

export const ArticleSchema = articleSchema;
export type ArticleInput = SharedArticleInput;
