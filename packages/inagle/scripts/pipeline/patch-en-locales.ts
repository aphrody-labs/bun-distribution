import path from "node:path";

const enPath = path.join(process.cwd(), "public/locales/en.json");

const enNavKeys = {
  "nav.home": "Home",
  "nav.news": "News",
  "nav.news.articles": "Articles",
  "nav.news.topics": "Topics",
  "nav.news.patch_notes": "Patch Notes",
  "nav.wiki": "Wiki",
  "nav.wiki.players": "Players",
  "nav.wiki.skills": "Skills",
  "nav.wiki.hyper_skills": "Hyper Skills",
  "nav.wiki.auras.keshin": "Fighting Spirits",
  "nav.wiki.auras.soul": "Souls",
  "nav.wiki.auras.miximax": "Miximax",
  "nav.wiki.auras.awakening": "Awakening",
  "nav.wiki.auras.mode": "Mode Change",
  "nav.wiki.items": "Items",
  "nav.wiki.passives": "Passives",
  "nav.wiki.teams": "Teams",
  "nav.settings": "Settings",
};

try {
  const content = await Bun.file(enPath).json();
  const updated = { ...content, ...enNavKeys };
  await Bun.write(enPath, JSON.stringify(updated, null, 2));
  console.log("Updated en.json with nav keys.");
} catch (e) {
  console.error(e);
}
