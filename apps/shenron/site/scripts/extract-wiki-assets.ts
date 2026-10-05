/**
 * extract-wiki-assets.ts
 *
 * Extracts official high-resolution visuals, saga metadata, and character/movie
 * infobox profiles from https://dragonball.fandom.com using `bxc wiki` commands.
 *
 * Output: apps/shenron/site/data/extracted-wiki-assets.json
 */

interface WikiImage {
  fichier: string;
  url: string;
  largeur: number;
  hauteur: number;
  mime: string;
  sha1?: string;
  category?: "poster" | "profile" | "manga" | "anime" | "logo" | "illustration" | "other";
}

interface WikiInfoboxField {
  brut: string;
  propre: string;
}

interface TargetItem {
  id: string;
  name: string;
  nameJa?: string;
  nameRomaji?: string;
  category: "character" | "movie" | "saga";
  url: string;
}

const TARGETS: TargetItem[] = [
  // Characters
  {
    id: "son-goku",
    name: "Son Goku",
    nameJa: "孫悟空 / カカロット",
    nameRomaji: "Son Gokū / Kakarotto",
    category: "character",
    url: "https://dragonball.fandom.com/wiki/Goku",
  },
  {
    id: "vegeta",
    name: "Vegeta",
    nameJa: "ベジータ",
    nameRomaji: "Bejīta",
    category: "character",
    url: "https://dragonball.fandom.com/wiki/Vegeta",
  },
  {
    id: "son-gohan",
    name: "Son Gohan",
    nameJa: "孫悟飯",
    nameRomaji: "Son Gohan",
    category: "character",
    url: "https://dragonball.fandom.com/wiki/Gohan",
  },
  {
    id: "gohan-beast",
    name: "Gohan Beast",
    nameJa: "孫悟飯 ビースト",
    nameRomaji: "Son Gohan Bīsuto",
    category: "character",
    url: "https://dragonball.fandom.com/wiki/Beast",
  },
  {
    id: "broly-dbs",
    name: "Broly (DBS)",
    nameJa: "ブロリー",
    nameRomaji: "Burorī",
    category: "character",
    url: "https://dragonball.fandom.com/wiki/Broly_(DBS)",
  },
  {
    id: "beerus",
    name: "Beerus",
    nameJa: "ビルス",
    nameRomaji: "Birusu",
    category: "character",
    url: "https://dragonball.fandom.com/wiki/Beerus",
  },
  // Cult Movies
  {
    id: "dbs-super-hero",
    name: "Dragon Ball Super: Super Hero",
    nameJa: "ドラゴンボール超 スーパーヒーロー",
    nameRomaji: "Doragon Bōru Sūpā Sūpā Hīrō",
    category: "movie",
    url: "https://dragonball.fandom.com/wiki/Dragon_Ball_Super:_Super_Hero",
  },
  {
    id: "dbz-fusion-reborn",
    name: "Dragon Ball Z: Fusion Reborn",
    nameJa: "ドラゴンボールZ 復活のフュージョン!!悟空とベジータ",
    nameRomaji: "Doragon Bōru Zetto Fukkatsu no Fyūjon!! Gokū to Bejīta",
    category: "movie",
    url: "https://dragonball.fandom.com/wiki/Dragon_Ball_Z:_Fusion_Reborn",
  },
  // Major Sagas
  {
    id: "saiyan-saga",
    name: "Saiyan Saga",
    nameJa: "サイヤ人編",
    nameRomaji: "Saiya-jin Hen",
    category: "saga",
    url: "https://dragonball.fandom.com/wiki/Saiyan_Saga",
  },
  {
    id: "frieza-saga",
    name: "Frieza Saga",
    nameJa: "フリーザ編",
    nameRomaji: "Furīza Hen",
    category: "saga",
    url: "https://dragonball.fandom.com/wiki/Frieza_Saga",
  },
  {
    id: "cell-games-saga",
    name: "Cell Games Saga",
    nameJa: "セルゲーム編",
    nameRomaji: "Seru Gēmu Hen",
    category: "saga",
    url: "https://dragonball.fandom.com/wiki/Cell_Games_Saga",
  },
  {
    id: "majin-buu-saga",
    name: "Majin Buu Saga",
    nameJa: "魔人ブウ編",
    nameRomaji: "Majin Bū Hen",
    category: "saga",
    url: "https://dragonball.fandom.com/wiki/Majin_Buu_Saga",
  },
  {
    id: "god-of-destruction-beerus-saga",
    name: "God of Destruction Beerus Saga",
    nameJa: "破壊神ビルス編",
    nameRomaji: "Hakaishin Birusu Hen",
    category: "saga",
    url: "https://dragonball.fandom.com/wiki/God_of_Destruction_Beerus_Saga",
  },
  {
    id: "universe-survival-saga",
    name: "Universe Survival Saga",
    nameJa: "宇宙サバイバル編",
    nameRomaji: "Uchū Sabaibaru Hen",
    category: "saga",
    url: "https://dragonball.fandom.com/wiki/Universe_Survival_Saga",
  },
  {
    id: "super-hero-saga",
    name: "Super Hero Saga",
    nameJa: "スーパーヒーロー編",
    nameRomaji: "Sūpā Hīrō Hen",
    category: "saga",
    url: "https://dragonball.fandom.com/wiki/Super_Hero_Saga",
  },
];

async function runBxcCommand(args: string[]): Promise<string> {
  const proc = Bun.spawn(["bxc", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`bxc command failed [${args.join(" ")}]: ${stderr || stdout}`);
  }
  return stdout;
}

function classifyImage(img: WikiImage): "poster" | "profile" | "manga" | "anime" | "logo" | "illustration" | "other" {
  const name = img.fichier.toLowerCase();
  if (name.includes("logo") || img.mime === "image/svg+xml") return "logo";
  if (name.includes("poster") || name.includes("cover")) return "poster";
  if (name.includes("profile") || name.includes("render")) return "profile";
  if (name.includes("manga") || name.includes("chapter") || name.includes("vol")) return "manga";
  if (name.includes("anime") || name.includes("ep") || name.includes("toei")) return "anime";
  if (img.largeur >= 1000 || img.hauteur >= 1000) return "illustration";
  return "other";
}

function filterHighResImages(images: WikiImage[]): WikiImage[] {
  return images
    .filter((img) => {
      const isTiny = img.largeur < 350 && img.hauteur < 350 && img.mime !== "image/svg+xml";
      const isIcon =
        img.fichier.toLowerCase().includes("icon") ||
        img.fichier.toLowerCase().includes("ball.svg") ||
        img.fichier.toLowerCase().includes("button") ||
        img.fichier.toLowerCase().includes("bullet");
      return !isTiny && !isIcon;
    })
    .map((img) => (Object.assign(img, { category: classifyImage(img) })))
    .toSorted((a, b) => b.largeur * b.hauteur - a.largeur * a.hauteur);
}

function extractSummaryFromMarkdown(md: string): string {
  const lines = md.split("\n");
  const paragraphs: string[] = [];
  let currentPara = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentPara.length > 80) {
        paragraphs.push(currentPara);
      }
      currentPara = "";
      continue;
    }
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith("!") ||
      trimmed.startsWith("|") ||
      trimmed.startsWith("- [↑") ||
      trimmed.startsWith("↑ [") ||
      trimmed.startsWith("[[File:") ||
      trimmed.startsWith("<tabber>")
    ) {
      continue;
    }
    currentPara += (currentPara ? " " : "") + trimmed;
  }
  if (currentPara.length > 80) {
    paragraphs.push(currentPara);
  }

  return paragraphs[0] ?? "";
}

async function extractSagasOverview() {
  console.log("-> Extracting Sagas Master Overview from List_of_Sagas...");
  try {
    const tablesRaw = await runBxcCommand([
      "wiki",
      "tables",
      "https://dragonball.fandom.com/wiki/List_of_Sagas",
    ]);
    const tables = JSON.parse(tablesRaw);

    const siteNavTable = tables.find((t: any) => t.titre === "Site Navigation") ?? tables[tables.length - 1];

    const structuredSagas: Array<{ group: string; sagas: string[] }> = [];
    if (siteNavTable && Array.isArray(siteNavTable.lignes)) {
      for (const row of siteNavTable.lignes) {
        if (row.length >= 2) {
          const groupName = row[0].replace(/ Group$/i, "").trim();
          const sagasString = row[1];
          const sagas = sagasString
            .split(/[•·\n]/)
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0);
          if (sagas.length > 0 && !groupName.includes("Dragon Ball sagas")) {
            structuredSagas.push({
              group: groupName,
              sagas,
            });
          }
        }
      }
    }

    return {
      sourceUrl: "https://dragonball.fandom.com/wiki/List_of_Sagas",
      totalTablesExtracted: tables.length,
      sagaGroups: structuredSagas,
    };
  } catch (err) {
    console.error("Failed to extract sagas overview:", err);
    return null;
  }
}

async function main() {
  console.log("=== Dragon Ball Fandom Assets & Metadata Harvester ===");
  const startTime = Date.now();

  const results: {
    metadata: {
      generatedAt: string;
      sourceDomain: string;
      tool: string;
      totalItemsExtracted: number;
      totalHighResVisuals: number;
    };
    sagasOverview: any;
    characters: any[];
    movies: any[];
    sagas: any[];
  } = {
    metadata: {
      generatedAt: new Date().toISOString(),
      sourceDomain: "https://dragonball.fandom.com",
      tool: "bxc wiki (images, infobox, md, tables)",
      totalItemsExtracted: 0,
      totalHighResVisuals: 0,
    },
    sagasOverview: null,
    characters: [],
    movies: [],
    sagas: [],
  };

  results.sagasOverview = await extractSagasOverview();

  for (const item of TARGETS) {
    console.log(`\n[${item.category.toUpperCase()}] Harvesting ${item.name} (${item.url})...`);

    let infoboxData: Record<string, string> = {};
    try {
      const infoboxRaw = await runBxcCommand(["wiki", "infobox", item.url]);
      const parsedInfobox = JSON.parse(infoboxRaw);
      if (Array.isArray(parsedInfobox) && parsedInfobox.length > 0) {
        const rawBox = parsedInfobox[0];
        for (const [key, val] of Object.entries(rawBox)) {
          const field = val as WikiInfoboxField;
          if (field && field.propre && field.propre.trim()) {
            infoboxData[key] = field.propre.trim();
          } else if (field && field.brut && !field.brut.includes("<tabber>")) {
            infoboxData[key] = field.brut.trim();
          }
        }
      }
    } catch (err: any) {
      console.warn(`  [!] Infobox failed for ${item.name}: ${err.message}`);
    }

    let rawImages: WikiImage[] = [];
    let highResVisuals: WikiImage[] = [];
    try {
      const imagesRaw = await runBxcCommand(["wiki", "images", item.url]);
      rawImages = JSON.parse(imagesRaw);
      highResVisuals = filterHighResImages(rawImages);
      console.log(`  -> Found ${rawImages.length} images (${highResVisuals.length} high-res visuals)`);
    } catch (err: any) {
      console.warn(`  [!] Images failed for ${item.name}: ${err.message}`);
    }

    let summary = "";
    try {
      const mdRaw = await runBxcCommand(["wiki", "md", item.url]);
      summary = extractSummaryFromMarkdown(mdRaw);
    } catch (err: any) {
      console.warn(`  [!] Markdown failed for ${item.name}: ${err.message}`);
    }

    const primaryVisual =
      highResVisuals.find((img) => img.category === "poster") ??
      highResVisuals.find((img) => img.category === "profile") ??
      highResVisuals[0] ??
      null;

    const itemRecord = {
      id: item.id,
      name: item.name,
      nameJa: item.nameJa,
      nameRomaji: item.nameRomaji,
      category: item.category,
      fandomUrl: item.url,
      summary,
      primaryVisual,
      infobox: infoboxData,
      highResVisualsCount: highResVisuals.length,
      highResVisuals: highResVisuals.slice(0, 25),
    };

    results.metadata.totalHighResVisuals += highResVisuals.length;
    results.metadata.totalItemsExtracted += 1;

    if (item.category === "character") {
      results.characters.push(itemRecord);
    } else if (item.category === "movie") {
      results.movies.push(itemRecord);
    } else if (item.category === "saga") {
      results.sagas.push(itemRecord);
    }
  }

  const outputPath = "apps/shenron/site/data/extracted-wiki-assets.json";
  await Bun.write(outputPath, JSON.stringify(results, null, 2));

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Extraction Complete in ${durationSec}s ===`);
  console.log(`Saved ${results.metadata.totalItemsExtracted} entities with ${results.metadata.totalHighResVisuals} high-res assets to ${outputPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
