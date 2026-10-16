import { loadConsoleCatalog, validateConsoleCatalog } from "./catalog";

const catalog = await loadConsoleCatalog();
const errors = await validateConsoleCatalog(catalog);
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`console catalog valid: ${catalog.components.length} components`);
}
