import { AZALEE_ARTICLES, type ArticlePageProps, generateArticleMetadata, renderArticlePage } from "./article-page";

export const dynamic = "force-dynamic";

export function generateMetadata(props: ArticlePageProps) {
  return generateArticleMetadata(props, AZALEE_ARTICLES);
}

export default function ArticlePage(props: ArticlePageProps) {
  return renderArticlePage(props, AZALEE_ARTICLES);
}
