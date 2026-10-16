import fs from "node:fs";
import path from "node:path";

/** Package-local zukan cache (`packages/inagle/data/zukan`). */
const ZUKAN_DATA_DIR = path.resolve(import.meta.dir, "../../../data/zukan");
import { parseSkillListPage } from "../parser.js";

async function main() {
  const skillDir = path.join(ZUKAN_DATA_DIR, "skill");
  const destFile = path.join(ZUKAN_DATA_DIR, "skill-videos.json");

  console.log(`Reading HTML files from ${skillDir}...`);

  const allSkillsMap = new Map<string, any>();

  for (let pageNum = 1; pageNum <= 5; pageNum++) {
    const filePath = path.join(skillDir, `page-${pageNum}.html`);
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      continue;
    }

    console.log(`Parsing ${filePath}...`);
    const pageSkills = await parseSkillListPage(filePath);
    console.log(`Found ${pageSkills.length} skills in page ${pageNum}`);

    for (const skill of pageSkills) {
      const key = skill.name.toLowerCase().trim();
      if (!allSkillsMap.has(key)) {
        allSkillsMap.set(key, {
          name: skill.name,
          videoUrl: skill.videoUrl,
          posterUrl: skill.posterUrl,
          thumbnailUrl: skill.thumbnailUrl,
          type: skill.type,
        });
      } else {
        const existing = allSkillsMap.get(key);
        if (!existing.videoUrl && skill.videoUrl) {
          allSkillsMap.set(key, {
            name: skill.name,
            videoUrl: skill.videoUrl,
            posterUrl: skill.posterUrl,
            thumbnailUrl: skill.thumbnailUrl,
            type: skill.type,
          });
        }
      }
    }
  }

  const uniqueSkills = Array.from(allSkillsMap.values());
  console.log(`Parsed a total of ${uniqueSkills.length} unique skills.`);

  fs.writeFileSync(destFile, JSON.stringify(uniqueSkills, null, 2), "utf-8");
  console.log(`Successfully wrote ${uniqueSkills.length} skills to ${destFile}`);
}

main().catch(console.error);
