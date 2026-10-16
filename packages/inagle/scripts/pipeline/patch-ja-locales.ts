import path from "node:path";

const jaPath = path.join(process.cwd(), "public/locales/ja.json");

const jaNavKeys = {
  "nav.home": "ホーム",
  "nav.news": "ニュース",
  "nav.news.articles": "記事",
  "nav.news.topics": "トピック",
  "nav.news.patch_notes": "パッチノート",
  "nav.wiki": "Wiki",
  "nav.wiki.players": "選手名鑑", // Player Directory
  "nav.wiki.skills": "必殺技",
  "nav.wiki.hyper_skills": "超次元技",
  "nav.wiki.auras.keshin": "化身",
  "nav.wiki.auras.soul": "ソウル",
  "nav.wiki.auras.miximax": "ミキシマックス",
  "nav.wiki.auras.awakening": "覚醒",
  "nav.wiki.auras.mode": "モードチェンジ",
  "nav.wiki.items": "アイテム",
  "nav.wiki.passives": "パッシブスキル",
  "nav.wiki.teams": "チーム",
  "nav.settings": "設定",
};

try {
  const content = await Bun.file(jaPath).json();
  const updated = { ...content, ...jaNavKeys };
  await Bun.write(jaPath, JSON.stringify(updated, null, 2));
  console.log("Updated ja.json with nav keys.");
} catch (e) {
  console.error(e);
}
