import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const __filename = import.meta.path;
const __dirname = path.dirname(__filename);

const DATA_ROOT = process.env.DATA_PATH ?? path.resolve(__dirname, "../../../data");
const SOURCE_DIR = path.resolve(DATA_ROOT, "zukan_images");
const DEST_DIR = path.resolve(DATA_ROOT, "zukan_images_webp");

async function convertImages() {
  if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
  }

  // Recursive scan function
  const scanDir = async (dir: string, baseDir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        await scanDir(fullPath, baseDir);
      } else if (entry.isFile() && entry.name.endsWith(".png")) {
        const destPath = path.join(DEST_DIR, relativePath.replace(".png", ".webp"));
        const destDir = path.dirname(destPath);

        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }

        if (await Bun.file(destPath).exists()) {
          // console.log(`Skipping existing: ${relativePath}`);
          continue;
        }

        console.log(`Converting: ${relativePath}`);
        try {
          await sharp(fullPath).webp({ quality: 80 }).toFile(destPath);
        } catch (e) {
          console.error(`Failed to convert ${relativePath}:`, e);
        }
      }
    }
  };

  console.log(`Scanning ${SOURCE_DIR}...`);
  await scanDir(SOURCE_DIR, SOURCE_DIR);
  console.log("Conversion complete.");
}

convertImages().catch(console.error);
